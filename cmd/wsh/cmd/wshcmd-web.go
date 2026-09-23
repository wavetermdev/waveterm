// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	webRunMaxScriptBytes  = 256 * 1024
	webRunDefaultTimeout  = 60 * time.Second
	webRunMaxTimeout      = 5 * time.Minute
	webRunRpcTimeoutSlack = 20 * time.Second
	webGetRpcTimeout      = 15 * time.Second
)

var webCmd = &cobra.Command{
	Use:               "web [open|get|snapshot|screenshot|run]",
	Short:             "web commands",
	PersistentPreRunE: preRunSetupRpcClient,
}

var webOpenCmd = &cobra.Command{
	Use:   "open url",
	Short: "open a url a web widget",
	Args:  cobra.ExactArgs(1),
	RunE:  webOpenRun,
}

var webGetCmd = &cobra.Command{
	Use:   "get [--inner] [--all] [--json] css-selector",
	Short: "get the html for a css selector",
	Args:  cobra.ExactArgs(1),
	RunE:  webGetRun,
}

var webSnapshotCmd = &cobra.Command{
	Use:   "snapshot",
	Short: "accessibility snapshot of a web widget (observation only)",
	Args:  cobra.NoArgs,
	RunE:  webSnapshotRun,
}

var webScreenshotCmd = &cobra.Command{
	Use:   "screenshot",
	Short: "capture the page (CDP PNG), not the block chrome",
	Args:  cobra.NoArgs,
	RunE:  webScreenshotRun,
}

var webRunCmd = &cobra.Command{
	Use:   "run [--] [script]",
	Short: "run a JS mini-API script against a web widget",
	Long: `Run a JavaScript snippet in the Electron main process against a web block.
Helpers are injected; the page is driven via CDP. Requires
agent:allowbrowsercontrol.

Pass the script as remaining args (joined with space) or on stdin when there
are no args. If args are present, args win and stdin is not read.

Flags:
  -b, --block     target web block (default: this)
  --timeout       run budget (default 60s, max 5m; 30s, 5m, or integer seconds)
  --json          { "blockid", "url", "title", "stdout", "result", "truncated" }`,
	Args:                  cobra.ArbitraryArgs,
	RunE:                  webRunRun,
	DisableFlagsInUseLine: true,
}

var webGetInner bool
var webGetAll bool
var webGetJson bool
var webOpenMagnified bool
var webOpenReplaceBlock string
var webSnapshotJson bool
var webScreenshotPath string
var webScreenshotJson bool
var webRunTimeoutStr string
var webRunJson bool

func init() {
	webOpenCmd.Flags().BoolVarP(&webOpenMagnified, "magnified", "m", false, "open view in magnified mode")
	webOpenCmd.Flags().StringVarP(&webOpenReplaceBlock, "replace", "r", "", "replace block")
	webCmd.AddCommand(webOpenCmd)

	webGetCmd.Flags().BoolVarP(&webGetInner, "inner", "", false, "get inner html (instead of outer)")
	webGetCmd.Flags().BoolVarP(&webGetAll, "all", "", false, "get all matches (querySelectorAll)")
	webGetCmd.Flags().BoolVarP(&webGetJson, "json", "", false, "output as json")
	webCmd.AddCommand(webGetCmd)

	webSnapshotCmd.Flags().BoolVar(&webSnapshotJson, "json", false, "output as json")
	webCmd.AddCommand(webSnapshotCmd)

	webScreenshotCmd.Flags().StringVar(&webScreenshotPath, "path", "", "write PNG here (wsh's filesystem)")
	webScreenshotCmd.Flags().BoolVar(&webScreenshotJson, "json", false, "output {blockid, bytes, path?} (not the PNG)")
	webCmd.AddCommand(webScreenshotCmd)

	webRunCmd.Flags().StringVar(&webRunTimeoutStr, "timeout", "", "run budget (default 60s, max 5m)")
	webRunCmd.Flags().BoolVar(&webRunJson, "json", false, "output WebRunResult as json")
	webCmd.AddCommand(webRunCmd)

	rootCmd.AddCommand(webCmd)
}

func errNotAWebBlock(blockId string) error {
	return fmt.Errorf("block %s is not a web block", blockId)
}

