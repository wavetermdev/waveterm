// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const (
	DebugTermModeHex    = "hex"
	DebugTermModeDecode = "decode"
	DebugTermModeStdin  = "stdin"
)

var debugTermCmd = &cobra.Command{
	Use:                   "debugterm",
	Short:                 "inspect recent terminal output bytes",
	RunE:                  debugTermRun,
	DisableFlagsInUseLine: true,
	Hidden:                true,
}

var (
	debugTermSize int64
	debugTermMode string
)

func init() {
	rootCmd.AddCommand(debugTermCmd)
	debugTermCmd.Flags().Int64Var(&debugTermSize, "size", 1000, "number of terminal bytes to read")
	debugTermCmd.Flags().StringVar(&debugTermMode, "mode", DebugTermModeHex, "output mode: hex, decode, or stdin")
}

func debugTermRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("debugterm", rtnErr == nil)
	}()
	mode := strings.ToLower(debugTermMode)
	if mode != DebugTermModeHex && mode != DebugTermModeDecode && mode != DebugTermModeStdin {
		return fmt.Errorf("invalid mode %q (expected %q, %q, or %q)", debugTermMode, DebugTermModeHex, DebugTermModeDecode, DebugTermModeStdin)
	}
	if mode == DebugTermModeStdin {
		stdinData, err := io.ReadAll(WrappedStdin)
		if err != nil {
			return fmt.Errorf("reading stdin: %w", err)
		}
		termData, err := parseDebugTermStdinData(stdinData)
		if err != nil {
			return err
		}
		WriteStdout("%s", formatDebugTermDecode(termData))
		return nil
	}
	if debugTermSize <= 0 {
		return fmt.Errorf("size must be greater than 0")
	}
	err := preRunSetupRpcClient(cmd, args)
	if err != nil {
		return err
	}
	fullORef, err := resolveBlockArg()
	if err != nil {
		return err
	}
	rtn, err := wshclient.DebugTermCommand(RpcClient, wshrpc.CommandDebugTermData{
		BlockId: fullORef.OID,
		Size:    debugTermSize,
	}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("reading terminal output: %w", err)
	}
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

func parseDebugTermStdinData(data []byte) ([]byte, error) {
	var arr []string
	err := json.Unmarshal(data, &arr)
	if err != nil {
		return nil, fmt.Errorf("stdin mode expects a JSON array of strings: %w", err)
	}
	return []byte(strings.Join(arr, "")), nil
}

func formatDebugTermHex(data []byte) string {
	return hex.Dump(data)
}

func formatDebugTermDecode(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	lines := make([]string, 0)
	for i := 0; i < len(data); {
		b := data[i]
		if b == 0x1b {
			if i+1 >= len(data) {
				lines = append(lines, "ESC")
				i++
				continue
			}
			next := data[i+1]
			switch next {
			case '[':
				seq, end := consumeDebugTermCSI(data, i)
				lines = append(lines, "CSI "+strconv.QuoteToASCII(string(seq)))
				i = end
			case ']':
				seq, end := consumeDebugTermOSC(data, i)
				lines = append(lines, "OSC "+strconv.QuoteToASCII(string(seq)))
				i = end
			case 'P':
				seq, end := consumeDebugTermST(data, i)
				lines = append(lines, "DCS "+strconv.QuoteToASCII(string(seq)))
				i = end
			case '^':
				seq, end := consumeDebugTermST(data, i)
				lines = append(lines, "PM "+strconv.QuoteToASCII(string(seq)))
				i = end
			case '_':
				seq, end := consumeDebugTermST(data, i)
				lines = append(lines, "APC "+strconv.QuoteToASCII(string(seq)))
				i = end
			default:
				seq := data[i : i+2]
				lines = append(lines, "ESC "+strconv.QuoteToASCII(string(seq)))
				i += 2
			}
			continue
		}
		if b == 0x07 {
			lines = append(lines, "BEL")
			i++
			continue
		}
		if isDebugTermTextByte(b) {
			start := i
			for i < len(data) && isDebugTermTextByte(data[i]) {
				i++
			}
			lines = append(lines, "TXT "+strconv.QuoteToASCII(string(data[start:i])))
			continue
		}
		lines = append(lines, fmt.Sprintf("CTL 0x%02x", b))
		i++
	}
	return strings.Join(lines, "\n") + "\n"
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

func isDebugTermTextByte(b byte) bool {
	return b == '\n' || b == '\r' || b == '\t' || (b >= 0x20 && b <= 0x7e)
}
