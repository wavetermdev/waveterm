// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const (
	agentPromptPollInterval = 100 * time.Millisecond
	agentPromptTimeout      = 5 * time.Second
	agentHelpDocVersion     = 3
)

// agentCmd is the "agent" command group, the entry point for the Agent Control
// Fabric. It exposes spawn/list/stop/context plus help (discovery).
var agentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Agent control fabric commands",
	Long: `Commands for AI coding agents orchestrating Wave Terminal.

Use "wsh agent help" to discover the full set of agent-capable commands
across wsh. Use "wsh agent context --json" to orient in one shot.`,
}

var agentSpawnCmd = &cobra.Command{
	Use:   "spawn",
	Short: "Spawn an agent in a new terminal block",
	Long: `Spawn an agent process (e.g. claude, pi) in a new terminal block.

This is syntactic sugar over "wsh block new --view term --cmd". The block is
created with the given command running as a persistent process and tagged
agent:owned so "wsh agent list/stop" can manage it. The new block does not
steal focus unless --focus is passed.

Use --prompt to send an initial prompt once the block controller is running
(this is not a guarantee the agent's REPL is ready). Use --split to create the
block by splitting an existing block; without --relative-to the split is made
relative to the currently focused block. --idempotency-key reuses a still-
running owned block with the same key instead of creating another.`,
	Example: "  wsh agent spawn --connection prod --cmd \"claude\"\n" +
		"  wsh agent spawn --connection prod --cmd \"claude\" --prompt \"Fix the build error\"\n" +
		"  wsh agent spawn --cmd \"claude\" --split right --name claude-prod",
	Args:                  cobra.NoArgs,
	RunE:                  agentSpawnRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var agentHelpCmd = &cobra.Command{
	Use:   "help",
	Short: "List agent-capable commands",
	Long: `Print a reference of every agent-capable command in wsh, with a
one-line description and a short example each. Intended for discovery: an
agent that starts here can pattern-match onto the commands it needs.

Use --json for a versioned capability document (env vars + commands).`,
	Args: cobra.NoArgs,
	RunE: agentHelpRun,
}

var agentContextCmd = &cobra.Command{
	Use:   "context",
	Short: "One-shot orientation of the current workspace",
	Long: `Print a JSON snapshot of the current workspace: this block, the focused
block, tabs, connections, and blocks (with geometry and best-effort process
state). Always JSON. Use this as the first command after detecting WAVETERM=1.`,
	Args:                  cobra.NoArgs,
	RunE:                  agentContextRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var agentListCmd = &cobra.Command{
	Use:   "list",
	Short: "List agent-owned blocks",
	Long: `List blocks tagged agent:owned=true (created by "wsh agent spawn").
Human output is a table of blockid, title, cmd, and connection.`,
	Args:                  cobra.NoArgs,
	RunE:                  agentListRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var agentStopCmd = &cobra.Command{
	Use:   "stop [block_ref]",
	Short: "Stop an agent-owned block",
	Long: `Delete an agent-owned block. With no argument, stops every owned block
in the current workspace. Refuses to stop a block that is not agent-owned
unless --force is passed.`,
	Args:                  cobra.MaximumNArgs(1),
	RunE:                  agentStopRun,
	PreRunE:               preRunSetupRpcClient,
	DisableFlagsInUseLine: true,
}

var (
	agentSpawnConnection     string
	agentSpawnCmdStr         string
	agentSpawnPrompt         string
	agentSpawnSplit          string
	agentSpawnRelativeTo     string
	agentSpawnJSON           bool
	agentSpawnFocus          bool
	agentSpawnName           string
	agentSpawnIdempotencyKey string
	agentHelpJSON            bool
	agentContextJSON         bool
	agentListJSON            bool
	agentStopForce           bool
)

func init() {
	agentSpawnCmd.Flags().StringVar(&agentSpawnConnection, "connection", "", "connection name to attach the block to")
	agentSpawnCmd.Flags().StringVar(&agentSpawnCmdStr, "cmd", "", "agent command to run in the block (required)")
	agentSpawnCmd.Flags().StringVar(&agentSpawnPrompt, "prompt", "", "prompt text to send to the spawned agent")
	agentSpawnCmd.Flags().StringVar(&agentSpawnSplit, "split", "", "split direction: left, right, above, below (defaults to relative to the focused block)")
	agentSpawnCmd.Flags().StringVar(&agentSpawnRelativeTo, "relative-to", "", "block reference to split (requires --split)")
	agentSpawnCmd.Flags().BoolVar(&agentSpawnJSON, "json", false, "output as JSON")
	agentSpawnCmd.Flags().BoolVar(&agentSpawnFocus, "focus", false, "steal focus for the new block (default: no-focus)")
	agentSpawnCmd.Flags().StringVar(&agentSpawnName, "name", "", "set the block title (frame:title) for title-substring addressing")
	agentSpawnCmd.Flags().StringVar(&agentSpawnIdempotencyKey, "idempotency-key", "", "reuse a still-running owned block with this key instead of creating another")

	agentHelpCmd.Flags().BoolVar(&agentHelpJSON, "json", false, "print a versioned JSON capability document")
	agentContextCmd.Flags().BoolVar(&agentContextJSON, "json", false, "output as JSON (always JSON; accepted for consistency)")
	agentListCmd.Flags().BoolVar(&agentListJSON, "json", false, "output as JSON")
	agentStopCmd.Flags().BoolVar(&agentStopForce, "force", false, "allow stopping a block that is not agent-owned")

	agentCmd.AddCommand(agentSpawnCmd)
	agentCmd.AddCommand(agentHelpCmd)
	agentCmd.AddCommand(agentContextCmd)
	agentCmd.AddCommand(agentListCmd)
	agentCmd.AddCommand(agentStopCmd)
	rootCmd.AddCommand(agentCmd)
}

func agentSpawnRun(cmd *cobra.Command, args []string) error {
	if agentSpawnCmdStr == "" {
		return fmt.Errorf("--cmd is required (the agent command to run)")
	}

	if agentSpawnIdempotencyKey != "" {
		existing, ok, err := findExistingIdempotentBlock(agentSpawnIdempotencyKey)
		if err != nil {
			return err
		}
		if ok {
			log.Printf("[agent-audit] spawn block=%s cmd=%s\n", existing.OID, agentSpawnCmdStr)
			return writeBlockNewOutput(existing, agentSpawnJSON)
		}
	}

	// Resolve the focused block only when needed: --split without --relative-to
	// defaults to splitting relative to the currently focused block.
	focusedBlockId := ""
	if agentSpawnSplit != "" && agentSpawnRelativeTo == "" {
		focused, err := getFocusedBlockId()
		if err != nil {
			return err
		}
		focusedBlockId = focused
	}

	relativeTo, err := resolveAgentSplitRelativeTo(agentSpawnSplit, agentSpawnRelativeTo, focusedBlockId)
	if err != nil {
		return err
	}

	oref, err := createBlockNew(blockNewOptions{
		viewType:   "term",
		connection: agentSpawnConnection,
		cmd:        agentSpawnCmdStr,
		magnified:  false,
		split:      agentSpawnSplit,
		relativeTo: relativeTo,
		tabRef:     "",
		focused:    agentSpawnFocus,
		extraMeta:  buildAgentSpawnExtraMeta(agentSpawnCmdStr, agentSpawnName, os.Getenv("WAVETERM_BLOCKID"), agentSpawnIdempotencyKey),
	})
	if err != nil {
		return err
	}

	log.Printf("[agent-audit] spawn block=%s cmd=%s\n", oref.OID, agentSpawnCmdStr)

	if agentSpawnPrompt != "" {
		if err := sendPromptToBlock(oref.OID, agentSpawnPrompt); err != nil {
			return err
		}
	}

	return writeBlockNewOutput(oref, agentSpawnJSON)
}

// buildAgentSpawnExtraMeta returns the agent:* (and optional frame:title) meta
// merged into a spawned block. parentBlockId and idempotencyKey are omitted
// when empty. Secrets must never be placed in these fields.
func buildAgentSpawnExtraMeta(cmdStr, name, parentBlockId, idempotencyKey string) waveobj.MetaMapType {
	meta := waveobj.MetaMapType{
		waveobj.MetaKey_AgentOwned: true,
		waveobj.MetaKey_AgentCmd:   cmdStr,
	}
	if parentBlockId != "" {
		meta[waveobj.MetaKey_AgentParent] = parentBlockId
	}
	if idempotencyKey != "" {
		meta[waveobj.MetaKey_AgentIdempotencyKey] = idempotencyKey
	}
	if name != "" {
		meta[waveobj.MetaKey_FrameTitle] = name
	}
	return meta
}

// agentIdempotencyEntry is a reduced block view used by the idempotency-key
// lookup helper (so tests do not need live RPCs).
type agentIdempotencyEntry struct {
	BlockId      string
	Key          string
	StillRunning bool
}

// findRunningBlockWithIdempotencyKey returns the first still-running block
// whose agent:idempotency-key matches key. An empty key never matches.
func findRunningBlockWithIdempotencyKey(entries []agentIdempotencyEntry, key string) string {
	if key == "" {
		return ""
	}
	for _, e := range entries {
		if e.Key == key && e.StillRunning {
			return e.BlockId
		}
	}
	return ""
}

// isControllerStillRunning reports whether a block controller is not done.
// A missing controller (err != nil or nil status) is treated as not running.
func isControllerStillRunning(status *wshrpc.BlockControllerStatusData, err error) bool {
	if err != nil || status == nil {
		return false
	}
	return status.ShellProcStatus != "done"
}

func findExistingIdempotentBlock(key string) (waveobj.ORef, bool, error) {
	if key == "" {
		return waveobj.ORef{}, false, nil
	}
	entries, err := listBlockEntries("")
	if err != nil {
		return waveobj.ORef{}, false, err
	}
	reduced := make([]agentIdempotencyEntry, 0, len(entries))
	for _, e := range entries {
		status, statusErr := wshclient.BlockControllerStatusCommand(RpcClient, e.BlockId, &wshrpc.RpcOpts{Timeout: 2000})
		reduced = append(reduced, agentIdempotencyEntry{
			BlockId:      e.BlockId,
			Key:          e.Meta.GetString(waveobj.MetaKey_AgentIdempotencyKey, ""),
			StillRunning: isControllerStillRunning(status, statusErr),
		})
	}
	blockId := findRunningBlockWithIdempotencyKey(reduced, key)
	if blockId == "" {
		return waveobj.ORef{}, false, nil
	}
	return waveobj.ORef{OType: waveobj.OType_Block, OID: blockId}, true, nil
}

// resolveAgentSplitRelativeTo returns the effective relative-to block reference
// for a split. It enforces the same pairing rules as validateSplitPair, with one
// exception: a --split given without --relative-to defaults to focusedBlockId
// (the focused block). focusedBlockId is empty when no focused block was
// resolved, which is an error for that case.
func resolveAgentSplitRelativeTo(split, relativeTo, focusedBlockId string) (string, error) {
	if split == "" && relativeTo == "" {
		return "", nil
	}
	if split == "" && relativeTo != "" {
		return "", fmt.Errorf("--relative-to requires --split")
	}
	if relativeTo != "" {
		return relativeTo, nil
	}
	// split != "" && relativeTo == ""
	if focusedBlockId == "" {
		return "", fmt.Errorf("--split requires --relative-to (no focused block available)")
	}
	return focusedBlockId, nil
}

// getFocusedBlockId returns the block id of the currently focused block via the
// getfocusedblockdata RPC. That RPC is handled by the frontend (tab) client, so
// it must be routed to the current tab.
func getFocusedBlockId() (string, error) {
	tabId := getTabIdFromEnv()
	if tabId == "" {
		return "", fmt.Errorf("no tab id specified (set WAVETERM_TABID environment variable)")
	}
	focused, err := wshclient.GetFocusedBlockDataCommand(RpcClient, &wshrpc.RpcOpts{
		Route:   fmt.Sprintf("tab:%s", tabId),
		Timeout: 2000,
	})
	if err != nil {
		return "", fmt.Errorf("getting focused block: %w", err)
	}
	if focused == nil || focused.BlockId == "" {
		return "", fmt.Errorf("no focused block (use --relative-to to specify one)")
	}
	return focused.BlockId, nil
}

// assemblePromptInput appends the Enter key (0x0d) to the prompt text so the
// agent's REPL actually executes the prompt.
func assemblePromptInput(prompt string) string {
	return prompt + "\r"
}

// sendPromptToBlock waits for the block controller to reach the "running" state
// and then sends the prompt (plus Enter) to the block. Polling is required
// because the block's controller may not be ready immediately after
// createBlockNew returns; sending input too early fails with "no controller
// found for block <id>".
func sendPromptToBlock(blockId, prompt string) error {
	deadline := time.Now().Add(agentPromptTimeout)
	for {
		status, err := wshclient.BlockControllerStatusCommand(RpcClient, blockId, &wshrpc.RpcOpts{Timeout: 2000})
		if err == nil && status != nil {
			if status.ShellProcStatus == "running" {
				break
			}
			if status.ShellProcStatus == "done" {
				return fmt.Errorf("block %s controller exited before the prompt could be sent (exit code %d)", blockId, status.ShellProcExitCode)
			}
		}
		if time.Now().After(deadline) {
			lastStatus := "unknown"
			if status != nil {
				lastStatus = status.ShellProcStatus
			}
			return fmt.Errorf("timed out waiting for block %s controller to start (last status: %s)", blockId, lastStatus)
		}
		time.Sleep(agentPromptPollInterval)
	}

	input := assemblePromptInput(prompt)
	err := wshclient.ControllerInputCommand(RpcClient, wshrpc.CommandBlockInputData{
		BlockId:     blockId,
		InputData64: base64.StdEncoding.EncodeToString([]byte(input)),
	}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("sending prompt to block %s: %w", blockId, err)
	}
	return nil
}

func agentHelpRun(cmd *cobra.Command, args []string) error {
	if agentHelpJSON {
		out, err := json.MarshalIndent(buildAgentHelpDoc(), "", "  ")
		if err != nil {
			return fmt.Errorf("marshaling help JSON: %w", err)
		}
		WriteStdout("%s\n", string(out))
		return nil
	}
	WriteStdout("%s", agentHelpText)
	return nil
}

// agentHelpEnvVar is one environment variable in the capability document.
type agentHelpEnvVar struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// agentHelpCommand is one command entry in the capability document.
type agentHelpCommand struct {
	Command string `json:"command"`
	Summary string `json:"summary"`
	Example string `json:"example"`
}

// agentHelpDoc is the versioned capability document printed by
// `wsh agent help --json`.
type agentHelpDoc struct {
	Version  int                `json:"version"`
	EnvVars  []agentHelpEnvVar  `json:"envvars"`
	Commands []agentHelpCommand `json:"commands"`
}

func buildAgentHelpDoc() agentHelpDoc {
	return agentHelpDoc{
		Version: agentHelpDocVersion,
		EnvVars: []agentHelpEnvVar{
			{Name: "WAVETERM", Description: "set to 1 in every Wave Terminal / RemoteTerm session; detect the app with WAVETERM=1"},
			{Name: "WAVETERM_BLOCKID", Description: "id of the terminal block running this process"},
			{Name: "WAVETERM_TABID", Description: "id of the current tab"},
			{Name: "WAVETERM_CONN", Description: "connection name for this session (empty or local when local)"},
			{Name: "WAVETERM_VERSION", Description: "Wave Terminal version string"},
			{Name: "WAVETERM_WORKSPACEID", Description: "id of the current workspace"},
		},
		Commands: agentHelpCommands,
	}
}

var agentHelpCommands = []agentHelpCommand{
	{Command: "wsh agent context --json", Summary: "one-shot orientation: workspace, tabs, blocks, connections, focused block", Example: "wsh agent context --json"},
	{Command: "wsh agent help --json", Summary: "versioned capability document (this output)", Example: "wsh agent help --json"},
	{Command: "wsh agent spawn", Summary: "spawn an owned terminal block (default no-focus); reuse via --idempotency-key", Example: "wsh agent spawn --cmd \"claude\" --name claude-prod --connection prod"},
	{Command: "wsh agent list", Summary: "list blocks tagged agent:owned", Example: "wsh agent list --json"},
	{Command: "wsh agent stop", Summary: "kill an owned block, or all owned blocks in the workspace", Example: "wsh agent stop"},
	{Command: "wsh run --wait --json", Summary: "Mode A: run a command, wait, print merged PTY output and exit code", Example: "wsh run --wait --json --timeout 2m -- npm test"},
	{Command: "wsh block list", Summary: "list blocks with geometry; --json includes cwd, index, focused", Example: "wsh block list --json"},
	{Command: "wsh block capture", Summary: "capture terminal scrollback; default last 200 lines, --all for the full buffer", Example: "wsh block capture this --json"},
	{Command: "wsh block send-keys", Summary: "type into a terminal block; --secret <name> never inlines values", Example: "wsh block send-keys this \"echo hi\" --enter"},
	{Command: "wsh block wait", Summary: "poll until exit, output contains a substring, or the buffer is idle", Example: "wsh block wait this --until-exit --timeout 60s"},
	{Command: "wsh block status", Summary: "process + connection status of a terminal block", Example: "wsh block status this --json"},
	{Command: "wsh block new", Summary: "create a block; default focuses, pass --no-focus to match agent defaults", Example: "wsh block new --view term --cmd \"htop\" --no-focus"},
	{Command: "wsh block split", Summary: "split a block left/right/above/below", Example: "wsh block split this --direction right"},
	{Command: "wsh block rename", Summary: "set frame:title so title-substring addressing works", Example: "wsh block rename this \"prod logs\""},
	{Command: "wsh block select", Summary: "focus a block (alias: focus)", Example: "wsh block select term:2"},
	{Command: "wsh block kill", Summary: "delete a block", Example: "wsh block kill this"},
	{Command: "wsh block screenshot", Summary: "capture a PNG of a block", Example: "wsh block screenshot this --output /tmp/block.png"},
	{Command: "wsh config get", Summary: "read a config value", Example: "wsh config get term:fontfamily --json"},
	{Command: "wsh config list", Summary: "list config keys with types and reload-required", Example: "wsh config list --json"},
	{Command: "wsh config set", Summary: "set a config value", Example: "wsh config set term:fontsize 14"},
	{Command: "wsh prompt", Summary: "ask the user a modal question; --default is used on timeout", Example: "wsh prompt \"Deploy?\" --options \"yes,no\" --default no"},
	{Command: "wsh connection list", Summary: "list SSH/WSL connections and status", Example: "wsh connection list --json"},
	{Command: "wsh tab list", Summary: "list tabs in the current workspace", Example: "wsh tab list --json"},
	{Command: "wsh tab new", Summary: "create a tab (activate defaults true)", Example: "wsh tab new --name build --json"},
	{Command: "wsh tab select", Summary: "activate a tab by id, tab:N, or name substring", Example: "wsh tab select tab:2"},
	{Command: "wsh tab close", Summary: "close a tab (errors if it is the last tab)", Example: "wsh tab close tab:2"},
	{Command: "wsh tab rename", Summary: "rename a tab", Example: "wsh tab rename tab:2 build"},
	{Command: "wsh file", Summary: "manage files locally and over SSH (ls/cat/write/cp/mv/rm)", Example: "wsh file ls wsh://user@host/home/user/"},
	{Command: "wsh view", Summary: "preview a file, directory, or URL in a new block", Example: "wsh view ./README.md"},
	{Command: "wsh edit", Summary: "open a file in the editor view", Example: "wsh edit ./main.go"},
	{Command: "wsh notify", Summary: "show a desktop notification", Example: "wsh notify \"tests passed\" --title ci"},
	{Command: "wsh web open", Summary: "open a URL in a web widget (not gated)", Example: "wsh web open https://example.com"},
	{Command: "wsh web get", Summary: "get HTML for a CSS selector in a web block (gated)", Example: "wsh web get -b <web-block> \".title\" --json"},
	{Command: "wsh web snapshot", Summary: "accessibility snapshot with @N refs (observation only; gated)", Example: "wsh web snapshot -b <web-block>"},
	{Command: "wsh web screenshot", Summary: "CDP PNG of the page (not block chrome); --path writes where wsh runs", Example: "wsh web screenshot -b <web-block> --path /tmp/page.png"},
	{Command: "wsh web run", Summary: "run a JS mini-API script against a web block (gated; snapshot then click/fill in one RPC)", Example: "wsh web run -b <web-block> -- 'await print(await snapshot())'"},
}

// agentHelpText is the static discovery text printed by `wsh agent help`. It is
// pure static output: no RPC is made.
const agentHelpText = `Agent Control Fabric — agent-capable commands
============================================

Detection
---------
WAVETERM=1 is set in every Wave Terminal / RemoteTerm session. Also set:
  WAVETERM_BLOCKID     this block's id
  WAVETERM_TABID       this tab's id
  WAVETERM_CONN        this session's connection name
  WAVETERM_VERSION     Wave Terminal version
  WAVETERM_WORKSPACEID this workspace's id

Start with:
  wsh agent context --json     one-shot orientation (workspace, tabs, blocks, connections)
  wsh agent help --json        machine-readable capability document

Two execution modes
-------------------
Mode A — synchronous (the 90% case)
  wsh run --wait --json -- npm test
  Runs a command in a background block and returns stdout, exitcode, durationms.
  Defaults: do not steal focus, close the block on exit, 5m timeout.
  A PTY merges stdout and stderr; JSON has "outputmerged": true and stderr "".
  Use --focus to steal focus, --keep-block to leave the block open,
  --timeout 30s (or 5m, 1h) to cap the wait.

Mode B — asynchronous / tmux-style (long-running or interactive)
  Spawn or attach a visible block, send-keys into it, capture output, wait, kill.
  Default capture is the last 200 lines; pass --all for the full buffer.
  wsh block wait <block_ref> --until-exit|--contains <substr>|--idle <ms>

Addressing
----------
Blocks: this | <uuid> | <uuid8> | 3 | term:2 | "title substring"
Tabs:   <uuid> | tab:N | title substring

Secrets
-------
Pass secrets by name, never inline values in --cmd, prompts, or JSON:
  wsh block send-keys <block_ref> --secret <secret_label> --enter

Focus
-----
Agent-created blocks default to no-focus (they do not steal the user's cursor).
wsh agent spawn and wsh run --wait do not focus unless you pass --focus.
wsh block new focuses by default; pass --no-focus to match agent defaults.

Block control (tmux-style, asynchronous)
----------------------------------------
wsh block list                          List blocks; --json includes geometry and cwd
wsh block capture <block_ref>           Capture scrollback (default tail 200); --all, --json
wsh block send-keys <block_ref> "text"  Send keystrokes; --enter, --escapes, --secret
wsh block wait <block_ref> --until-exit Wait until the process exits; or --contains / --idle
wsh block status <block_ref> --json     Process + connection status of a block
wsh block screenshot <block_ref>        PNG of a block; --output <file>, --json
wsh block split <block_ref> --direction left|right|above|below
wsh block new --view term --connection <conn> --cmd "..." --split right --relative-to <ref>
wsh block rename <block_ref> <name>     Rename a block (find it by title later)
wsh block select <block_ref>            Focus a block (alias: focus)
wsh block kill <block_ref>              Delete a block

Synchronous execution
---------------------
wsh run --wait --json -- <cmd>          Run a command; print stdout/exitcode/duration
wsh run --wait --json --connection <conn> -- <cmd>

Configuration
-------------
wsh config get <key> --json             Read a config value
wsh config list --json                  List all config keys with types
wsh config set <key> <value>            Set a config value

Ask the user
------------
wsh prompt "Deploy to production?" --options "yes,no" --default no
                                        Modal prompt; --default is used if the user does not answer

Agent orchestration
-------------------
wsh agent context --json
wsh agent spawn --connection prod --cmd "claude" --name claude-prod
wsh agent spawn --cmd "claude" --split right --idempotency-key claude-1
wsh agent list --json
wsh agent stop [block_ref]

Connections
-----------
wsh connection list --json              List connections and their status

Tabs
----
wsh tab list --json
wsh tab new [--name <name>] [--activate]
wsh tab select <tab_ref>
wsh tab close <tab_ref>
wsh tab rename <tab_ref> <name>

Files, views, notifications
---------------------------
wsh file ls|cat|write|cp|mv|rm <uri>    Local and remote files (wsh://conn/path)
wsh view {file|directory|URL}           Preview in a new block
wsh edit {file}                         Open a file in the editor
wsh notify "<message>" --title <title>  Desktop notification

Web widget (embedded <webview>, gated except open)
--------------------------------------------------
Requires agent:allowbrowsercontrol (default off). Remote-origin wsh also
needs agent:allowremotelocalcontrol. Do not leave DevTools open on the page.
@N refs from discrete snapshot are observation-only; click/fill only inside
the same web run after snapshot().
wsh web open <url>                      Open a URL (not gated)
wsh web get <css-selector> --json       HTML for a CSS selector
wsh web snapshot [-b block] [--json]    Compact AX tree with @N refs
wsh web screenshot [-b block] --path f  CDP PNG of the page
wsh web run [-b block] [--timeout 60s]  Mini-API script (args or stdin)

tmux aliases (same commands, tmux vocabulary)
---------------------------------------------
wsh capture-pane    -> wsh block capture
wsh send-keys       -> wsh block send-keys
wsh split-pane      -> wsh block split
wsh select-pane     -> wsh block select
wsh kill-pane       -> wsh block kill
wsh rename-pane     -> wsh block rename
wsh list-panes      -> wsh block list
`

func agentVersion() string {
	if v := os.Getenv("WAVETERM_VERSION"); v != "" {
		return v
	}
	return wavebase.WaveVersion
}

func currentWorkspaceId() string {
	return os.Getenv("WAVETERM_WORKSPACEID")
}

func currentConnectionName() string {
	if conn := os.Getenv("WAVETERM_CONN"); conn != "" {
		return conn
	}
	return RpcContext.Conn
}

// listBlockEntries lists blocks. An empty workspaceId queries every workspace.
func listBlockEntries(workspaceId string) ([]wshrpc.BlocksListEntry, error) {
	workspaces, err := wshclient.WorkspaceListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return nil, fmt.Errorf("failed to list workspaces: %w", err)
	}
	var ids []string
	if workspaceId != "" {
		ids = []string{workspaceId}
	} else {
		for _, ws := range workspaces {
			if ws.WorkspaceData == nil {
				continue
			}
			ids = append(ids, ws.WorkspaceData.OID)
		}
	}
	var all []wshrpc.BlocksListEntry
	for _, wsId := range ids {
		blocks, err := wshclient.BlocksListCommand(RpcClient, wshrpc.BlocksListRequest{WorkspaceId: wsId}, &wshrpc.RpcOpts{Timeout: 5000})
		if err != nil {
			return nil, fmt.Errorf("listing blocks for workspace %s: %w", wsId, err)
		}
		all = append(all, blocks...)
	}
	return all, nil
}

func resolveWorkspaceIdForAgent(blocks []wshrpc.BlocksListEntry) string {
	if ws := currentWorkspaceId(); ws != "" {
		return ws
	}
	blockId := os.Getenv("WAVETERM_BLOCKID")
	if blockId == "" {
		return ""
	}
	for _, b := range blocks {
		if b.BlockId == blockId {
			return b.WorkspaceId
		}
	}
	return ""
}

func isAgentOwnedMeta(meta waveobj.MetaMapType) bool {
	return meta.GetBool(waveobj.MetaKey_AgentOwned, false)
}

func agentOwnedEntries(entries []wshrpc.BlocksListEntry) []wshrpc.BlocksListEntry {
	var owned []wshrpc.BlocksListEntry
	for _, e := range entries {
		if isAgentOwnedMeta(e.Meta) {
			owned = append(owned, e)
		}
	}
	return owned
}

type agentListEntry struct {
	BlockId        string `json:"blockid"`
	Title          string `json:"title,omitempty"`
	Cmd            string `json:"cmd,omitempty"`
	Connection     string `json:"connection,omitempty"`
	Parent         string `json:"parent,omitempty"`
	IdempotencyKey string `json:"idempotencykey,omitempty"`
}

func agentListEntryFromBlock(e wshrpc.BlocksListEntry) agentListEntry {
	return agentListEntry{
		BlockId:        e.BlockId,
		Title:          e.Meta.GetString(waveobj.MetaKey_FrameTitle, ""),
		Cmd:            e.Meta.GetString(waveobj.MetaKey_AgentCmd, e.Meta.GetString(waveobj.MetaKey_Cmd, "")),
		Connection:     e.Meta.GetString(waveobj.MetaKey_Connection, ""),
		Parent:         e.Meta.GetString(waveobj.MetaKey_AgentParent, ""),
		IdempotencyKey: e.Meta.GetString(waveobj.MetaKey_AgentIdempotencyKey, ""),
	}
}

func agentListRun(cmd *cobra.Command, args []string) error {
	entries, err := listBlockEntries("")
	if err != nil {
		return err
	}
	owned := agentOwnedEntries(entries)
	list := make([]agentListEntry, 0, len(owned))
	for _, e := range owned {
		list = append(list, agentListEntryFromBlock(e))
	}
	if agentListJSON {
		out, err := json.MarshalIndent(list, "", "  ")
		if err != nil {
			return fmt.Errorf("marshaling JSON: %w", err)
		}
		WriteStdout("%s\n", string(out))
		return nil
	}
	if len(list) == 0 {
		WriteStdout("no agent-owned blocks\n")
		return nil
	}
	w := tabwriter.NewWriter(WrappedStdout, 0, 0, 2, ' ', 0)
	fmt.Fprintf(w, "BLOCKID\tTITLE\tCMD\tCONNECTION\n")
	for _, e := range list {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", e.BlockId, e.Title, e.Cmd, e.Connection)
	}
	return w.Flush()
}

func deleteAgentBlock(blockId string) error {
	err := wshclient.DeleteBlockCommand(RpcClient, wshrpc.CommandDeleteBlockData{BlockId: blockId}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("delete block failed: %v", err)
	}
	log.Printf("[agent-audit] stop block=%s\n", blockId)
	return nil
}

func agentStopRun(cmd *cobra.Command, args []string) error {
	if len(args) > 0 {
		fullORef, err := resolveBlockArgWithOverride(args[0])
		if err != nil {
			return err
		}
		if fullORef.OType != waveobj.OType_Block {
			return fmt.Errorf("object reference is not a block")
		}
		meta, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{ORef: *fullORef}, &wshrpc.RpcOpts{Timeout: 2000})
		if err != nil {
			return fmt.Errorf("getting block metadata: %w", err)
		}
		if !agentStopForce && !isAgentOwnedMeta(meta) {
			return fmt.Errorf("block %s is not agent-owned (pass --force to stop it anyway)", fullORef.OID)
		}
		if err := deleteAgentBlock(fullORef.OID); err != nil {
			return err
		}
		WriteStdout("stopped block %s\n", fullORef.OID)
		return nil
	}

	wsId := currentWorkspaceId()
	if wsId == "" {
		all, err := listBlockEntries("")
		if err != nil {
			return err
		}
		wsId = resolveWorkspaceIdForAgent(all)
		if wsId == "" {
			return fmt.Errorf("no WAVETERM_WORKSPACEID set (cannot stop all owned blocks)")
		}
	}
	entries, err := listBlockEntries(wsId)
	if err != nil {
		return err
	}
	owned := agentOwnedEntries(entries)
	if len(owned) == 0 {
		WriteStdout("no agent-owned blocks\n")
		return nil
	}
	for _, e := range owned {
		if err := deleteAgentBlock(e.BlockId); err != nil {
			return err
		}
		WriteStdout("stopped block %s\n", e.BlockId)
	}
	return nil
}

type agentContextFocused struct {
	BlockId string `json:"blockid"`
	View    string `json:"view"`
	Title   string `json:"title"`
	Cwd     string `json:"cwd"`
}

type agentContextTab struct {
	TabId  string `json:"tabid"`
	Name   string `json:"name"`
	Index  int    `json:"index"`
	Active bool   `json:"active"`
}

type agentContextConn struct {
	Name      string `json:"name"`
	Status    string `json:"status"`
	Connected bool   `json:"connected"`
}

type agentContextBlock struct {
	BlockId      string                `json:"blockid"`
	Id           string                `json:"id"`
	TabId        string                `json:"tabid"`
	View         string                `json:"view"`
	Title        string                `json:"title"`
	Connection   string                `json:"connection"`
	Cwd          string                `json:"cwd"`
	Index        int                   `json:"index"`
	Geometry     *wshrpc.BlockGeometry `json:"geometry,omitempty"`
	Focused      bool                  `json:"focused"`
	Magnified    bool                  `json:"magnified"`
	AgentOwned   bool                  `json:"agentowned"`
	ProcessState string                `json:"processstate,omitempty"`
}

type agentContextDoc struct {
	WaveTerm    bool                 `json:"waveterm"`
	Version     string               `json:"version"`
	WorkspaceId string               `json:"workspaceid"`
	TabId       string               `json:"tabid"`
	BlockId     string               `json:"blockid"`
	Connection  string               `json:"connection"`
	Focused     *agentContextFocused `json:"focused,omitempty"`
	Tabs        []agentContextTab    `json:"tabs"`
	Connections []agentContextConn   `json:"connections"`
	Blocks      []agentContextBlock  `json:"blocks"`
}

func lookupFocusedForContext() *agentContextFocused {
	tabId := getTabIdFromEnv()
	if tabId == "" {
		return nil
	}
	focused, err := wshclient.GetFocusedBlockDataCommand(RpcClient, &wshrpc.RpcOpts{
		Route:   fmt.Sprintf("tab:%s", tabId),
		Timeout: 2000,
	})
	if err != nil || focused == nil || focused.BlockId == "" {
		return nil
	}
	title := ""
	cwd := ""
	if focused.BlockMeta != nil {
		title = focused.BlockMeta.GetString(waveobj.MetaKey_FrameTitle, "")
		cwd = focused.BlockMeta.GetString(waveobj.MetaKey_CmdCwd, "")
	}
	return &agentContextFocused{
		BlockId: focused.BlockId,
		View:    focused.ViewType,
		Title:   title,
		Cwd:     cwd,
	}
}

func lookupTabsForContext(wsId string) []agentContextTab {
	tabs := []agentContextTab{}
	if wsId == "" {
		return tabs
	}
	workspaces, err := wshclient.WorkspaceListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return tabs
	}
	ws, err := getWorkspaceForId(wsId, workspaces)
	if err != nil || ws == nil {
		return tabs
	}
	for i, tabId := range ws.TabIds {
		entry := agentContextTab{TabId: tabId, Index: i, Active: tabId == ws.ActiveTabId}
		tabData, err := wshclient.GetTabCommand(RpcClient, tabId, &wshrpc.RpcOpts{Timeout: 2000})
		if err == nil && tabData != nil {
			entry.Name = tabData.Name
		}
		tabs = append(tabs, entry)
	}
	return tabs
}

