// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const (
	DebugTermModeHex    = "hex"
	DebugTermModeDecode = "decode"
)

var debugTermCmd = &cobra.Command{
	Use:                   "debugterm",
	Short:                 "inspect recent terminal output bytes",
	RunE:                  debugTermRun,
	PreRunE:               debugTermPreRun,
	DisableFlagsInUseLine: true,
	Hidden:                true,
}

var (
	debugTermSize  int64
	debugTermMode  string
	debugTermStdin bool
	debugTermInput string
)

func init() {
	rootCmd.AddCommand(debugTermCmd)
	debugTermCmd.Flags().Int64Var(&debugTermSize, "size", 1000, "number of terminal bytes to read")
	debugTermCmd.Flags().StringVar(&debugTermMode, "mode", DebugTermModeHex, "output mode: hex or decode")
	debugTermCmd.Flags().BoolVar(&debugTermStdin, "stdin", false, "read input from stdin instead of rpc call")
	debugTermCmd.Flags().StringVar(&debugTermInput, "input", "", "read input from file instead of rpc call")
}

func debugTermRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("debugterm", rtnErr == nil)
	}()
	mode, err := getDebugTermMode()
	if err != nil {
		return err
	}
	if debugTermStdin {
		stdinData, err := io.ReadAll(WrappedStdin)
		if err != nil {
			return fmt.Errorf("reading stdin: %w", err)
		}
		termData, err := parseDebugTermStdinData(stdinData)
		if err != nil {
			return err
		}
		if mode == DebugTermModeDecode {
			WriteStdout("%s", formatDebugTermDecode(termData))
		} else {
			WriteStdout("%s", formatDebugTermHex(termData))
		}
		return nil
	}
	if debugTermInput != "" {
		fileData, err := os.ReadFile(debugTermInput)
		if err != nil {
			return fmt.Errorf("reading input file: %w", err)
		}
		termData, err := parseDebugTermStdinData(fileData)
		if err != nil {
			return err
		}
		if mode == DebugTermModeDecode {
			WriteStdout("%s", formatDebugTermDecode(termData))
		} else {
			WriteStdout("%s", formatDebugTermHex(termData))
		}
		return nil
	}
	if debugTermSize <= 0 {
		return fmt.Errorf("size must be greater than 0")
	}
	fullORef, err := resolveBlockArg()
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "resolved block %s\n", fullORef)
	rtn, err := wshclient.DebugTermCommand(RpcClient, wshrpc.CommandDebugTermData{
		BlockId: fullORef.OID,
		Size:    debugTermSize,
	}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("reading terminal output: %w", err)
	}
	fmt.Fprintf(os.Stderr, "got rtn: %#v\n", rtn)
	termData, err := base64.StdEncoding.DecodeString(rtn.Data64)
	if err != nil {
		return fmt.Errorf("decoding terminal output: %w", err)
	}
	var output string
	if mode == DebugTermModeDecode {
		output = formatDebugTermDecode(termData)
	} else {
		output = formatDebugTermHex(termData)
	}
	WriteStdout("%s", output)
	return nil
}

func debugTermPreRun(cmd *cobra.Command, args []string) error {
	if debugTermStdin || debugTermInput != "" {
		return nil
	}
	return preRunSetupRpcClient(cmd, args)
}

func getDebugTermMode() (string, error) {
	mode := strings.ToLower(debugTermMode)
	if mode != DebugTermModeHex && mode != DebugTermModeDecode {
		return "", fmt.Errorf("invalid mode %q (expected %q or %q)", debugTermMode, DebugTermModeHex, DebugTermModeDecode)
	}
	return mode, nil
}

type debugTermStdinEntry struct {
	Data string `json:"data"`
}

