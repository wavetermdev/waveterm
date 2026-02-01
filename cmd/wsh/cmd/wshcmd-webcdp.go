// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var webCdpCmd = &cobra.Command{
	Use:               "cdp [start|stop|status]",
	Short:             "Expose a CDP websocket for a web widget",
	Long:              "Expose a local Chrome DevTools Protocol (CDP) websocket for a web widget. WARNING: CDP grants full control of the web widget (DOM, cookies, JS execution).",
	PersistentPreRunE: preRunSetupRpcClient,
}

var webCdpStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start a local CDP websocket proxy for a web widget",
	Args:  cobra.NoArgs,
	RunE:  webCdpStartRun,
}

var webCdpStopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop a local CDP websocket proxy for a web widget",
	Args:  cobra.NoArgs,
	RunE:  webCdpStopRun,
}

var webCdpStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "List active CDP websocket proxies",
	Args:  cobra.NoArgs,
	RunE:  webCdpStatusRun,
}

var webCdpPort int
var webCdpIdleTimeoutMs int
var webCdpJson bool

func init() {
	webCdpStartCmd.Flags().IntVar(&webCdpPort, "port", 0, "listen port (0 chooses an ephemeral port)")
	webCdpStartCmd.Flags().IntVar(&webCdpIdleTimeoutMs, "idle-timeout-ms", 5*60*1000, "idle timeout in ms (0 disables)")
	webCdpStartCmd.Flags().BoolVar(&webCdpJson, "json", false, "output as json")

	webCdpStatusCmd.Flags().BoolVar(&webCdpJson, "json", false, "output as json")

	webCdpCmd.AddCommand(webCdpStartCmd)
	webCdpCmd.AddCommand(webCdpStopCmd)
	webCdpCmd.AddCommand(webCdpStatusCmd)

	// attach under: wsh web cdp ...
	webCmd.AddCommand(webCdpCmd)
}

func mustBeWebBlock(fullORef *waveobj.ORef) (*wshrpc.BlockInfoData, error) {
	blockInfo, err := wshclient.BlockInfoCommand(RpcClient, fullORef.OID, nil)
	if err != nil {
		return nil, fmt.Errorf("getting block info: %w", err)
	}
	if blockInfo.Block.Meta.GetString(waveobj.MetaKey_View, "") != "web" {
		return nil, fmt.Errorf("block %s is not a web block", fullORef.OID)
	}
	return blockInfo, nil
}

func webCdpStartRun(cmd *cobra.Command, args []string) error {
	fullORef, err := resolveBlockArg()
	if err != nil {
		return fmt.Errorf("resolving blockid: %w", err)
	}
	blockInfo, err := mustBeWebBlock(fullORef)
	if err != nil {
		return err
	}
	req := wshrpc.CommandWebCdpStartData{
		WorkspaceId:   blockInfo.WorkspaceId,
		BlockId:       fullORef.OID,
		TabId:         blockInfo.TabId,
		Port:          webCdpPort,
		IdleTimeoutMs: webCdpIdleTimeoutMs,
	}
	resp, err := wshclient.WebCdpStartCommand(RpcClient, req, &wshrpc.RpcOpts{
		Route:   wshutil.ElectronRoute,
		Timeout: 5000,
	})
	if err != nil {
		return err
	}
	if webCdpJson {
		barr, err := json.MarshalIndent(resp, "", "  ")
		if err != nil {
			return fmt.Errorf("json encoding: %w", err)
		}
		WriteStdout("%s\n", string(barr))
		return nil
	}
	WriteStdout("cdp wsurl: %s\n", resp.WsUrl)
	WriteStdout("inspector: %s\n", resp.InspectorUrl)
	WriteStdout("host=%s port=%d targetid=%s\n", resp.Host, resp.Port, resp.TargetId)
	return nil
}

func webCdpStopRun(cmd *cobra.Command, args []string) error {
	fullORef, err := resolveBlockArg()
	if err != nil {
		return fmt.Errorf("resolving blockid: %w", err)
	}
	blockInfo, err := mustBeWebBlock(fullORef)
	if err != nil {
		return err
	}
	req := wshrpc.CommandWebCdpStopData{
		WorkspaceId: blockInfo.WorkspaceId,
		BlockId:     fullORef.OID,
		TabId:       blockInfo.TabId,
	}
	err = wshclient.WebCdpStopCommand(RpcClient, req, &wshrpc.RpcOpts{
		Route:   wshutil.ElectronRoute,
		Timeout: 5000,
	})
	if err != nil {
		return err
	}
	WriteStdout("stopped cdp proxy for block %s\n", fullORef.OID)
	return nil
}

func webCdpStatusRun(cmd *cobra.Command, args []string) error {
	resp, err := wshclient.WebCdpStatusCommand(RpcClient, &wshrpc.RpcOpts{
		Route:   wshutil.ElectronRoute,
		Timeout: 5000,
	})
	if err != nil {
		return err
	}
	if webCdpJson {
		barr, err := json.MarshalIndent(resp, "", "  ")
		if err != nil {
			return fmt.Errorf("json encoding: %w", err)
		}
		WriteStdout("%s\n", string(barr))
		return nil
	}
	for _, e := range resp {
		WriteStdout("%s %s\n", e.BlockId, e.WsUrl)
	}
	return nil
}
