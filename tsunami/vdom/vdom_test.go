package vdom

import (
	"encoding/json"
	"log"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/tsunami/util"
)

func TestH(t *testing.T) {
	elem := H("div", nil, "clicked")
	jsonBytes, _ := json.MarshalIndent(elem, "", "  ")
	log.Printf("%s\n", string(jsonBytes))

	elem = H("div", nil, "clicked")
	jsonBytes, _ = json.MarshalIndent(elem, "", "  ")
	log.Printf("%s\n", string(jsonBytes))

	elem = H("Button", nil, "foo")
	jsonBytes, _ = json.MarshalIndent(elem, "", "  ")
	log.Printf("%s\n", string(jsonBytes))

	clickFn := "test-click-function"
	clickedDiv := H("div", nil, "test-content")
	elem = H("div", nil,
		H("h1", nil, "hello world"),
		H("Button", map[string]any{"onClick": clickFn}, "hello"),
		clickedDiv,
	)
	jsonBytes, _ = json.MarshalIndent(elem, "", "  ")
	log.Printf("%s\n", string(jsonBytes))
}

func TestJsonH(t *testing.T) {
	elem := H("div", map[string]any{
		"data1": 5,
		"data2": []any{1, 2, 3},
		"data3": map[string]any{"a": 1},
	})
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
