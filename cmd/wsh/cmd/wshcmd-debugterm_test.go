// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"
)

func TestFormatDebugTermHex(t *testing.T) {
	output := formatDebugTermHex([]byte("abc"))
	if !strings.Contains(output, "61 62 63") {
		t.Fatalf("unexpected hex output: %q", output)
	}
}

func TestFormatDebugTermDecode(t *testing.T) {
	data := []byte("abc\x1b[31mred\x1b[0m\x07\x1b]0;title\x07\x00")
	output := formatDebugTermDecode(data)
	expected := []string{
		`TXT "abc"`,
		`CSI m 31`,
		`TXT "red"`,
		`CSI m 0`,
		`BEL`,
		`OSC 0 "title"`,
		`CTL 0x00`,
	}
	for _, line := range expected {
		if !strings.Contains(output, line) {
			t.Fatalf("missing decode line %q in output %q", line, output)
		}
	}
}

func TestParseDebugTermStdinData(t *testing.T) {
	data, err := parseDebugTermStdinData([]byte(`["abc","\u001b[31mred","\u001b[0m"]`))
	if err != nil {
		t.Fatalf("parseDebugTermStdinData() error: %v", err)
	}
	output := formatDebugTermDecode(data)
	expected := []string{
		`TXT "abc"`,
		`CSI m 31`,
		`TXT "red"`,
		`CSI m 0`,
	}
	for _, line := range expected {
		if !strings.Contains(output, line) {
			t.Fatalf("missing decode line %q in output %q", line, output)
		}
	}
}

func TestParseDebugTermStdinDataStructs(t *testing.T) {
	data, err := parseDebugTermStdinData([]byte(`[{"data":"abc"},{"data":"\u001b[31mred"},{"data":"\u001b[0m"}]`))
	if err != nil {
		t.Fatalf("parseDebugTermStdinData() error: %v", err)
	}
	output := formatDebugTermDecode(data)
	expected := []string{
		`TXT "abc"`,
		`CSI m 31`,
		`TXT "red"`,
		`CSI m 0`,
	}
	for _, line := range expected {
		if !strings.Contains(output, line) {
			t.Fatalf("missing decode line %q in output %q", line, output)
		}
	}
}

func TestFormatDebugTermDecodeCursorForward(t *testing.T) {
	// CSI C sequences collapse into adjacent text; all consecutive text+CSI-C runs merge into one TXT line.
	// The run is split into separate TXT lines at CR/LF run boundaries; // NC appears on the last line.
	data := []byte("hi\x1b[1Cworld\x1b[3Cfoo\r\nbar")
	output := formatDebugTermDecode(data)
	expected := []string{
		`TXT "hi world   foo\r\n"`,
		`TXT "bar" // 4C`,
	}
	for _, line := range expected {
		if !strings.Contains(output, line) {
			t.Fatalf("missing decode line %q in output:\n%s", line, output)
		}
	}
}

func TestParseDebugTermStdinDataRaw(t *testing.T) {
	raw := []byte("hello\x1b[31mworld")
	data, err := parseDebugTermStdinData(raw)
	if err != nil {
		t.Fatalf("parseDebugTermStdinData() error: %v", err)
	}
	if string(data) != string(raw) {
		t.Fatalf("expected raw passthrough, got %q", data)
	}
}
