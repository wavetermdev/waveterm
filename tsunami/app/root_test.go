// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package app

import (
	"encoding/json"
	"fmt"
	"log"
	"testing"

	"github.com/wavetermdev/waveterm/tsunami/engine"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

func Page(props map[string]any) any {
	clicked, setClicked, _ := UseState(false)
	var clickedDiv *vdom.VDomElem
	if clicked {
		clickedDiv = vdom.H("div", nil, "clicked")
	}
	clickFn := func() {
		log.Printf("run clickFn\n")
		setClicked(true)
	}
	return vdom.H("div", nil,
		vdom.H("h1", nil, "hello world"),
		vdom.H("Button", map[string]any{"onClick": clickFn}, "hello"),
		clickedDiv,
	)
}

func Button(props map[string]any) any {
	ref := UseVDomRef()
	clName, setClName, _ := UseState("button")
	UseEffect(func() func() {
		fmt.Printf("Button useEffect\n")
		setClName("button mounted")
		return nil
	}, nil)
	compId := UseId()
	// Store the button ID in a global variable for testing
	buttonId = compId
	return vdom.H("div", map[string]any{
		"className": clName,
		"ref":       ref,
		"onClick":   props["onClick"],
	}, props["children"])
}

func printVDom(root *engine.RootElem) {
	vd := root.MakeRendered()
	jsonBytes, _ := json.MarshalIndent(vd, "", "  ")
	fmt.Printf("%s\n", string(jsonBytes))
}

var buttonId string

func Test1(t *testing.T) {
	log.Printf("hello!\n")
	root := engine.MakeRoot()
	root.RegisterComponent("Page", Page)
	root.RegisterComponent("Button", Button)
	root.Render(vdom.H("Page", nil), &engine.RenderOpts{Resync: false})
	if root.Root == nil {
		t.Fatalf("root.Root is nil")
	}
	printVDom(root)
	root.RunWork(&engine.RenderOpts{Resync: false})
	printVDom(root)
	root.Event(buttonId, "onClick", vdom.VDomEvent{EventType: "onClick"})
	root.RunWork(&engine.RenderOpts{Resync: false})
	printVDom(root)
}