func lookupConnectionsForContext() []agentContextConn {
	conns := []agentContextConn{}
	all, err := getAllConnStatus()
	if err != nil {
		return conns
	}
	for _, c := range all {
		conns = append(conns, agentContextConn{
			Name:      c.Connection,
			Status:    c.Status,
			Connected: c.Connected,
		})
	}
	return conns
}

func bestEffortProcessState(blockId string) string {
	status, err := wshclient.BlockControllerStatusCommand(RpcClient, blockId, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil || status == nil || status.ShellProcStatus == "" {
		return ""
	}
	return mapProcessState(status.ShellProcStatus)
}

func agentContextBlockFromEntry(e wshrpc.BlocksListEntry) agentContextBlock {
	meta := e.Meta
	if meta == nil {
		meta = waveobj.MetaMapType{}
	}
	return agentContextBlock{
		BlockId:      e.BlockId,
		Id:           "block:" + e.BlockId,
		TabId:        e.TabId,
		View:         meta.GetString(waveobj.MetaKey_View, ""),
		Title:        meta.GetString(waveobj.MetaKey_FrameTitle, ""),
		Connection:   meta.GetString(waveobj.MetaKey_Connection, ""),
		Cwd:          meta.GetString(waveobj.MetaKey_CmdCwd, ""),
		Index:        e.Index,
		Geometry:     e.Geometry,
		Focused:      e.Focused,
		Magnified:    e.Magnified,
		AgentOwned:   isAgentOwnedMeta(meta),
		ProcessState: bestEffortProcessState(e.BlockId),
	}
}

func agentContextRun(cmd *cobra.Command, args []string) error {
	allBlocks, err := listBlockEntries("")
	if err != nil {
		return err
	}
	wsId := resolveWorkspaceIdForAgent(allBlocks)
	var scoped []wshrpc.BlocksListEntry
	if wsId != "" {
		for _, b := range allBlocks {
			if b.WorkspaceId == wsId {
				scoped = append(scoped, b)
			}
		}
	} else {
		scoped = allBlocks
	}
	blocks := make([]agentContextBlock, 0, len(scoped))
	for _, e := range scoped {
		blocks = append(blocks, agentContextBlockFromEntry(e))
	}
	doc := agentContextDoc{
		WaveTerm:    true,
		Version:     agentVersion(),
		WorkspaceId: wsId,
		TabId:       getTabIdFromEnv(),
		BlockId:     os.Getenv("WAVETERM_BLOCKID"),
		Connection:  currentConnectionName(),
		Focused:     lookupFocusedForContext(),
		Tabs:        lookupTabsForContext(wsId),
		Connections: lookupConnectionsForContext(),
		Blocks:      blocks,
	}
	if doc.Tabs == nil {
		doc.Tabs = []agentContextTab{}
	}
	if doc.Connections == nil {
		doc.Connections = []agentContextConn{}
	}
	if doc.Blocks == nil {
		doc.Blocks = []agentContextBlock{}
	}
	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling context JSON: %w", err)
	}
	WriteStdout("%s\n", string(out))
	return nil
}
