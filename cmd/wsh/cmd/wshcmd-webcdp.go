// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"text/tabwriter"

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
	Args:              cobra.NoArgs,
	RunE:              webCdpListRun,
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

var webCdpJson bool

func init() {
	webCdpStartCmd.Flags().BoolVar(&webCdpJson, "json", false, "output as json")

	webCdpStatusCmd.Flags().BoolVar(&webCdpJson, "json", false, "output as json")

	webCdpCmd.AddCommand(webCdpStartCmd)
	webCdpCmd.AddCommand(webCdpStopCmd)
	webCdpCmd.AddCommand(webCdpStatusCmd)
	webCmd.AddCommand(webCdpCmd)
}

type webCdpListEntry struct {
	BlockId     string
	TabId       string
	Url         string
	CdpState    string
	CdpWsUrl    string
	WorkspaceId string
}

func getCurrentWorkspaceId() (string, error) {
	if os.Getenv("WAVETERM_BLOCKID") != "" {
		oref, err := resolveSimpleId("this")
		if err != nil {
			return "", err
		}
		bi, err := wshclient.BlockInfoCommand(RpcClient, oref.OID, nil)
		if err != nil {
			return "", err
		}
		return bi.WorkspaceId, nil
	}
	return "", fmt.Errorf("no WAVETERM_BLOCKID set (run inside a Wave session or pass -b <blockid>)")
}

func listWebBlocksInCurrentWorkspace() ([]webCdpListEntry, error) {
	wsId, err := getCurrentWorkspaceId()
	if err != nil {
		return nil, err
	}
	blocks, err := wshclient.BlocksListCommand(RpcClient, wshrpc.BlocksListRequest{WorkspaceId: wsId}, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return nil, err
	}
	status, err := wshclient.WebCdpStatusCommand(RpcClient, &wshrpc.RpcOpts{Route: wshutil.ElectronRoute, Timeout: 5000})
	if err != nil {
		return nil, err
	}
	statusMap := make(map[string]wshrpc.WebCdpStatusEntry)
	for _, s := range status {
		statusMap[s.BlockId] = s
	}
	var out []webCdpListEntry
	for _, b := range blocks {
		if b.Meta.GetString(waveobj.MetaKey_View, "") != "web" {
			continue
		}
		ent := webCdpListEntry{
			BlockId:     b.BlockId,
			TabId:       b.TabId,
			WorkspaceId: b.WorkspaceId,
			Url:         b.Meta.GetString(waveobj.MetaKey_Url, ""),
		}
		if st, ok := statusMap[b.BlockId]; ok {
			ent.CdpWsUrl = st.WsUrl
			if st.Controlled {
				ent.CdpState = "active"
			} else {
				ent.CdpState = "ready"
			}
		}
		out = append(out, ent)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].TabId != out[j].TabId {
			return out[i].TabId < out[j].TabId
		}
		return out[i].BlockId < out[j].BlockId
	})
	return out, nil
}

func printWebCdpList(entries []webCdpListEntry) {
	w := tabwriter.NewWriter(WrappedStdout, 0, 0, 2, ' ', 0)
	defer w.Flush()
	fmt.Fprintf(w, "BLOCK ID\tTAB ID\tURL\tCDP\tWSURL\n")
	for _, e := range entries {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", e.BlockId, e.TabId, e.Url, e.CdpState, e.CdpWsUrl)
	}
}

func webCdpListRun(cmd *cobra.Command, args []string) error {
	entries, err := listWebBlocksInCurrentWorkspace()
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		WriteStdout("No web widgets found in this workspace\n")
		return nil
	}
	printWebCdpList(entries)
	return nil
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

func isTransientCdpError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "no webcontents found") || strings.Contains(msg, "timeout waiting for response")
}

func resolveBlockArgFromContext() error {
	thisORef, err := resolveSimpleId("this")
	if err != nil {
		return fmt.Errorf("no -b specified and could not resolve current block: %w", err)
	}
	if _, err := mustBeWebBlock(thisORef); err == nil {
		blockArg = "this"
		return nil
	}
	entries, err := listWebBlocksInCurrentWorkspace()
	if err == nil && len(entries) > 0 {
		printWebCdpList(entries)
	}
	return fmt.Errorf("no -b specified and current block is not a web widget; use: wsh web cdp start -b <blockid>")
}

func webCdpStartRun(cmd *cobra.Command, args []string) error {
	if blockArg == "" {
		if err := resolveBlockArgFromContext(); err != nil {
			return err
		}
	}
	fullORef, err := resolveBlockArg()
	if err != nil {
		return fmt.Errorf("resolving blockid: %w", err)
	}
	blockInfo, err := mustBeWebBlock(fullORef)
	if err != nil {
		return err
	}
	req := wshrpc.CommandWebCdpStartData{
		WorkspaceId: blockInfo.WorkspaceId,
		BlockId:     fullORef.OID,
		TabId:       blockInfo.TabId,
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
	WriteStdout("http: http://%s:%d (try /json)\n", resp.Host, resp.Port)
	return nil
}

func webCdpStopRun(cmd *cobra.Command, args []string) error {
	if blockArg == "" {
		if err := resolveBlockArgFromContext(); err != nil {
			return err
		}
	}
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
		state := "ready"
		if e.Controlled {
			state = "active"
		}
		WriteStdout("%s %s %s\n", e.BlockId, state, e.WsUrl)
	}
	return nil
}
