// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var webCmd = &cobra.Command{
	Use:               "web [open|get|set]",
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
	Use:    "get [--inner] [--all] [--json] css-selector",
	Short:  "get the html for a css selector",
	Args:   cobra.ExactArgs(1),
	Hidden: true,
	RunE:   webGetRun,
}

var webGetInner bool
var webGetAll bool
var webGetJson bool
var webOpenMagnified bool
var webOpenReplaceBlock string
var webOpenCdp bool

func init() {
	webOpenCmd.Flags().BoolVarP(&webOpenMagnified, "magnified", "m", false, "open view in magnified mode")
	webOpenCmd.Flags().StringVarP(&webOpenReplaceBlock, "replace", "r", "", "replace block")
	webOpenCmd.Flags().BoolVarP(&webOpenCdp, "cdp", "c", false, "start CDP for the created web widget (requires debug:webcdp=true)")
	webCmd.AddCommand(webOpenCmd)
	webGetCmd.Flags().BoolVarP(&webGetInner, "inner", "", false, "get inner html (instead of outer)")
	webGetCmd.Flags().BoolVarP(&webGetAll, "all", "", false, "get all matches (querySelectorAll)")
	webGetCmd.Flags().BoolVarP(&webGetJson, "json", "", false, "output as json")
	webCmd.AddCommand(webGetCmd)
	rootCmd.AddCommand(webCmd)
}

func webGetRun(cmd *cobra.Command, args []string) error {
	fullORef, err := resolveBlockArg()
	if err != nil {
		return fmt.Errorf("resolving blockid: %w", err)
	}
	blockInfo, err := wshclient.BlockInfoCommand(RpcClient, fullORef.OID, nil)
	if err != nil {
		return fmt.Errorf("getting block info: %w", err)
	}
	if blockInfo.Block.Meta.GetString(waveobj.MetaKey_View, "") != "web" {
		return fmt.Errorf("block %s is not a web block", fullORef.OID)
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
		Timeout: 5000,
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

func webOpenRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("web", rtnErr == nil)
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

	if webOpenCdp {
		// Fetch workspace/tab info for the newly-created block then start CDP.
		blockInfo, err := wshclient.BlockInfoCommand(RpcClient, oref.OID, nil)
		if err != nil {
			return fmt.Errorf("getting block info for created web widget: %w", err)
		}
		req := wshrpc.CommandWebCdpStartData{
			WorkspaceId:   blockInfo.WorkspaceId,
			BlockId:       oref.OID,
			TabId:         blockInfo.TabId,
			Port:          0,
			IdleTimeoutMs: int((5 * time.Minute) / time.Millisecond),
		}

		// Web blocks are created asynchronously in the UI; the underlying <webview> WebContents may not exist yet.
		// Retry briefly so `wsh web open --cdp` works reliably.
		var cdpResp *wshrpc.CommandWebCdpStartRtnData
		var cdpErr error
		deadline := time.Now().Add(7 * time.Second)
		for {
			cdpResp, cdpErr = wshclient.WebCdpStartCommand(
				RpcClient,
				req,
				&wshrpc.RpcOpts{Route: wshutil.ElectronRoute, Timeout: 5000},
			)
			if cdpErr == nil {
				break
			}
			errStr := cdpErr.Error()
			// Only retry the “not ready yet” cases. Fail fast for config gating or other errors.
			if strings.Contains(errStr, "no webcontents found") || strings.Contains(errStr, "timeout waiting for response") {
				if time.Now().After(deadline) {
					break
				}
				time.Sleep(200 * time.Millisecond)
				continue
			}
			break
		}
		if cdpErr != nil {
			// Preserve the created block output so user can recover; then return error.
			return fmt.Errorf("starting cdp for created web widget: %w", cdpErr)
		}
		WriteStdout("cdp wsurl: %s\n", cdpResp.WsUrl)
		WriteStdout("inspector: %s\n", cdpResp.InspectorUrl)
		WriteStdout("host=%s port=%d targetid=%s\n", cdpResp.Host, cdpResp.Port, cdpResp.TargetId)
	}
	return nil
}
