// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"log"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/vdom/vdomclient"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var htmlCmdNewBlock bool
var HtmlVDomClient *vdomclient.Client = vdomclient.MakeClient(&vdom.VDomBackendOpts{CloseOnCtrlC: true})

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

// Prop Types
type BgItemProps struct {
	Bg      string `json:"bg"`
	Label   string `json:"label"`
	OnClick func() `json:"onClick"`
}

type BgListProps struct {
	Items []BgItem `json:"items"`
}

type BgItem struct {
	Bg    string `json:"bg"`
	Label string `json:"label"`
}

// Components
var Style = vdomclient.DefineComponent[struct{}](HtmlVDomClient, "Style",
	func(ctx context.Context, _ struct{}) any {
		return vdom.E("style", nil, `
			.root {
				padding: 10px;
			}

			.background {
				display: flex;
				align-items: center;
				width: 100%;
			}

			.background-inner {
				max-width: 300px;
			}

			.bg-item {
				cursor: pointer;
				padding: 8px 12px;
				border-radius: 4px;
				display: flex;
				flex-direction: row;
				align-items: flex-start;
				justify-content: flex-start;
			}

			.bg-item:hover {
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
		`)
	},
)

var BgItemTag = vdomclient.DefineComponent[BgItemProps](HtmlVDomClient, "BgItem",
	func(ctx context.Context, props BgItemProps) any {
		return vdom.E("div",
			vdom.P("className", "bg-item"),
			vdom.P("onClick", props.OnClick),
			vdom.E("div",
				vdom.P("className", "bg-preview"),
				vdom.PStyle("background", props.Bg),
			),
			vdom.E("div",
				vdom.P("className", "bg-label"),
				props.Label,
			),
		)
	},
)

var BgList = vdomclient.DefineComponent[BgListProps](HtmlVDomClient, "BgList",
	func(ctx context.Context, props BgListProps) any {
		setBackground := func(bg string) func() {
			return func() {
				blockInfo, err := wshclient.BlockInfoCommand(HtmlVDomClient.RpcClient, HtmlVDomClient.RpcContext.BlockId, nil)
				if err != nil {
					log.Printf("error getting block info: %v\n", err)
					return
				}
				err = wshclient.SetMetaCommand(HtmlVDomClient.RpcClient, wshrpc.CommandSetMetaData{
					ORef: waveobj.ORef{OType: "tab", OID: blockInfo.TabId},
					Meta: map[string]any{"bg": bg},
				}, nil)
				if err != nil {
					log.Printf("error setting meta: %v\n", err)
				}
			}
		}

		items := make([]*vdom.VDomElem, 0, len(props.Items))
		for _, item := range props.Items {
			items = append(items, BgItemTag(BgItemProps{
				Bg:      item.Bg,
				Label:   item.Label,
				OnClick: setBackground(item.Bg),
			}))
		}

		return vdom.E("div",
			vdom.P("className", "background"),
			vdom.E("div",
				vdom.P("className", "background-inner"),
				items,
			),
		)
	},
)

var App = vdomclient.DefineComponent[struct{}](HtmlVDomClient, "App",
	func(ctx context.Context, _ struct{}) any {
		inputText, setInputText := vdom.UseState(ctx, "start")

		bgItems := []BgItem{
			{Bg: "", Label: "default"},
			{Bg: "#ff0000", Label: "red"},
			{Bg: "#00ff00", Label: "green"},
			{Bg: "#0000ff", Label: "blue"},
		}

		return vdom.E("div",
			vdom.P("className", "root"),
			Style(struct{}{}),
			vdom.E("h1", nil, "Set Background"),
			vdom.E("div", nil,
				vdom.E("wave:markdown",
					vdom.P("text", "*quick vdom application to set background colors*"),
				),
			),
			vdom.E("div", nil,
				BgList(BgListProps{Items: bgItems}),
			),
			vdom.E("div", nil,
				vdom.E("img",
					vdom.P("style", "width: 100%; height: 100%; max-width: 300px; max-height: 300px; object-fit: contain;"),
					vdom.P("src", "vdom:///test.png"),
				),
			),
			vdom.E("div", nil,
				vdom.E("input",
					vdom.P("type", "text"),
					vdom.P("value", inputText),
					vdom.P("onChange", func(e vdom.VDomEvent) {
						setInputText(e.TargetValue)
					}),
				),
				vdom.E("div", nil,
					"text ", inputText,
				),
			),
		)
	},
)

func htmlRun(cmd *cobra.Command, args []string) error {
	WriteStderr("running wsh html %q\n", RpcContext.BlockId)
	client := HtmlVDomClient
	err := client.Connect()
	if err != nil {
		return err
	}

	// Set up the root component
	client.SetRootElem(App(struct{}{}))

	// Set up file handler
	client.RegisterFileHandler("/test.png", "~/Downloads/IMG_1939.png")

	// Create the VDOM context
	err = client.CreateVDomContext(&vdom.VDomTarget{NewBlock: htmlCmdNewBlock})
	if err != nil {
		return err
	}

	// Handle shutdown
	go func() {
		<-client.DoneCh
		wshutil.DoShutdown("vdom closed by FE", 0, true)
	}()

	<-client.DoneCh
	return nil
}
