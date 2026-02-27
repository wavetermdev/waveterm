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
		`CSI "\x1b[31m"`,
		`TXT "red"`,
		`CSI "\x1b[0m"`,
		`BEL`,
		`OSC "\x1b]0;title\a"`,
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
		`CSI "\x1b[31m"`,
		`TXT "red"`,
		`CSI "\x1b[0m"`,
	}
	for _, line := range expected {
		if !strings.Contains(output, line) {
			t.Fatalf("missing decode line %q in output %q", line, output)
		}
	}
}

func TestParseDebugTermStdinDataInvalid(t *testing.T) {
	_, err := parseDebugTermStdinData([]byte(`{"not":"array"}`))
	if err == nil {
		t.Fatalf("expected error for invalid stdin json")
	}
}
