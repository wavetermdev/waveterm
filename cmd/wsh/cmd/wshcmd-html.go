// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	_ "embed"
	"log"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/vdom/vdomclient"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

//go:embed htmlstyle.css
var htmlStyleCSS []byte

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
		return vdom.E("wave:style",
			vdom.P("src", "vdom:///style.css"),
		)
	},
)

var BgItemTag = vdomclient.DefineComponent[BgItemProps](HtmlVDomClient, "BgItem",
	func(ctx context.Context, props BgItemProps) any {
		return vdom.E("div",
			vdom.Class("bg-item"),
			vdom.E("div",
				vdom.Class("bg-preview"),
				vdom.PStyle("background", props.Bg),
			),
			vdom.E("div",
				vdom.Class("bg-label"),
				props.Label,
			),
			vdom.P("onClick", props.OnClick),
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

		return vdom.E("div",
			vdom.Class("background"),
			vdom.E("div",
				vdom.Class("background-inner"),
				vdom.ForEach(props.Items, func(item BgItem) any {
					return BgItemTag(BgItemProps{
						Bg:      item.Bg,
						Label:   item.Label,
						OnClick: setBackground(item.Bg),
					})
				}),
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
			vdom.Class("root"),
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
					vdom.PStyle("width", "100%"),
					vdom.PStyle("height", "100%"),
					vdom.PStyle("maxWidth", "300px"),
					vdom.PStyle("maxHeight", "300px"),
					vdom.PStyle("objectFit", "contain"),
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
				vdom.E("div", nil, "text ", inputText),
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

	client.SetRootElem(App(struct{}{}))
	client.RegisterFileHandler("/style.css", vdomclient.FileHandlerOption{
		Data:     htmlStyleCSS,
		MimeType: "text/css",
	})
	client.RegisterFileHandler("/test.png", vdomclient.FileHandlerOption{
		FilePath: "~/Downloads/IMG_1939.png",
	})

	err = client.CreateVDomContext(&vdom.VDomTarget{NewBlock: htmlCmdNewBlock})
	if err != nil {
		return err
	}

	go func() {
		<-client.DoneCh
		wshutil.DoShutdown("vdom closed by FE", 0, true)
	}()

	<-client.DoneCh
	return nil
}