func resolveWebBlockTarget() (*waveobj.ORef, *wshrpc.BlockInfoData, error) {
	fullORef, err := resolveBlockArg()
	if err != nil {
		return nil, nil, fmt.Errorf("resolving blockid: %w", err)
	}
	blockInfo, err := wshclient.BlockInfoCommand(RpcClient, fullORef.OID, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("getting block info: %w", err)
	}
	if blockInfo.Block == nil || blockInfo.Block.Meta.GetString(waveobj.MetaKey_View, "") != "web" {
		return nil, nil, errNotAWebBlock(fullORef.OID)
	}
	return fullORef, blockInfo, nil
}

func selectWebRunScript(args []string, stdin []byte) (string, error) {
	var script string
	if len(args) > 0 {
		script = strings.Join(args, " ")
	} else {
		script = string(stdin)
	}
	if strings.TrimSpace(script) == "" {
		return "", fmt.Errorf("script is required (pass as arguments or on stdin)")
	}
	return script, nil
}

func checkWebRunScriptSize(script string) error {
	if len(script) > webRunMaxScriptBytes {
		return fmt.Errorf("script exceeds max size (%d bytes, max %d)", len(script), webRunMaxScriptBytes)
	}
	return nil
}

func parseWebRunTimeout(s string) (time.Duration, error) {
	d, err := parseDurationFlag(s, webRunDefaultTimeout)
	if err != nil {
		return 0, err
	}
	if d > webRunMaxTimeout {
		return 0, fmt.Errorf("timeout max is 5m, got %s", d)
	}
	return d, nil
}

func webGetRun(cmd *cobra.Command, args []string) error {
	fullORef, blockInfo, err := resolveWebBlockTarget()
	if err != nil {
		return err
	}
	data := wshrpc.CommandWebSelectorData{
		WorkspaceId: blockInfo.WorkspaceId,
		BlockId:     fullORef.OID,
		TabId:       blockInfo.TabId,
		Selector:    args[0],
		Opts: &wshrpc.WebSelectorOpts{
			Inner: webGetInner,
			All:   webGetAll,
		},
	}
	output, err := wshclient.WebSelectorCommand(RpcClient, data, &wshrpc.RpcOpts{
		Route:   wshutil.ElectronRoute,
		Timeout: webGetRpcTimeout.Milliseconds(),
	})
	if err != nil {
		return err
	}
	if webGetJson {
		barr, err := json.MarshalIndent(output, "", "  ")
		if err != nil {
			return fmt.Errorf("json encoding: %w", err)
		}
		WriteStdout("%s\n", string(barr))
	} else {
		for _, item := range output {
			WriteStdout("%s\n", item)
		}
	}
	return nil
}

func webSnapshotRun(cmd *cobra.Command, args []string) error {
	fullORef, blockInfo, err := resolveWebBlockTarget()
	if err != nil {
		return err
	}
	result, err := wshclient.WebSnapshotCommand(RpcClient, wshrpc.CommandWebSnapshotData{
		WorkspaceId: blockInfo.WorkspaceId,
		BlockId:     fullORef.OID,
		TabId:       blockInfo.TabId,
	}, &wshrpc.RpcOpts{
		Route:   wshutil.ElectronRoute,
		Timeout: 15000,
	})
	if err != nil {
		return err
	}
	if result == nil {
		return fmt.Errorf("empty snapshot result")
	}
	if webSnapshotJson {
		barr, err := json.Marshal(result)
		if err != nil {
			return fmt.Errorf("json encoding: %w", err)
		}
		WriteStdout("%s\n", string(barr))
		return nil
	}
	WriteStdout("%s", result.Snapshot)
	if result.Snapshot != "" && !strings.HasSuffix(result.Snapshot, "\n") {
		WriteStdout("\n")
	}
	return nil
}

type webScreenshotJSONOutput struct {
	BlockId string `json:"blockid"`
	Bytes   int    `json:"bytes"`
	Path    string `json:"path,omitempty"`
}