func parseDebugTermStdinData(data []byte) ([]byte, error) {
	trimmed := strings.TrimSpace(string(data))
	if len(trimmed) == 0 {
		return data, nil
	}
	if trimmed[0] == '[' {
		// try array of structs first
		var structArr []debugTermStdinEntry
		err := json.Unmarshal(data, &structArr)
		if err == nil {
			parts := make([]string, len(structArr))
			for i, entry := range structArr {
				parts[i] = entry.Data
			}
			return []byte(strings.Join(parts, "")), nil
		}
		fmt.Fprintf(os.Stderr, "json read err %v\n", err)
		// try array of strings
		var strArr []string
		err = json.Unmarshal(data, &strArr)
		if err == nil {
			return []byte(strings.Join(strArr, "")), nil
		}
	}
	return data, nil
}

func formatDebugTermHex(data []byte) string {
	return hex.Dump(data)
}

func parseCursorForwardN(seq []byte) (int, bool) {
	if len(seq) < 3 || seq[len(seq)-1] != 'C' {
		return 0, false
	}
	params := string(seq[2 : len(seq)-1])
	if params == "" {
		return 1, true
	}
	n, err := strconv.Atoi(params)
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

// splitOnCRLFRuns splits s at the end of each run of \r and \n characters.
// Each segment includes its trailing CR/LF run. The last segment may have no such run.
func splitOnCRLFRuns(s string) []string {
	var result []string
	for len(s) > 0 {
		// find start of next CR/LF run
		i := 0
		for i < len(s) && s[i] != '\r' && s[i] != '\n' {
			i++
		}
		if i == len(s) {
			break
		}
		// consume the CR/LF run
		j := i
		for j < len(s) && (s[j] == '\r' || s[j] == '\n') {
			j++
		}
		result = append(result, s[:j])
		s = s[j:]
	}
	if len(s) > 0 {
		result = append(result, s)
	}
	return result
}

func formatDebugTermDecode(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	lines := make([]string, 0)
	// textBuf accumulates text across CSI-C (cursor forward) sequences so consecutive
	// "word CSI-C word" runs collapse into a single TXT line. The // NC annotation goes
	// on the last segment only.
	textBuf := ""
	totalCSpaces := 0
	flushText := func() {
		if textBuf == "" && totalCSpaces == 0 {
			return
		}
		segs := splitOnCRLFRuns(textBuf)
		if len(segs) == 0 {
			segs = []string{textBuf}
		}
		for i, seg := range segs {
			if i == len(segs)-1 && totalCSpaces > 0 {
				lines = append(lines, fmt.Sprintf("TXT %s // %dC", strconv.Quote(seg), totalCSpaces))
			} else {
				lines = append(lines, "TXT "+strconv.Quote(seg))
			}
		}
		textBuf = ""
		totalCSpaces = 0
	}
	for i := 0; i < len(data); {
		b := data[i]
		if b == 0x1b {
			if i+1 >= len(data) {
				flushText()
				lines = append(lines, "ESC")
				i++
				continue
			}
			next := data[i+1]
			switch next {
			case '[':
				seq, end := consumeDebugTermCSI(data, i)
				if n, ok := parseCursorForwardN(seq); ok {
					textBuf += strings.Repeat(" ", n)
					totalCSpaces += n
				} else {
					flushText()
					lines = append(lines, formatDebugTermCSILine(seq))
				}
				i = end
			case ']':
				flushText()
				seq, end := consumeDebugTermOSC(data, i)
				lines = append(lines, formatDebugTermOSCLine(seq))
				i = end
			case 'P':
				flushText()
				seq, end := consumeDebugTermST(data, i)
				lines = append(lines, "DCS "+strconv.QuoteToASCII(string(seq)))
				i = end
			case '^':
				flushText()
				seq, end := consumeDebugTermST(data, i)
				lines = append(lines, "PM "+strconv.QuoteToASCII(string(seq)))
				i = end
			case '_':
				flushText()
				seq, end := consumeDebugTermST(data, i)
				lines = append(lines, "APC "+strconv.QuoteToASCII(string(seq)))
				i = end
			default:
				flushText()
				seq := data[i : i+2]
				lines = append(lines, "ESC "+strconv.QuoteToASCII(string(seq)))
				i += 2
			}
			continue
		}
		if b == 0x07 {
			flushText()
			lines = append(lines, "BEL")
			i++
			continue
		}
		start, end := consumeDebugTermText(data, i)
		if end > start {
			textBuf += string(data[start:end])
			i = end
			continue
		}
		flushText()
		lines = append(lines, fmt.Sprintf("CTL 0x%02x", b))
		i++
	}
	flushText()
	return strings.Join(lines, "\n") + "\n"
}

var csiCommandDescriptions = map[byte]string{
	'@': "insert character",
	'A': "cursor up",
	'B': "cursor down",
	'C': "cursor forward",
	'D': "cursor back",
	'E': "cursor next line",
	'F': "cursor prev line",
	'G': "cursor horizontal absolute",
	'H': "cursor position",
	'I': "cursor horizontal tab",
	'J': "erase display",
	'K': "erase line",
	'L': "insert line",
	'M': "delete line",
	'P': "delete character",
	'S': "scroll up",
	'T': "scroll down",
	'X': "erase character",
	'Z': "cursor backward tab",
	'a': "cursor horizontal relative",
	'b': "repeat character",
	'c': "device attributes",
	'd': "cursor vertical absolute",
	'e': "cursor vertical relative",
	'f': "horizontal vertical position",
	'g': "tab clear",
	'h': "set mode",
	'l': "reset mode",
	'm': "SGR",
	'n': "device status report",
	'r': "set scrolling region",
	's': "save cursor",
	'u': "restore cursor",
}

var decModeDescriptions = map[string]string{
	"1":    "application cursor keys",
	"3":    "132 column mode",
	"6":    "origin mode",
	"7":    "auto wrap",
	"12":   "blinking cursor",
	"25":   "show cursor",
	"47":   "alternate screen",
	"1000": "mouse X10 tracking",
	"1002": "mouse button events",
	"1003": "mouse all events",
	"1004": "focus events",
	"1006": "SGR mouse mode",
	"1049": "alt screen + save cursor",
	"2004": "bracketed paste",
	"2026": "synchronized output",
}

var sgrSingleDescriptions = map[int]string{
	0:  "reset all",
	1:  "bold",
	2:  "dim",
	3:  "italic",
	4:  "underline",
	5:  "blink",
	7:  "reverse",
	8:  "hidden",
	9:  "strikethrough",
	21: "doubly underlined",
	22: "normal intensity",
	23: "not italic",
	24: "not underlined",
	25: "not blinking",
	27: "not reversed",
	28: "not hidden",
	29: "not strikethrough",
	39: "default fg",
	49: "default bg",
}

func describeSGR(params string) string {
	if params == "" {
		return "reset all"
	}
	parts := strings.Split(params, ";")
	if len(parts) >= 5 && parts[0] == "38" && parts[1] == "2" {
		return fmt.Sprintf("fg rgb(%s,%s,%s)", parts[2], parts[3], parts[4])
	}
	if len(parts) >= 5 && parts[0] == "48" && parts[1] == "2" {
		return fmt.Sprintf("bg rgb(%s,%s,%s)", parts[2], parts[3], parts[4])
	}
	if len(parts) == 3 && parts[0] == "38" && parts[1] == "5" {
		return fmt.Sprintf("fg color256(%s)", parts[2])
	}
	if len(parts) == 3 && parts[0] == "48" && parts[1] == "5" {
		return fmt.Sprintf("bg color256(%s)", parts[2])
	}
	if len(parts) != 1 {
		return ""
	}
	n, err := strconv.Atoi(parts[0])
	if err != nil {
		return ""
	}
	if desc, ok := sgrSingleDescriptions[n]; ok {
		return desc
	}
	if n >= 30 && n <= 37 {
		return fmt.Sprintf("fg ansi color %d", n-30)
	}
	if n >= 40 && n <= 47 {
		return fmt.Sprintf("bg ansi color %d", n-40)
	}
	if n >= 90 && n <= 97 {
		return fmt.Sprintf("fg bright color %d", n-90)
	}
	if n >= 100 && n <= 107 {
		return fmt.Sprintf("bg bright color %d", n-100)
	}
	return ""
}

func formatDebugTermCSILine(seq []byte) string {
	// seq is the full sequence starting with ESC [
	if len(seq) < 3 {
		return "CSI " + strconv.QuoteToASCII(string(seq))
	}
	inner := seq[2:]
	finalByte := inner[len(inner)-1]
	params := string(inner[:len(inner)-1])

	// DEC private mode: params starts with "?" and final byte is 'h' (set) or 'l' (reset)
	if strings.HasPrefix(params, "?") && (finalByte == 'h' || finalByte == 'l') {
		modeStr := params[1:]
		var line string
		if finalByte == 'h' {
			line = "DEC SET " + modeStr
		} else {
			line = "DEC RST " + modeStr
		}
		if desc, ok := decModeDescriptions[modeStr]; ok {
			line += " // " + desc
		}
		return line
	}

	finalStr := string([]byte{finalByte})
	var line string
	if params == "" {
		line = "CSI " + finalStr
	} else {
		line = "CSI " + finalStr + " " + params
	}
	if finalByte == 'm' {
		if desc := describeSGR(params); desc != "" {
			line += " // " + desc
		}
	} else if desc, ok := csiCommandDescriptions[finalByte]; ok {
		line += " // " + desc
	}
	return line
}

func consumeDebugTermCSI(data []byte, start int) ([]byte, int) {
	i := start + 2
	for i < len(data) {
		if data[i] >= 0x40 && data[i] <= 0x7e {
			return data[start : i+1], i + 1
		}
		i++
	}
	return data[start:], len(data)
}

func formatDebugTermOSCLine(seq []byte) string {
	// seq is the full sequence starting with ESC ]
	if len(seq) < 3 {
		return "OSC " + strconv.QuoteToASCII(string(seq))
	}
	// strip ESC ] prefix
	inner := string(seq[2:])
	// strip trailing BEL or ST (ESC \)
	inner = strings.TrimSuffix(inner, "\x07")
	inner = strings.TrimSuffix(inner, "\x1b\\")
	// split code from data on first ;
	if idx := strings.IndexByte(inner, ';'); idx >= 0 {
		code := inner[:idx]
		data := inner[idx+1:]
		return "OSC " + code + " " + strconv.QuoteToASCII(data)
	}
	return "OSC " + strconv.QuoteToASCII(inner)
}

func consumeDebugTermOSC(data []byte, start int) ([]byte, int) {
	i := start + 2
	for i < len(data) {
		if data[i] == 0x07 {
			return data[start : i+1], i + 1
		}
		if data[i] == 0x1b && i+1 < len(data) && data[i+1] == '\\' {
			return data[start : i+2], i + 2
		}
		i++
	}
	return data[start:], len(data)
}

func consumeDebugTermST(data []byte, start int) ([]byte, int) {
	i := start + 2
	for i < len(data) {
		if data[i] == 0x1b && i+1 < len(data) && data[i+1] == '\\' {
			return data[start : i+2], i + 2
		}
		i++
	}
	return data[start:], len(data)
}

func isDebugTermC0Control(b byte) bool {
	return b < 0x20 || b == 0x7f
}

func consumeDebugTermText(data []byte, i int) (start, end int) {
	start = i
	for i < len(data) {
		b := data[i]
		if b == 0x1b || b == 0x07 {
			break
		}
		if b == '\n' || b == '\r' || b == '\t' {
			i++
			continue
		}
		if isDebugTermC0Control(b) {
			break
		}
		if b < 0x80 {
			i++
			continue
		}
		_, sz := utf8.DecodeRune(data[i:])
		if sz == 1 {
			break
		}
		i += sz
	}
	return start, i
}
