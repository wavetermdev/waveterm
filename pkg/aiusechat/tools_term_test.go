// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"
)

func TestParseTermSendInputInputDefaults(t *testing.T) {
	parsed, err := parseTermSendInputInput(map[string]any{
		"widget_id":  "abc12345",
		"input_text": "ls -la",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if parsed.WidgetId != "abc12345" {
		t.Fatalf("widget_id mismatch: %q", parsed.WidgetId)
	}
	if parsed.InputText != "ls -la" {
		t.Fatalf("input_text mismatch: %q", parsed.InputText)
	}
	if !termSendInputPressEnter(parsed) {
		t.Fatalf("press_enter should default to true")
	}
}

func TestParseTermSendInputInputPressEnterFalse(t *testing.T) {
	parsed, err := parseTermSendInputInput(map[string]any{
		"widget_id":   "abc12345",
		"input_text":  "y",
		"press_enter": false,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if termSendInputPressEnter(parsed) {
		t.Fatalf("press_enter=false should be respected")
	}
}

func TestParseTermSendInputInputRequiresFields(t *testing.T) {
	cases := []struct {
		name string
		in   any
	}{
		{"nil_input", nil},
		{"empty_widget", map[string]any{"widget_id": "", "input_text": "ls"}},
		{"empty_text", map[string]any{"widget_id": "abc12345", "input_text": ""}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := parseTermSendInputInput(tc.in); err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
		})
	}
}

func TestParseTermSendInputInputRejectsControlChars(t *testing.T) {
	disallowed := []string{
		"echo hi\x03",   // SIGINT
		"foo\x04",       // EOF
		"\x1b[31mred",   // ANSI escape
		"weird\x7fchar", // DEL
		"bell\x07",
	}
	for _, s := range disallowed {
		if _, err := parseTermSendInputInput(map[string]any{
			"widget_id":  "abc12345",
			"input_text": s,
		}); err == nil {
			t.Fatalf("expected rejection for %q", s)
		}
	}
}

func TestParseTermSendInputInputAllowsTabsAndNewlines(t *testing.T) {
	if _, err := parseTermSendInputInput(map[string]any{
		"widget_id":  "abc12345",
		"input_text": "echo a\tb\nc\rd",
	}); err != nil {
		t.Fatalf("unexpected rejection: %v", err)
	}
}

func TestParseTermSendInputInputRejectsTooLong(t *testing.T) {
	long := strings.Repeat("a", termSendInputMaxLen+1)
	if _, err := parseTermSendInputInput(map[string]any{
		"widget_id":  "abc12345",
		"input_text": long,
	}); err == nil {
		t.Fatalf("expected rejection for oversized input_text")
	}
}

func TestTermSendInputDescribeEscapes(t *testing.T) {
	got := termSendInputDescribe("ls\nfoo\tbar", true)
	if !strings.Contains(got, `\n`) || !strings.Contains(got, `\t`) {
		t.Fatalf("expected escaped output, got %q", got)
	}
	if !strings.HasSuffix(got, "<Enter>") {
		t.Fatalf("expected <Enter> suffix, got %q", got)
	}
	noEnter := termSendInputDescribe("ls", false)
	if strings.Contains(noEnter, "<Enter>") {
		t.Fatalf("did not expect <Enter> suffix, got %q", noEnter)
	}
}
