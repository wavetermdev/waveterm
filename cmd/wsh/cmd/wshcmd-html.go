// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"log"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/vdom/vdomclient"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var htmlCmdNewBlock bool
var GlobalVDomClient *vdomclient.Client

func init() {
	htmlCmd.Flags().BoolVarP(&htmlCmdNewBlock, "newblock", "n", false, "create a new block")
	rootCmd.AddCommand(htmlCmd)
}

var htmlCmd = &cobra.Command{
	Use:    "html",
	Hidden: true,
	Short:  "launch demo vdom application",
	RunE:   htmlRun,
}

func StyleTag(ctx context.Context, props map[string]any) any {
	return vdom.Bind(`
    <style>
    .root {
        padding: 10px;
    }

    .background {
        display: flex;
        align-items: center;
        width: 100%;

        .background-inner {
            max-width: 300px;

            .bg-item {
                cursor: pointer;
                padding: 8px 12px;
                border-radius: 4px;
                display: flex;
                flex-direction: row;
                align-items: flex-start;
                justify-content: flex-start;

                &:hover {
                    background-color: var(--button-grey-hover-bg);
                }

                .bg-preview {
                    width: 20px;
                    height: 20px;
                    margin-right: 10px;
                    border-radius: 50%;
                    border: 1px solid #777;
                }

                .bg-label {
                    display: block;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;	            
                }
            }
        }
    }
    </style>
    `, nil)
}

type BgItemProps struct {
	Bg    string
	Label string
}

func BgItemTag(ctx context.Context, props BgItemProps) any {
	clickFn := func() {
		log.Printf("bg item clicked %q\n", props.Bg)
		blockInfo, err := wshclient.BlockInfoCommand(GlobalVDomClient.RpcClient, GlobalVDomClient.RpcContext.BlockId, nil)
		if err != nil {
			log.Printf("error getting block info: %v\n", err)
			return
		}
		log.Printf("block info: tabid=%q\n", blockInfo.TabId)
		err = wshclient.SetMetaCommand(GlobalVDomClient.RpcClient, wshrpc.CommandSetMetaData{
			ORef: waveobj.ORef{OType: "tab", OID: blockInfo.TabId},
			Meta: map[string]any{"bg": props.Bg},
		}, nil)
		if err != nil {
			log.Printf("error setting meta: %v\n", err)
		}
		// wshclient.SetMetaCommand(GlobalVDomClient.RpcClient)
	}
	params := map[string]any{
		"bg":           props.Bg,
		"label":        props.Label,
		"clickHandler": clickFn,
	}
	return vdom.Bind(`
        <div className="bg-item" onClick="#param:clickHandler">
            <div className="bg-preview" style="background: #param:bg"></div>
            <div className="bg-label"><bindparam key="label"/></div>
        </div>`, params)
}

func AllBgItemsTag(ctx context.Context, props map[string]any) any {
	items := []map[string]any{
		{"bg": nil, "label": "default"},
		{"bg": "#ff0000", "label": "red"},
		{"bg": "#00ff00", "label": "green"},
		{"bg": "#0000ff", "label": "blue"},
	}
	bgElems := make([]*vdom.VDomElem, 0)
	for _, item := range items {
		elem := vdom.E("BgItemTag", item)
		bgElems = append(bgElems, elem)
	}
	return vdom.Bind(`
    <div className="background">
        <div className="background-inner">
            <bindparam key="bgElems"/>
        </div>
    </div>
    `, map[string]any{"bgElems": bgElems})
}

func MakeVDom() *vdom.VDomElem {
	vdomStr := `
    <div className="root">
        <StyleTag/>
        <h1>Set Background</h1>
        <div>
            <wave:markdown text="*quick vdom application to set background colors*"/>
        </div>
        <div>
            <AllBgItemsTag/>
        </div>
        <div>
            <img style="width: 100%; height: 100%; max-width: 300px; max-height: 300px; object-fit: contain;" src="vdom:///test.png"/>
        </div>
    </div>
    `
	elem := vdom.Bind(vdomStr, nil)
	return elem
}

func GlobalEventHandler(client *vdomclient.Client, event vdom.VDomEvent) {
	if event.EventType == "clickinc" {
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
	GlobalVDomClient = client
	client.SetGlobalEventHandler(GlobalEventHandler)
	log.Printf("created client: %v\n", client)
	client.RegisterComponent("StyleTag", StyleTag)
	client.RegisterComponent("BgItemTag", BgItemTag)
	client.RegisterComponent("AllBgItemsTag", AllBgItemsTag)
	client.RegisterFileHandler("/test.png", "~/Downloads/IMG_1939.png")
	client.SetRootElem(MakeVDom())
	err = client.CreateVDomContext(&vdom.VDomTarget{NewBlock: htmlCmdNewBlock})
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
		log.Printf("updating text\n")
		client.SetAtomVal("text", "updated text")
		err := client.SendAsyncInitiation()
		if err != nil {
			log.Printf("error sending async initiation: %v\n", err)
		}
	}()
	<-client.DoneCh
	return nil
}
