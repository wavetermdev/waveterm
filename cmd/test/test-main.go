// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"fmt"
	"log"

	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func Page(ctx context.Context, props map[string]any) any {
	clicked, setClicked := vdom.UseState(ctx, false)
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
	<Button onClick="#bind:clickFn">hello</Button>
	<bind key="clickedDiv"/>
</div>
`,
		map[string]any{"clickFn": clickFn, "clickedDiv": clickedDiv},
	)
}

func Button(ctx context.Context, props map[string]any) any {
	ref := vdom.UseVDomRef(ctx)
	clName, setClName := vdom.UseState(ctx, "button")
	vdom.UseEffect(ctx, func() func() {
		fmt.Printf("Button useEffect\n")
		setClName("button mounted")
		return nil
	}, nil)
	return vdom.Bind(`
		<div className="#bind:clName" ref="#bind:ref" onClick="#bind:onClick">
			<bind key="children"/>
		</div>
	`, map[string]any{"clName": clName, "ref": ref, "onClick": props["onClick"], "children": props["children"]})
}

func main() {
	wshutil.SetTermRawModeAndInstallShutdownHandlers(true)
	defer wshutil.RestoreTermState()
}
