package vdom

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/tsunami/util"
)

type renderContextKeyType struct{}

var renderContextKey = renderContextKeyType{}

type TestContext struct {
	ButtonId string
}

func Page(ctx context.Context, props map[string]any) any {
	clicked, setClicked := UseState(ctx, false)
	var clickedDiv *VDomElem
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
	<Button onClick="#param:clickFn">hello</Button>
	<bindparam key="clickedDiv"/>
</div>
`,
		map[string]any{"clickFn": clickFn, "clickedDiv": clickedDiv},
	)
}

func Button(ctx context.Context, props map[string]any) any {
	ref := UseVDomRef(ctx)
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
	root.Render(E("Page"))
	if root.Root == nil {
		t.Fatalf("root.Root is nil")
	}
	printVDom(root)
	root.RunWork()
	printVDom(root)
	root.Event(testContext.ButtonId, "onClick", VDomEvent{EventType: "onClick"})
	root.RunWork()
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
	<Button onClick="#param:clickFn">hello</Button>
	<bindparam key="clickedDiv"/>
</div>
`, nil)
	jsonBytes, _ = json.MarshalIndent(elem, "", "  ")
	log.Printf("%s\n", string(jsonBytes))
}

func TestJsonBind(t *testing.T) {
	elem := Bind(`<div data1={5} data2={[1,2,3]} data3={{"a": 1}}/>`, nil)
	if elem == nil {
		t.Fatalf("elem is nil")
	}
	if elem.Tag != "div" {
		t.Fatalf("elem.Tag: %s (expected 'div')\n", elem.Tag)
	}
	if elem.Props == nil || len(elem.Props) != 3 {
		t.Fatalf("elem.Props: %v\n", elem.Props)
	}
	data1Val, ok := elem.Props["data1"]
	if !ok {
		t.Fatalf("data1 not found\n")
	}
	_, ok = data1Val.(float64)
	if !ok {
		t.Fatalf("data1: %T\n", data1Val)
	}
	data1Int, ok := util.ToInt(data1Val)
	if !ok || data1Int != 5 {
		t.Fatalf("data1: %v\n", data1Val)
	}
	data2Val, ok := elem.Props["data2"]
	if !ok {
		t.Fatalf("data2 not found\n")
	}
	d2type := reflect.TypeOf(data2Val)
	if d2type.Kind() != reflect.Slice {
		t.Fatalf("data2: %T\n", data2Val)
	}
	data2Arr := data2Val.([]any)
	if len(data2Arr) != 3 {
		t.Fatalf("data2: %v\n", data2Val)
	}
	d2v2, ok := data2Arr[1].(float64)
	if !ok || d2v2 != 2 {
		t.Fatalf("data2: %v\n", data2Val)
	}
	data3Val, ok := elem.Props["data3"]
	if !ok || data3Val == nil {
		t.Fatalf("data3 not found\n")
	}
	d3type := reflect.TypeOf(data3Val)
	if d3type.Kind() != reflect.Map {
		t.Fatalf("data3: %T\n", data3Val)
	}
	data3Map := data3Val.(map[string]any)
	if len(data3Map) != 1 {
		t.Fatalf("data3: %v\n", data3Val)
	}
	d3v1, ok := data3Map["a"]
	if !ok {
		t.Fatalf("data3: %v\n", data3Val)
	}
	mval, ok := util.ToInt(d3v1)
	if !ok || mval != 1 {
		t.Fatalf("data3: %v\n", data3Val)
	}
	log.Printf("elem: %v\n", elem)
}
