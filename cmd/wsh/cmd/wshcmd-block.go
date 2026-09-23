// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	defaultCaptureTail        = 200
	sendKeysHumanInputGuardMs = int64(2000)
	pngDataURLPrefix          = "data:image/png;base64,"
)

// blockCmd is the singular "block" command group. It is distinct from the
// existing "blocks" (plural) group; this one operates on a single block.
var blockCmd = &cobra.Command{
	Use:   "block",
	Short: "Manage a single block",
	Long:  "Commands for capturing and controlling a single block.",
}

var blockCaptureCmd = &cobra.Command{
	Use:   "capture <block_ref>",
	Short: "Capture terminal scrollback from a block",
	Long: `Capture the terminal scrollback from a terminal block.

By default, retrieves the last 200 lines as text. Use --all for the full
buffer, --start/--end for a line range, --tail for the last N lines,
--since-line for incremental capture from a line cursor, or --last-command
for the output of the last command (requires shell integration).

When --json is given, output is a single JSON object with the shape:

  {
    "lines": ["line 1", "line 2", "..."],
    "totallines": 123,
    "lastupdated": 1690000000000,
    "linestart": 0
  }

where "lines" are the captured lines, "totallines" is the total number of
lines in the terminal buffer, "lastupdated" is the Unix millisecond timestamp
of the last buffer update, and "linestart" is the starting line index of the
returned slice. If --max-bytes truncated the joined output, "truncated" is
true.`,
	Args:                  cobra.MaximumNArgs(1),
	RunE:                  blockCaptureRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var (
	blockCaptureStart       int
	blockCaptureEnd         int
	blockCaptureTail        int
	blockCaptureLastCommand bool
	blockCaptureJSON        bool
	blockCaptureOutputFile  string
	blockCaptureAll         bool
	blockCaptureMaxBytes    int
	blockCaptureSinceLine   int
	blockCaptureSince       int64
)

var blockSendKeysCmd = &cobra.Command{
	Use:   "send-keys <block_ref> [text]",
	Short: "Send keystrokes to a terminal block",
	Long: `Send keystrokes to a terminal block as if typed.

The text is the optional positional argument (or use --secret to type a stored
secret's value). By default text is sent literally. Use --escapes to interpret
backslash escape sequences (\uXXXX, \n, \t, \r, \\). Use --enter to append the
Enter key (0x0d) to the input. Without --force, send-keys is refused if a human
typed in the block within the last 2 seconds.`,
	Args:                  cobra.MaximumNArgs(2),
	RunE:                  blockSendKeysRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var blockStatusCmd = &cobra.Command{
	Use:   "status <block_ref>",
	Short: "Report the status of a terminal block's process and connection",
	Long: `Report the process and connection status of a terminal block.

By default prints a human-readable summary. With --json, prints a single JSON
object with the shape:

  {
    "processstate": "running" | "exited",
    "exitcode": 0,
    "connection": "prod-server",
    "connstatus": "connected"
  }`,
	Args:                  cobra.MaximumNArgs(1),
	RunE:                  blockStatusRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var (
	blockSendKeysEnter   bool
	blockSendKeysEscapes bool
	blockSendKeysSecret  string
	blockSendKeysForce   bool
	blockStatusJSON      bool
)

var blockNewCmd = &cobra.Command{
	Use:   "new",
	Short: "Create a new block",
	Long: `Create a new block in a tab.

By default creates a plain terminal block in the current tab. Use --view to
choose the view type, --connection to attach to a connection, --cmd to run a
persistent command, --magnified to open magnified, and --split/--relative-to to
create the block by splitting an existing block.

With --json, output is a single JSON object with the shape:

  {
    "blockid": "<oid>"
  }

Block geometry is not yet reported; it arrives in a later phase.`,
	Args:                  cobra.NoArgs,
	RunE:                  blockNewRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var blockSplitCmd = &cobra.Command{
	Use:   "split <block_ref> --direction left|right|above|below",
	Short: "Create a new block by splitting an existing block",
	Long: `Create a new terminal block by splitting the referenced block in the given
direction.

This is sugar for "block new --split <direction> --relative-to <block_ref>".
The direction vocabulary matches directional addressing: left, right, above,
below.`,
	Args:                  cobra.ExactArgs(1),
	RunE:                  blockSplitRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var blockRenameCmd = &cobra.Command{
	Use:                   "rename <block_ref> <name>",
	Short:                 "Rename a block",
	Long:                  `Set a block's title (frame:title) so it can be found by name later.`,
	Args:                  cobra.ExactArgs(2),
	RunE:                  blockRenameRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var blockScreenshotCmd = &cobra.Command{
	Use:   "screenshot [block_ref]",
	Short: "Capture a PNG screenshot of a block",
	Long: `Capture a PNG screenshot of a block.

--output <file> is required unless --json is set. --json prints the block id
and byte length (not the image data). Combined with --output, JSON also
includes the file path.`,
	Args:                  cobra.MaximumNArgs(1),
	RunE:                  blockScreenshotRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var (
	blockNewView       string
	blockNewConnection string
	blockNewCmdStr     string
	blockNewMagnified  bool
	blockNewSplit      string
	blockNewRelativeTo string
	blockNewTab        string
	blockNewJSON       bool
	blockNewNoFocus    bool

	blockSplitDirection string
	blockSplitJSON      bool

	blockScreenshotOutput string
	blockScreenshotJSON   bool
)

func init() {
	addCaptureFlags(blockCaptureCmd)
	addSendKeysFlags(blockSendKeysCmd)
	blockStatusCmd.Flags().BoolVar(&blockStatusJSON, "json", false, "output as JSON")

	blockNewCmd.Flags().StringVar(&blockNewView, "view", "term", "view type (default \"term\")")
	blockNewCmd.Flags().StringVar(&blockNewConnection, "connection", "", "connection name to attach the block to")
	blockNewCmd.Flags().StringVar(&blockNewCmdStr, "cmd", "", "run a persistent command in a terminal block")
	blockNewCmd.Flags().BoolVar(&blockNewMagnified, "magnified", false, "open the block in magnified mode")
	blockNewCmd.Flags().StringVar(&blockNewSplit, "split", "", "split direction: left, right, above, below (requires --relative-to)")
	blockNewCmd.Flags().StringVar(&blockNewRelativeTo, "relative-to", "", "block reference to split (requires --split)")
	blockNewCmd.Flags().StringVar(&blockNewTab, "tab", "", "target tab (tab:N, uuid, or tab ORef; defaults to current tab)")
	blockNewCmd.Flags().BoolVar(&blockNewJSON, "json", false, "output as JSON")
	blockNewCmd.Flags().BoolVar(&blockNewNoFocus, "no-focus", false, "create the block without stealing focus")

	addSplitFlags(blockSplitCmd)

	blockScreenshotCmd.Flags().StringVarP(&blockScreenshotOutput, "output", "o", "", "write PNG to this file")
	blockScreenshotCmd.Flags().BoolVar(&blockScreenshotJSON, "json", false, "output block id and byte length as JSON")

	blockCmd.AddCommand(blockSendKeysCmd)
	blockCmd.AddCommand(blockStatusCmd)
	blockCmd.AddCommand(blockCaptureCmd)
	blockCmd.AddCommand(blockNewCmd)
	blockCmd.AddCommand(blockSplitCmd)
	blockCmd.AddCommand(blockRenameCmd)
	blockCmd.AddCommand(blockScreenshotCmd)
	rootCmd.AddCommand(blockCmd)
}

// addCaptureFlags registers the capture command flags on cmd. It is shared
// between "block capture" and the top-level "capture-pane" alias.
func addCaptureFlags(cmd *cobra.Command) {
	cmd.Flags().IntVar(&blockCaptureStart, "start", 0, "starting line number (0 = beginning)")
	cmd.Flags().IntVar(&blockCaptureEnd, "end", 0, "ending line number (0 = all lines)")
	cmd.Flags().IntVar(&blockCaptureTail, "tail", 0, "return only the last N lines (mutually exclusive with --start/--end/--all)")
	cmd.Flags().BoolVar(&blockCaptureAll, "all", false, "return the full scrollback buffer")
	cmd.Flags().IntVar(&blockCaptureMaxBytes, "max-bytes", 0, "truncate joined output to at most N bytes")
	cmd.Flags().IntVar(&blockCaptureSinceLine, "since-line", 0, "return lines starting at this line cursor (maps to LineStart)")
	cmd.Flags().Int64Var(&blockCaptureSince, "since", 0, "if the buffer has not changed since this Unix millisecond timestamp, return empty lines")
	cmd.Flags().BoolVar(&blockCaptureLastCommand, "last-command", false, "get output of last command (requires shell integration)")
	cmd.Flags().BoolVar(&blockCaptureLastCommand, "lastcommand", false, "get output of last command (requires shell integration)")
	cmd.Flags().BoolVar(&blockCaptureJSON, "json", false, "output as JSON (includes totallines, lastupdated, and linestart)")
	cmd.Flags().StringVarP(&blockCaptureOutputFile, "output", "o", "", "write output to file instead of stdout")
	cmd.Flags().MarkHidden("lastcommand")
}

// addSendKeysFlags registers the send-keys command flags on cmd. It is shared
// between "block send-keys" and the top-level "send-keys" alias.
func addSendKeysFlags(cmd *cobra.Command) {
	cmd.Flags().BoolVar(&blockSendKeysEnter, "enter", false, "append the Enter key to the input")
	cmd.Flags().BoolVar(&blockSendKeysEscapes, "escapes", false, "interpret \\uXXXX, \\n, \\t, \\r, \\\\ escape sequences in the input text")
	cmd.Flags().StringVar(&blockSendKeysSecret, "secret", "", "type the value of a stored secret instead of literal text")
	cmd.Flags().BoolVar(&blockSendKeysForce, "force", false, "send keys even if a human recently typed in this block")
}

// addSplitFlags registers the split command flags on cmd. It is shared between
// "block split" and the top-level "split-pane" alias.
func addSplitFlags(cmd *cobra.Command) {
	cmd.Flags().StringVar(&blockSplitDirection, "direction", "", "split direction: left, right, above, below (required)")
	cmd.Flags().BoolVar(&blockSplitJSON, "json", false, "output as JSON")
}

// blockCaptureJSONOutput is the structured output shape for `block capture --json`.
type blockCaptureJSONOutput struct {
	Lines       []string `json:"lines"`
	TotalLines  int      `json:"totallines"`
	LastUpdated int64    `json:"lastupdated"`
	LineStart   int      `json:"linestart"`
	Truncated   bool     `json:"truncated,omitempty"`
}

// captureFlags is the parsed capture range/limit flag state. It is used by
// validation and by the default-tail / LineStart resolution helpers.
type captureFlags struct {
	TailSet        bool
	StartSet       bool
	EndSet         bool
	AllSet         bool
	SinceLineSet   bool
	MaxBytesSet    bool
	LastCommandSet bool
	Tail           int
	Start          int
	End            int
	SinceLine      int
	MaxBytes       int
}

// validateCaptureFlags checks mutually exclusive capture range flags and
// that --tail / --max-bytes / --since-line have valid values when set.
func validateCaptureFlags(f captureFlags) error {
	if f.TailSet && f.AllSet {
		return fmt.Errorf("--tail cannot be combined with --all")
	}
	if f.TailSet && (f.StartSet || f.EndSet) {
		return fmt.Errorf("--tail cannot be combined with --start or --end")
	}
	if f.TailSet && f.SinceLineSet {
		return fmt.Errorf("--tail cannot be combined with --since-line")
	}
	if f.AllSet && (f.StartSet || f.EndSet) {
		return fmt.Errorf("--all cannot be combined with --start or --end")
	}
	if f.AllSet && f.SinceLineSet {
		return fmt.Errorf("--all cannot be combined with --since-line")
	}
	if f.SinceLineSet && f.StartSet {
		return fmt.Errorf("--since-line cannot be combined with --start")
	}
	if f.TailSet && f.Tail <= 0 {
		return fmt.Errorf("--tail must be a positive integer")
	}
	if f.SinceLineSet && f.SinceLine < 0 {
		return fmt.Errorf("--since-line must be a non-negative integer")
	}
	if f.MaxBytesSet && f.MaxBytes <= 0 {
		return fmt.Errorf("--max-bytes must be a positive integer")
	}
	return nil
}

// shouldApplyDefaultTail reports whether capture should use the default
// --tail 200. Default tail applies only when the user did not pass --tail,
// --all, --start, --end, --since-line, or --last-command. --last-command already
// scopes the buffer to one command; applying the default tail would truncate it.
func shouldApplyDefaultTail(f captureFlags) bool {
	return !f.TailSet && !f.StartSet && !f.EndSet && !f.AllSet && !f.SinceLineSet && !f.LastCommandSet
}

// resolveCaptureRequest maps capture flags to the TermGetScrollbackLines
// LineStart/LineEnd and whether the result should be tailed locally.
func resolveCaptureRequest(f captureFlags) (lineStart, lineEnd, tail int, applyTail bool) {
	if f.AllSet {
		return 0, 0, 0, false
	}
	if f.TailSet {
		return 0, 0, f.Tail, true
	}
	if shouldApplyDefaultTail(f) {
		return 0, 0, defaultCaptureTail, true
	}
	lineStart = f.Start
	lineEnd = f.End
	if f.SinceLineSet {
		lineStart = f.SinceLine
	}
	return lineStart, lineEnd, 0, false
}

// tailLines returns the last tail lines of lines. If tail is <= 0 or the
// buffer has fewer than tail lines, it returns all of lines.
func tailLines(lines []string, tail int) []string {
	if tail <= 0 || tail >= len(lines) {
		return lines
	}
	return lines[len(lines)-tail:]
}

// effectiveLineStart returns the LineStart cursor after a local tail slice.
func effectiveLineStart(rpcLineStart, fetchedCount, returnedCount int) int {
	skipped := fetchedCount - returnedCount
	if skipped < 0 {
		skipped = 0
	}
	return rpcLineStart + skipped
}

// applySinceFilter returns empty lines when the buffer has not changed since
// sinceMs. Cursors are left to the caller. If sinceSet is false, lines are
// returned unchanged.
func applySinceFilter(lines []string, lastUpdated, sinceMs int64, sinceSet bool) []string {
	if !sinceSet {
		return lines
	}
	if lastUpdated <= sinceMs {
		return []string{}
	}
	return lines
}

// truncateJoinedOutput truncates the newline-joined output to maxBytes.
// Individual lines are not independently truncated; the joined string is
// sliced and split back into lines. maxBytes <= 0 means no limit.
func truncateJoinedOutput(lines []string, maxBytes int) (out []string, truncated bool) {
	if maxBytes <= 0 {
		return lines, false
	}
	joined := strings.Join(lines, "\n")
	if len(joined) <= maxBytes {
		return lines, false
	}
	joined = joined[:maxBytes]
	if joined == "" {
		return []string{}, true
	}
	return strings.Split(joined, "\n"), true
}

func blockCaptureRun(cmd *cobra.Command, args []string) error {
	flags := captureFlags{
		TailSet:        cmd.Flags().Changed("tail"),
		StartSet:       cmd.Flags().Changed("start"),
		EndSet:         cmd.Flags().Changed("end"),
		AllSet:         blockCaptureAll,
		SinceLineSet:   cmd.Flags().Changed("since-line"),
		MaxBytesSet:    cmd.Flags().Changed("max-bytes"),
		LastCommandSet: blockCaptureLastCommand,
		Tail:           blockCaptureTail,
		Start:          blockCaptureStart,
		End:            blockCaptureEnd,
		SinceLine:      blockCaptureSinceLine,
		MaxBytes:       blockCaptureMaxBytes,
	}
	if err := validateCaptureFlags(flags); err != nil {
		return err
	}

	// Resolve the block reference (positional arg, then -b/--block, then "this").
	blockRef := ""
	if len(args) > 0 {
		blockRef = args[0]
	}
	fullORef, err := resolveBlockArgWithOverride(blockRef)
	if err != nil {
		return err
	}

	// Get block metadata to verify it's a terminal block.
	metaData, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{
		ORef: *fullORef,
	}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("error getting block metadata: %w", err)
	}

	viewType, ok := metaData[waveobj.MetaKey_View].(string)
	if !ok || viewType != "term" {
		return fmt.Errorf("block %s is not a terminal block (view type: %s)", fullORef.OID, viewType)
	}

	lineStart, lineEnd, effectiveTail, applyTail := resolveCaptureRequest(flags)

	// Fetch the scrollback. For --tail (including the default) we fetch the
	// requested range and slice locally so TotalLines/LastUpdated are
	// surfaced in a single RPC round-trip.
	result, err := termGetScrollback(fullORef.OID, lineStart, lineEnd, blockCaptureLastCommand)
	if err != nil {
		return err
	}

	lines := result.Lines
	if applyTail {
		lines = tailLines(result.Lines, effectiveTail)
	}
	outLineStart := effectiveLineStart(result.LineStart, len(result.Lines), len(lines))
	sinceSet := cmd.Flags().Changed("since")
	lines = applySinceFilter(lines, result.LastUpdated, blockCaptureSince, sinceSet)
	lines, truncated := truncateJoinedOutput(lines, flags.MaxBytes)

	// Format the output.
	var output string
	if blockCaptureJSON {
		bytes, err := json.MarshalIndent(blockCaptureJSONOutput{
			Lines:       lines,
			TotalLines:  result.TotalLines,
			LastUpdated: result.LastUpdated,
			LineStart:   outLineStart,
			Truncated:   truncated,
		}, "", "  ")
		if err != nil {
			return fmt.Errorf("failed to marshal JSON: %w", err)
		}
		output = string(bytes) + "\n"
	} else {
		output = strings.Join(lines, "\n")
		if len(lines) > 0 {
			output += "\n" // Add final newline
		}
	}

	// Write to file or stdout.
	if blockCaptureOutputFile != "" {
		if err := os.WriteFile(blockCaptureOutputFile, []byte(output), 0644); err != nil {
			return fmt.Errorf("error writing to file %s: %w", blockCaptureOutputFile, err)
		}
		WriteStdout("block capture written to %s (%d lines)\n", blockCaptureOutputFile, len(lines))
	} else {
		WriteStdout("%s", output)
	}

	return nil
}

// termGetScrollback fetches terminal scrollback for blockId via the frontend
// block route used by capture and wait --contains/--idle.
func termGetScrollback(blockId string, lineStart, lineEnd int, lastCommand bool) (*wshrpc.CommandTermGetScrollbackLinesRtnData, error) {
	result, err := wshclient.TermGetScrollbackLinesCommand(RpcClient, wshrpc.CommandTermGetScrollbackLinesData{
		LineStart:   lineStart,
		LineEnd:     lineEnd,
		LastCommand: lastCommand,
	}, &wshrpc.RpcOpts{
		Route:   wshutil.MakeFeBlockRouteId(blockId),
		Timeout: 5000,
	})
	if err != nil {
		return nil, fmt.Errorf("error getting terminal scrollback: %w", err)
	}
	return result, nil
}

// blockStatusJSONOutput is the structured output shape for `block status --json`.
type blockStatusJSONOutput struct {
	ProcessState string `json:"processstate"`
	ExitCode     int    `json:"exitcode"`
	Connection   string `json:"connection"`
	ConnStatus   string `json:"connstatus"`
}

// validateSendKeysInput enforces that the positional text argument and --secret
// are mutually exclusive input sources.
func validateSendKeysInput(textSet bool, secret string) error {
	if textSet && secret != "" {
		return fmt.Errorf("cannot specify both a text argument and --secret")
	}
	return nil
}

// decodeEscapes interprets backslash escape sequences in text: \uXXXX (exactly
// 4 hex digits -> Unicode code point), \n (0x0a), \t (0x09), \r (0x0d), and \\
// (a literal backslash). Any other backslash sequence is an error. Characters
// without a preceding backslash are passed through unchanged.
func decodeEscapes(text string) (string, error) {
	var sb strings.Builder
	sb.Grow(len(text))
	for i := 0; i < len(text); i++ {
		ch := text[i]
		if ch != '\\' {
			sb.WriteByte(ch)
			continue
		}
		if i+1 >= len(text) {
			return "", fmt.Errorf("invalid escape sequence: trailing backslash")
		}
		i++
		switch text[i] {
		case '\\':
			sb.WriteByte('\\')
		case 'n':
			sb.WriteByte('\n')
		case 't':
			sb.WriteByte('\t')
		case 'r':
			sb.WriteByte('\r')
		case 'u':
			if i+4 >= len(text) {
				return "", fmt.Errorf("invalid escape sequence: \\u requires exactly 4 hex digits")
			}
			hexStr := text[i+1 : i+5]
			code, err := strconv.ParseUint(hexStr, 16, 32)
			if err != nil {
				return "", fmt.Errorf("invalid escape sequence: \\u%s is not valid hex", hexStr)
			}
			sb.WriteRune(rune(code))
			i += 4
		default:
			return "", fmt.Errorf("invalid escape sequence: \\%c", text[i])
		}
	}
	return sb.String(), nil
}

// appendEnter appends the Enter key (0x0d) to input when enter is true.
func appendEnter(input []byte, enter bool) []byte {
	if enter {
		return append(input, '\r')
	}
	return input
}

// assembleInputBytes builds the byte slice to send: it optionally decodes
// --escapes sequences in text and optionally appends the Enter key.
func assembleInputBytes(text string, enter, escapes bool) ([]byte, error) {
	if escapes {
		decoded, err := decodeEscapes(text)
		if err != nil {
			return nil, err
		}
		text = decoded
	}
	return appendEnter([]byte(text), enter), nil
}

// mapProcessState maps a block controller's ShellProcStatus to the
// "processstate" JSON field. "done" maps to "exited"; every other value
// ("running", "init", and any unknown/empty value) maps to "running", because
// the process is not known to have exited.
func mapProcessState(shellProcStatus string) string {
	if shellProcStatus == "done" {
		return "exited"
	}
	return "running"
}

// lookupConnStatus reports the connection status string for connection based on
// connStatuses. Local connections (empty, "local", or "local:"/"wsl://"
// prefixed) are always "connected". Otherwise the entry matching connection is
// used: "connected" if it reports Connected, else its Status (or "disconnected"
// if the entry has no status). If no entry matches, "disconnected" is returned.
func lookupConnStatus(connStatuses []wshrpc.ConnStatus, connection string) string {
	if !isNonLocalConnName(connection) {
		return "connected"
	}
	for _, cs := range connStatuses {
		if cs.Connection == connection {
			if cs.Connected {
				return "connected"
			}
			if cs.Status != "" {
				return cs.Status
			}
			return "disconnected"
		}
	}
	return "disconnected"
}

// getTermBlockMeta resolves the block ref and returns its metadata, verifying
// the block is a terminal block. Both send-keys and status share this check.
func getTermBlockMeta(blockRef string) (*waveobj.ORef, waveobj.MetaMapType, error) {
	fullORef, err := resolveBlockArgWithOverride(blockRef)
	if err != nil {
		return nil, nil, err
	}
	metaData, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{
		ORef: *fullORef,
	}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return nil, nil, fmt.Errorf("error getting block metadata: %w", err)
	}
	viewType, ok := metaData[waveobj.MetaKey_View].(string)
	if !ok || viewType != "term" {
		return nil, nil, fmt.Errorf("block %s is not a terminal block (view type: %s)", fullORef.OID, viewType)
	}
	return fullORef, metaData, nil
}

// tabRouteForBlock returns the tab:<tabid> route for a block. Prefers the
// block's owning tab (BlockInfo) so send-keys/screenshot work across tabs;
// falls back to WAVETERM_TABID. Empty string means no route is available.
func tabRouteForBlock(blockId string) string {
	blockTabId := ""
	info, err := wshclient.BlockInfoCommand(RpcClient, blockId, &wshrpc.RpcOpts{Timeout: 2000})
	if err == nil && info != nil {
		blockTabId = info.TabId
	}
	tabId := pickTabIdForBlockRoute(blockTabId, getTabIdFromEnv())
	if tabId == "" {
		return ""
	}
	return wshutil.MakeTabRouteId(tabId)
}

// pickTabIdForBlockRoute prefers the block's owning tab over the CLI process
// WAVETERM_TABID so send-keys/screenshot route to the tab that hosts the block.
func pickTabIdForBlockRoute(blockTabId, envTabId string) string {
	if blockTabId != "" {
		return blockTabId
	}
	return envTabId
}

// checkSendKeysHumanInput refuses send-keys when a human typed in the block
// within sendKeysHumanInputGuardMs. RPC failures fail open (proceed) so
// older frontends that lack GetBlockInputState still work. The input-state
// RPC is handled by the tab client, so it must be routed to the block's tab
// (not a feblock: route, and not a different tab's route).
func checkSendKeysHumanInput(blockId string) error {
	route := tabRouteForBlock(blockId)
	if route == "" {
		return nil
	}
	state, err := wshclient.GetBlockInputStateCommand(RpcClient, blockId, &wshrpc.RpcOpts{
		Route:   route,
		Timeout: 2000,
	})
	if err != nil || state == nil {
		return nil
	}
	ago, refuse := shouldRefuseSendKeys(state.LastUserInputMs, time.Now().UnixMilli(), sendKeysHumanInputGuardMs)
	if refuse {
		return fmt.Errorf("refusing send-keys: human typed in this block %dms ago (pass --force to override)", ago)
	}
	return nil
}

// shouldRefuseSendKeys reports whether lastUserInputMs is within guardMs of
// nowMs. lastUserInputMs <= 0 means no recorded human input.
func shouldRefuseSendKeys(lastUserInputMs, nowMs, guardMs int64) (ago int64, refuse bool) {
	if lastUserInputMs <= 0 {
		return 0, false
	}
	ago = nowMs - lastUserInputMs
	return ago, ago < guardMs
}

func blockSendKeysRun(cmd *cobra.Command, args []string) error {
	blockRef := ""
	text := ""
	textSet := false
	if len(args) > 0 {
		blockRef = args[0]
	}
	if len(args) > 1 {
		text = args[1]
		textSet = true
	}
	if err := validateSendKeysInput(textSet, blockSendKeysSecret); err != nil {
		return err
	}

	fullORef, _, err := getTermBlockMeta(blockRef)
	if err != nil {
		return err
	}

	if !blockSendKeysForce {
		if err := checkSendKeysHumanInput(fullORef.OID); err != nil {
			return err
		}
	}

	// Build the input bytes. The secret value is never logged or printed.
	var input []byte
	if blockSendKeysSecret != "" {
		secrets, err := wshclient.GetSecretsCommand(RpcClient, []string{blockSendKeysSecret}, &wshrpc.RpcOpts{Timeout: 2000})
		if err != nil {
			return fmt.Errorf("error resolving secret %q: %w", blockSendKeysSecret, err)
		}
		value, ok := secrets[blockSendKeysSecret]
		if !ok {
			return fmt.Errorf("secret %q not found", blockSendKeysSecret)
		}
		input = appendEnter([]byte(value), blockSendKeysEnter)
	} else {
		input, err = assembleInputBytes(text, blockSendKeysEnter, blockSendKeysEscapes)
		if err != nil {
			return err
		}
	}

	log.Printf("[agent-audit] send-keys block=%s force=%v\n", fullORef.OID, blockSendKeysForce)
	err = wshclient.ControllerInputCommand(RpcClient, wshrpc.CommandBlockInputData{
		BlockId:     fullORef.OID,
		InputData64: base64.StdEncoding.EncodeToString(input),
	}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("error sending input to block %s: %w", fullORef.OID, err)
	}
	return nil
}

func blockStatusRun(cmd *cobra.Command, args []string) error {
	blockRef := ""
	if len(args) > 0 {
		blockRef = args[0]
	}
	fullORef, metaData, err := getTermBlockMeta(blockRef)
	if err != nil {
		return err
	}

	status, err := wshclient.BlockControllerStatusCommand(RpcClient, fullORef.OID, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("error getting block status: %w", err)
	}
	if status == nil {
		return fmt.Errorf("block %s has no running controller", fullORef.OID)
	}

	processState := mapProcessState(status.ShellProcStatus)
	exitCode := status.ShellProcExitCode
	connection := status.ShellProcConnName
	if connection == "" {
		connection = metaData.GetString(waveobj.MetaKey_Connection, "")
	}
	if connection == "" {
		connection = "local"
	}

	// Local connections are always connected; only query the connection status
	// for genuinely remote connections.
	connStatus := "connected"
	if isNonLocalConnName(connection) {
		connStatuses, err := wshclient.ConnStatusCommand(RpcClient, nil)
		if err != nil {
			return fmt.Errorf("error getting connection status: %w", err)
		}
		connStatus = lookupConnStatus(connStatuses, connection)
	}

	if blockStatusJSON {
		outBytes, err := json.MarshalIndent(blockStatusJSONOutput{
			ProcessState: processState,
			ExitCode:     exitCode,
			Connection:   connection,
			ConnStatus:   connStatus,
		}, "", "  ")
		if err != nil {
			return fmt.Errorf("marshaling JSON output: %w", err)
		}
		WriteStdout("%s\n", string(outBytes))
		return nil
	}

	WriteStdout("process state: %s\n", processState)
	WriteStdout("exit code: %d\n", exitCode)
	WriteStdout("connection: %s\n", connection)
	WriteStdout("conn status: %s\n", connStatus)
	return nil
}

// blockNewOptions holds the parsed options for creating a new block. It is
// shared between `block new` and `block split` (which is thin sugar over
// `block new --split`).
type blockNewOptions struct {
	viewType   string
	connection string
	cmd        string
	magnified  bool
	split      string
	relativeTo string
	tabRef     string
	focused    bool
	extraMeta  waveobj.MetaMapType
}

// blockNewJSONOutput is the structured output shape for `block new` and
// `block split --json`. Geometry is not yet reported (Phase 3); for now only
// the block id is returned.
type blockNewJSONOutput struct {
	BlockId string `json:"blockid"`
}

func blockNewRun(cmd *cobra.Command, args []string) error {
	oref, err := createBlockNew(blockNewOptions{
		viewType:   blockNewView,
		connection: blockNewConnection,
		cmd:        blockNewCmdStr,
		magnified:  blockNewMagnified,
		split:      blockNewSplit,
		relativeTo: blockNewRelativeTo,
		tabRef:     blockNewTab,
		focused:    !blockNewNoFocus,
	})
	if err != nil {
		return err
	}
	return writeBlockNewOutput(oref, blockNewJSON)
}

func blockSplitRun(cmd *cobra.Command, args []string) error {
	blockRef := args[0]
	direction := blockSplitDirection
	if direction == "" {
		return fmt.Errorf("--direction is required (one of: left, right, above, below)")
	}
	if _, err := directionToTargetAction(direction); err != nil {
		return err
	}
	oref, err := createBlockNew(blockNewOptions{
		viewType:   "term",
		split:      direction,
		relativeTo: blockRef,
		focused:    true,
	})
	if err != nil {
		return err
	}
	return writeBlockNewOutput(oref, blockSplitJSON)
}

func blockRenameRun(cmd *cobra.Command, args []string) error {
	blockRef, name, err := validateRenameArgs(args)
	if err != nil {
		return err
	}
	fullORef, err := resolveBlockArgWithOverride(blockRef)
	if err != nil {
		return err
	}
	err = wshclient.SetMetaCommand(RpcClient, wshrpc.CommandSetMetaData{
		ORef: *fullORef,
		Meta: waveobj.MetaMapType{
			waveobj.MetaKey_FrameTitle: name,
		},
	}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("setting block title: %w", err)
	}
	WriteStdout("renamed block %s to %q\n", fullORef.OID, name)
	return nil
}

// createBlockNew builds and submits a CommandCreateBlockData for the given
// options, returning the created block ORef.
func createBlockNew(opts blockNewOptions) (waveobj.ORef, error) {
	if err := validateSplitPair(opts.split, opts.relativeTo); err != nil {
		return waveobj.ORef{}, err
	}

	var targetBlockId, targetAction string
	if opts.split != "" {
		targetOref, err := resolveBlockArgWithOverride(opts.relativeTo)
		if err != nil {
			return waveobj.ORef{}, err
		}
		targetBlockId = targetOref.OID
		targetAction, err = directionToTargetAction(opts.split)
		if err != nil {
			return waveobj.ORef{}, err
		}
	}

	tabId, err := resolveTabIdArg(opts.tabRef)
	if err != nil {
		return waveobj.ORef{}, err
	}

	cwd, err := os.Getwd()
	if err != nil {
		return waveobj.ORef{}, fmt.Errorf("getting current directory: %w", err)
	}
	cwd, err = filepath.Abs(cwd)
	if err != nil {
		return waveobj.ORef{}, fmt.Errorf("getting absolute path: %w", err)
	}

	connName := opts.connection
	if connName == "" {
		connName = RpcContext.Conn
	}

	meta := buildBlockNewMeta(opts.viewType, opts.cmd, cwd, connName)
	for k, v := range opts.extraMeta {
		meta[k] = v
	}
	blockDef := &waveobj.BlockDef{Meta: meta}
	if opts.cmd != "" {
		blockDef.Files = map[string]*waveobj.FileDef{
			wavebase.BlockFile_Env: {
				Content: buildEnvContent(os.Environ()),
			},
		}
	}

	createData := wshrpc.CommandCreateBlockData{
		TabId:         tabId,
		BlockDef:      blockDef,
		Magnified:     opts.magnified,
		Focused:       opts.focused,
		TargetBlockId: targetBlockId,
		TargetAction:  targetAction,
	}

	oref, err := wshclient.CreateBlockCommand(RpcClient, createData, nil)
	if err != nil {
		return waveobj.ORef{}, fmt.Errorf("creating new block: %w", err)
	}
	return oref, nil
}

// writeBlockNewOutput prints the created block ref, or a JSON object when
// jsonOut is set.
func writeBlockNewOutput(oref waveobj.ORef, jsonOut bool) error {
	if jsonOut {
		outBytes, err := json.Marshal(blockNewJSONOutput{BlockId: oref.OID})
		if err != nil {
			return fmt.Errorf("marshaling JSON output: %w", err)
		}
		WriteStdout("%s\n", string(outBytes))
		return nil
	}
	WriteStdout("block created: %s\n", oref)
	return nil
}

// directionToTargetAction maps a user-facing split direction to the
// CommandCreateBlockData TargetAction used by the backend.
func directionToTargetAction(direction string) (string, error) {
	switch direction {
	case "left":
		return "splitleft", nil
	case "right":
		return "splitright", nil
	case "above":
		return "splitup", nil
	case "below":
		return "splitdown", nil
	default:
		return "", fmt.Errorf("invalid direction %q (must be one of: left, right, above, below)", direction)
	}
}

// validateSplitPair enforces that --split and --relative-to are used together.
func validateSplitPair(split, relativeTo string) error {
	if split != "" && relativeTo == "" {
		return fmt.Errorf("--split requires --relative-to")
	}
	if split == "" && relativeTo != "" {
		return fmt.Errorf("--relative-to requires --split")
	}
	return nil
}

// buildBlockNewMeta builds the block metadata for `wsh block new`. When cmd is
// empty and the view is a terminal, it creates a plain terminal (controller
// "shell"); when cmd is set it creates a persistent command block (controller
// "cmd", runs on start, no close-on-exit).
func buildBlockNewMeta(viewType, cmd, cwd, connection string) waveobj.MetaMapType {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_View: viewType,
	}
	if cmd != "" {
		meta[waveobj.MetaKey_Controller] = "cmd"
		meta[waveobj.MetaKey_CmdCwd] = cwd
		meta[waveobj.MetaKey_CmdClearOnStart] = true
		meta[waveobj.MetaKey_Cmd] = cmd
		meta[waveobj.MetaKey_CmdArgs] = []string{}
		meta[waveobj.MetaKey_CmdShell] = true
		meta[waveobj.MetaKey_CmdRunOnStart] = true
	} else if viewType == "term" {
		meta[waveobj.MetaKey_Controller] = "shell"
		meta[waveobj.MetaKey_CmdCwd] = cwd
	}
	if connection != "" {
		meta[waveobj.MetaKey_Connection] = connection
	}
	return meta
}

// buildEnvContent converts the given environment strings (os.Environ format,
// "KEY=VALUE") into the null-terminated block env file format.
func buildEnvContent(environ []string) string {
	envMap := make(map[string]string)
	for _, envStr := range environ {
		env := strings.SplitN(envStr, "=", 2)
		if len(env) == 2 {
			envMap[env[0]] = env[1]
		}
	}
	return envutil.MapToEnv(envMap)
}

// validateRenameArgs enforces the two-positional-arg requirement for rename
// and that the new name is non-empty.
func validateRenameArgs(args []string) (blockRef, name string, err error) {
	if len(args) != 2 {
		return "", "", fmt.Errorf("rename requires exactly 2 arguments: <block_ref> and <name>")
	}
	if args[1] == "" {
		return "", "", fmt.Errorf("block name must not be empty")
	}
	return args[0], args[1], nil
}

// resolveTabIdArg resolves a --tab argument to a tab id. An empty ref returns
// the current tab from the environment. A full tab ORef is validated and its
// id returned; a bare uuid is passed through as a tab id; any other ref
// (e.g. tab:N) is resolved via resolveSimpleId and must resolve to a tab.
func resolveTabIdArg(tabRef string) (string, error) {
	if tabRef == "" {
		tabId := getTabIdFromEnv()
		if tabId == "" {
			return "", fmt.Errorf("no WAVETERM_TABID env var set (use --tab)")
		}
		return tabId, nil
	}
	if isFullORef(tabRef) {
		oref, err := waveobj.ParseORef(tabRef)
		if err != nil {
			return "", err
		}
		if oref.OType != waveobj.OType_Tab {
			return "", fmt.Errorf("--tab %q is a %s, expected a tab", tabRef, oref.OType)
		}
		return oref.OID, nil
	}
	if _, err := uuid.Parse(tabRef); err == nil {
		return tabRef, nil
	}
	oref, err := resolveSimpleId(tabRef)
	if err != nil {
		return "", fmt.Errorf("resolving tab ref %q: %w", tabRef, err)
	}
	if oref.OType != waveobj.OType_Tab {
		return "", fmt.Errorf("--tab %q resolved to a %s, expected a tab", tabRef, oref.OType)
	}
	return oref.OID, nil
}

// blockScreenshotJSONOutput is the structured output for `block screenshot --json`.
type blockScreenshotJSONOutput struct {
	BlockId string `json:"blockid"`
	Bytes   int    `json:"bytes"`
	Path    string `json:"path,omitempty"`
}

// validateScreenshotFlags requires --output unless --json is set.
func validateScreenshotFlags(outputFile string, jsonOut bool) error {
	if outputFile == "" && !jsonOut {
		return fmt.Errorf("--output is required unless --json is set")
	}
	return nil
}

// decodeScreenshotPNG strips a data:image/png;base64, prefix if present and
// base64-decodes the PNG bytes.
func decodeScreenshotPNG(dataURL string) ([]byte, error) {
	s := strings.TrimSpace(dataURL)
	if s == "" {
		return nil, fmt.Errorf("empty screenshot data")
	}
	if strings.HasPrefix(s, pngDataURLPrefix) {
		s = strings.TrimPrefix(s, pngDataURLPrefix)
	} else if strings.HasPrefix(s, "data:") {
		if i := strings.Index(s, ","); i >= 0 {
			s = s[i+1:]
		}
	}
	decoded, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("decoding screenshot: %w", err)
	}
	if len(decoded) == 0 {
		return nil, fmt.Errorf("empty screenshot data")
	}
	return decoded, nil
}

func blockScreenshotRun(cmd *cobra.Command, args []string) error {
	if err := validateScreenshotFlags(blockScreenshotOutput, blockScreenshotJSON); err != nil {
		return err
	}

	blockRef := ""
	if len(args) > 0 {
		blockRef = args[0]
	}
	fullORef, err := resolveBlockArgWithOverride(blockRef)
	if err != nil {
		return err
	}

	route := tabRouteForBlock(fullORef.OID)
	if route == "" {
		return fmt.Errorf("no WAVETERM_TABID env var set")
	}

	dataURL, err := wshclient.CaptureBlockScreenshotCommand(RpcClient, wshrpc.CommandCaptureBlockScreenshotData{
		BlockId: fullORef.OID,
	}, &wshrpc.RpcOpts{
		Route:   route,
		Timeout: 10000,
	})
	if err != nil {
		return fmt.Errorf("capturing screenshot of block %s: %w", fullORef.OID, err)
	}

	pngBytes, err := decodeScreenshotPNG(dataURL)
	if err != nil {
		return err
	}

	if blockScreenshotOutput != "" {
		if err := os.WriteFile(blockScreenshotOutput, pngBytes, 0644); err != nil {
			return fmt.Errorf("error writing screenshot to %s: %w", blockScreenshotOutput, err)
		}
	}

	if blockScreenshotJSON {
		out := blockScreenshotJSONOutput{
			BlockId: fullORef.OID,
			Bytes:   len(pngBytes),
		}
		if blockScreenshotOutput != "" {
			out.Path = blockScreenshotOutput
		}
		outBytes, err := json.Marshal(out)
		if err != nil {
			return fmt.Errorf("marshaling JSON output: %w", err)
		}
		WriteStdout("%s\n", string(outBytes))
		return nil
	}

	WriteStdout("screenshot written to %s (%d bytes)\n", blockScreenshotOutput, len(pngBytes))
	return nil
}
