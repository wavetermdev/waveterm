// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"log"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/vdom/vdomclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func init() {
	rootCmd.AddCommand(htmlCmd)
}

var htmlCmd = &cobra.Command{
	Use:    "html",
	Hidden: true,
	Short:  "launch demo vdom application",
	RunE:   htmlRun,
}

func MakeVDom() *vdom.VDomElem {
	vdomStr := `
	<div>
	  <h1 style="color:red; background-color: #bind:$.bgcolor; border-radius: 4px; padding: 5px;">hello vdom world</h1>
	  <div><bind key="$.text"/> | num[<bind key="$.num"/>]</div>
	  <div>
	    <button onClick="#globalevent:clickinc">increment</button>
	  </div>
	</div>
	`
	elem := vdom.Bind(vdomStr, nil)
	return elem
}

func GlobalEventHandler(client *vdomclient.Client, event vdom.VDomEvent) {
	if event.PropName == "clickinc" {
		client.SetAtomVal("num", client.GetAtomVal("num").(int)+1)
		return
	}
}

func htmlRun(cmd *cobra.Command, args []string) error {
	WriteStderr("running wsh html %q\n", RpcContext.BlockId)

	client, err := vdomclient.MakeClient(&vdom.VDomBackendOpts{CloseOnCtrlC: true})
	if err != nil {
		return err
	}
	client.SetGlobalEventHandler(GlobalEventHandler)
	log.Printf("created client: %v\n", client)
	client.SetAtomVal("bgcolor", "#0000ff77")
	client.SetAtomVal("text", "initial text")
	client.SetAtomVal("num", 0)
	client.SetRootElem(MakeVDom())
	err = client.CreateVDomContext()
	if err != nil {
		return err
	}
	log.Printf("created context\n")
	go func() {
		<-client.DoneCh
		wshutil.DoShutdown("vdom closed by FE", 0, true)
	}()
	log.Printf("created vdom context\n")
	go func() {
		time.Sleep(5 * time.Second)
		client.SetAtomVal("text", "updated text")
		client.SendAsyncInitiation()
	}()
	<-client.DoneCh
	return nil
}
