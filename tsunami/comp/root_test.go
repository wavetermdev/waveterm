// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package comp

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
		clickedDiv = vdom.Bind(`<div>clicked</div>`, nil)
	}
	clickFn := func() {
		log.Printf("run clickFn\n")
		setClicked(true)
	}
	return vdom.Bind(
		`
<div>
    <h1>hello world</h1>
	<Button onClick="#param:clickFn">hello</Button>
	<bindparam key="clickedDiv"/>
</div>
`,
		map[string]any{"clickFn": clickFn, "clickedDiv": clickedDiv},
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
	return vdom.Bind(`
		<div className="#param:clName" ref="#param:ref" onClick="#param:onClick">
			<bindparam key="children"/>
		</div>
	`, map[string]any{"clName": clName, "ref": ref, "onClick": props["onClick"], "children": props["children"]})
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
	root.Render(vdom.E("Page"), &RenderOpts{Resync: false})
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