func webScreenshotRun(cmd *cobra.Command, args []string) error {
	fullORef, blockInfo, err := resolveWebBlockTarget()
	if err != nil {
		return err
	}
	result, err := wshclient.WebScreenshotCommand(RpcClient, wshrpc.CommandWebScreenshotData{
		WorkspaceId: blockInfo.WorkspaceId,
		BlockId:     fullORef.OID,
		TabId:       blockInfo.TabId,
	}, &wshrpc.RpcOpts{
		Route:   wshutil.ElectronRoute,
		Timeout: 15000,
	})
	if err != nil {
		return err
	}
	if result == nil {
		return fmt.Errorf("empty screenshot result")
	}
	pngBytes, err := decodeScreenshotPNG(result.Data64)
	if err != nil {
		return err
	}
	if webScreenshotPath != "" {
		if err := os.WriteFile(webScreenshotPath, pngBytes, 0644); err != nil {
			return fmt.Errorf("error writing screenshot to %s: %w", webScreenshotPath, err)
		}
	}
	if webScreenshotJson {
		out := webScreenshotJSONOutput{
			BlockId: fullORef.OID,
			Bytes:   len(pngBytes),
		}
		if webScreenshotPath != "" {
			out.Path = webScreenshotPath
		}
		barr, err := json.Marshal(out)
		if err != nil {
			return fmt.Errorf("json encoding: %w", err)
		}
		WriteStdout("%s\n", string(barr))
		return nil
	}
	if webScreenshotPath != "" {
		WriteStdout("screenshot written to %s (%d bytes)\n", webScreenshotPath, len(pngBytes))
		return nil
	}
	if _, err := os.Stdout.Write(pngBytes); err != nil {
		return fmt.Errorf("writing png to stdout: %w", err)
	}
	return nil
}

func webRunRun(cmd *cobra.Command, args []string) error {
	fullORef, blockInfo, err := resolveWebBlockTarget()
	if err != nil {
		return err
	}
	var stdin []byte
	if len(args) == 0 {
		if isStdinCharDevice() {
			return fmt.Errorf("script is required (pass as arguments or on stdin)")
		}
		stdin, err = io.ReadAll(WrappedStdin)
		if err != nil {
			return fmt.Errorf("reading stdin: %w", err)
		}
	}
	script, err := selectWebRunScript(args, stdin)
	if err != nil {
		return err
	}
	if err := checkWebRunScriptSize(script); err != nil {
		return err
	}
	runTimeout, err := parseWebRunTimeout(webRunTimeoutStr)
	if err != nil {
		return fmt.Errorf("parsing --timeout: %w", err)
	}
	rpcTimeoutMs := (runTimeout + webRunRpcTimeoutSlack).Milliseconds()
	result, err := wshclient.WebRunCommand(RpcClient, wshrpc.CommandWebRunData{
		WorkspaceId: blockInfo.WorkspaceId,
		BlockId:     fullORef.OID,
		TabId:       blockInfo.TabId,
		Script:      script,
		TimeoutMs:   runTimeout.Milliseconds(),
	}, &wshrpc.RpcOpts{
		Route:   wshutil.ElectronRoute,
		Timeout: rpcTimeoutMs,
	})
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "timed out") && !strings.Contains(err.Error(), fullORef.OID) {
			return fmt.Errorf("web run timed out for block %s: %w", fullORef.OID, err)
		}
		return err
	}
	if result == nil {
		return fmt.Errorf("empty web run result")
	}
	if webRunJson {
		barr, err := json.Marshal(result)
		if err != nil {
			return fmt.Errorf("json encoding: %w", err)
		}
		WriteStdout("%s\n", string(barr))
		return nil
	}
	WriteStdout("%s", result.Stdout)
	if result.Stdout != "" && !strings.HasSuffix(result.Stdout, "\n") {
		WriteStdout("\n")
	}
	return nil
}

func isStdinCharDevice() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

func webOpenRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
	}()

	var replaceBlockORef *waveobj.ORef
	if webOpenReplaceBlock != "" {
		var err error
		replaceBlockORef, err = resolveSimpleId(webOpenReplaceBlock)
		if err != nil {
			return fmt.Errorf("resolving -r blockid: %w", err)
		}
	}
	if replaceBlockORef != nil && webOpenMagnified {
		return fmt.Errorf("cannot use --replace and --magnified together")
	}

	tabId := getTabIdFromEnv()
	if tabId == "" {
		return fmt.Errorf("no WAVETERM_TABID env var set")
	}

	wshCmd := wshrpc.CommandCreateBlockData{
		TabId: tabId,
		BlockDef: &waveobj.BlockDef{
			Meta: map[string]any{
				waveobj.MetaKey_View: "web",
				waveobj.MetaKey_Url:  args[0],
			},
		},
		Magnified: webOpenMagnified,
		Focused:   true,
	}
	if replaceBlockORef != nil {
		wshCmd.TargetBlockId = replaceBlockORef.OID
		wshCmd.TargetAction = wshrpc.CreateBlockAction_Replace
	}
	oref, err := wshclient.CreateBlockCommand(RpcClient, wshCmd, nil)
	if err != nil {
		return fmt.Errorf("creating block: %w", err)
	}
	WriteStdout("created block %s\n", oref)
	return nil
}
