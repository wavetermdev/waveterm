package vdom

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"testing"
)

type renderContextKeyType struct{}

var renderContextKey = renderContextKeyType{}

type TestContext struct {
	ButtonId string
}

func Page(ctx context.Context, props map[string]any) any {
	clicked, setClicked := UseState(ctx, false)
	var clickedDiv *Elem
	if clicked {
		clickedDiv = Bind(`<div>clicked</div>`, nil)
	}
	clickFn := func() {
		log.Printf("run clickFn\n")
		setClicked(true)
	}
	return Bind(
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
	ref := UseRef(ctx, nil)
	clName, setClName := UseState(ctx, "button")
	UseEffect(ctx, func() func() {
		fmt.Printf("Button useEffect\n")
		setClName("button mounted")
		return nil
	}, nil)
	compId := UseId(ctx)
	testContext := getTestContext(ctx)
	if testContext != nil {
		testContext.ButtonId = compId
	}
	return Bind(`
		<div className="#bind:clName" ref="#bind:ref" onClick="#bind:onClick">
			<bind key="children"/>
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
	root.Render(E("Page"))
	if root.Root == nil {
		t.Fatalf("root.Root is nil")
	}
	printVDom(root)
	root.runWork()
	printVDom(root)
	root.Event(testContext.ButtonId, "onClick")
	root.runWork()
	printVDom(root)
}

func TestBind(t *testing.T) {
	elem := Bind(`<div>clicked</div>`, nil)
	jsonBytes, _ := json.MarshalIndent(elem, "", "  ")
	log.Printf("%s\n", string(jsonBytes))

	elem = Bind(`
	<div>
	    clicked
    </div>`, nil)
	jsonBytes, _ = json.MarshalIndent(elem, "", "  ")
	log.Printf("%s\n", string(jsonBytes))

	elem = Bind(`<Button>foo</Button>`, nil)
	jsonBytes, _ = json.MarshalIndent(elem, "", "  ")
	log.Printf("%s\n", string(jsonBytes))

	elem = Bind(`
<div>
    <h1>hello world</h1>
	<Button onClick="#bind:clickFn">hello</Button>
	<bind key="clickedDiv"/>
</div>
`, nil)
	jsonBytes, _ = json.MarshalIndent(elem, "", "  ")
	log.Printf("%s\n", string(jsonBytes))
}
