// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"testing"

	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

type renderContextKeyType struct{}

var renderContextKey = renderContextKeyType{}

type TestContext struct {
	ButtonId string
}

func Page(ctx context.Context, props map[string]any) any {
	clicked, setClicked, _ := vdom.UseState(ctx, false)
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

func Button(ctx context.Context, props map[string]any) any {
	ref := vdom.UseVDomRef(ctx)
	clName, setClName, _ := vdom.UseState(ctx, "button")
	vdom.UseEffect(ctx, func() func() {
		fmt.Printf("Button useEffect\n")
		setClName("button mounted")
		return nil
	}, nil)
	compId := vdom.UseId(ctx)
	testContext := getTestContext(ctx)
	if testContext != nil {
		testContext.ButtonId = compId
	}
	return vdom.H("div", map[string]any{
		"className": clName,
		"ref":       ref,
		"onClick":   props["onClick"],
	}, props["children"])
}

func printVDom(root *RootElem) {
	vd := root.MakeVDom()
	jsonBytes, _ := json.MarshalIndent(vd, "", "  ")
	fmt.Printf("%s\n", string(jsonBytes))
}

func getTestContext(ctx context.Context) *TestContext {
	val := ctx.Value(renderContextKey)
	if val == nil {
		return nil
	}
	return val.(*TestContext)
}

func Test1(t *testing.T) {
	log.Printf("hello!\n")
	testContext := &TestContext{ButtonId: ""}
	ctx := context.WithValue(context.Background(), renderContextKey, testContext)
	root := MakeRoot()
	root.SetOuterCtx(ctx)
	root.RegisterComponent("Page", Page)
	root.RegisterComponent("Button", Button)
	root.Render(vdom.H("Page", nil), &RenderOpts{Resync: false})
	if root.Root == nil {
		t.Fatalf("root.Root is nil")
	}
	printVDom(root)
	root.RunWork(&RenderOpts{Resync: false})
	printVDom(root)
	root.Event(testContext.ButtonId, "onClick", vdom.VDomEvent{EventType: "onClick"})
	root.RunWork(&RenderOpts{Resync: false})
	printVDom(root)
}
