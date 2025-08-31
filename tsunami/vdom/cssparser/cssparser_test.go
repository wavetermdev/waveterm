// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cssparser

import (
	"fmt"
	"log"
	"testing"
)

func compareMaps(a, b map[string]string) error {
	if len(a) != len(b) {
		return fmt.Errorf("map length mismatch: %d != %d", len(a), len(b))
	}
	for k, v := range a {
		if b[k] != v {
			return fmt.Errorf("value mismatch for key %s: %q != %q", k, v, b[k])
		}
	}
	return nil
}

func TestParse1(t *testing.T) {
	style := `background: url("example;with;semicolons.jpg"); color: red; margin-right: 5px; content: "hello;world";`
	p := MakeParser(style)
	parsed, err := p.Parse()
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
		return
	}
	expected := map[string]string{
		"background":   `url("example;with;semicolons.jpg")`,
		"color":        "red",
		"margin-right": "5px",
		"content":      `"hello;world"`,
	}
	if err := compareMaps(parsed, expected); err != nil {
		t.Fatalf("Parsed map does not match expected: %v", err)
	}

	style = `margin-right: calc(10px + 5px); color: red; font-family: "Arial";`
	p = MakeParser(style)
	parsed, err = p.Parse()
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
		return
	}
	expected = map[string]string{
		"margin-right": `calc(10px + 5px)`,
		"color":        "red",
		"font-family":  `"Arial"`,
	}
	if err := compareMaps(parsed, expected); err != nil {
		t.Fatalf("Parsed map does not match expected: %v", err)
	}
}

func TestParserErrors(t *testing.T) {
	style := `hello more: bad;`
	p := MakeParser(style)
	_, err := p.Parse()
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	log.Printf("got expected error: %v\n", err)
	style = `background: url("example.jpg`
	p = MakeParser(style)
	_, err = p.Parse()
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	log.Printf("got expected error: %v\n", err)
	style = `foo: url(...`
	p = MakeParser(style)
	_, err = p.Parse()
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	log.Printf("got expected error: %v\n", err)
}