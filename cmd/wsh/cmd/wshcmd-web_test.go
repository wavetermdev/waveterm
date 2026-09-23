// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"
	"time"
)

func TestSelectWebRunScript(t *testing.T) {
	tests := []struct {
		name    string
		args    []string
		stdin   string
		want    string
		wantErr bool
	}{
		{name: "args join with space", args: []string{"await", "print(1)"}, stdin: "ignored", want: "await print(1)"},
		{name: "args win over stdin", args: []string{"await snapshot()"}, stdin: "await print(1)", want: "await snapshot()"},
		{name: "stdin when no args", args: nil, stdin: "await print(1)", want: "await print(1)"},
		{name: "empty args and empty stdin errors", args: nil, stdin: "", wantErr: true},
		{name: "whitespace-only stdin errors", args: nil, stdin: "  \n", wantErr: true},
		{name: "whitespace-only args error", args: []string{"  "}, stdin: "real", wantErr: true},
		{name: "heredoc stdin preserved", args: nil, stdin: "await navigate(\"https://example.com\");\nawait print(await snapshot());\n", want: "await navigate(\"https://example.com\");\nawait print(await snapshot());\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := selectWebRunScript(tt.args, []byte(tt.stdin))
			if (err != nil) != tt.wantErr {
				t.Errorf("selectWebRunScript() err = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			if got != tt.want {
				t.Errorf("selectWebRunScript() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCheckWebRunScriptSize(t *testing.T) {
	if err := checkWebRunScriptSize("ok"); err != nil {
		t.Errorf("small script: %v", err)
	}
	if err := checkWebRunScriptSize(strings.Repeat("a", webRunMaxScriptBytes)); err != nil {
		t.Errorf("exact max size: %v", err)
	}
	err := checkWebRunScriptSize(strings.Repeat("a", webRunMaxScriptBytes+1))
	if err == nil {
		t.Errorf("oversized script: want error")
	} else if !strings.Contains(err.Error(), "max size") {
		t.Errorf("oversized script error = %v, want max size", err)
	}
}

func TestParseWebRunTimeout(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    time.Duration
		wantErr bool
	}{
		{name: "empty uses 60s default", in: "", want: 60 * time.Second},
		{name: "30s", in: "30s", want: 30 * time.Second},
		{name: "5m max", in: "5m", want: 5 * time.Minute},
		{name: "integer seconds", in: "12", want: 12 * time.Second},
		{name: "over max errors", in: "6m", wantErr: true},
		{name: "garbage errors", in: "nope", wantErr: true},
		{name: "zero errors", in: "0", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseWebRunTimeout(tt.in)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseWebRunTimeout(%q) err = %v, wantErr %v", tt.in, err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			if got != tt.want {
				t.Errorf("parseWebRunTimeout(%q) = %s, want %s", tt.in, got, tt.want)
			}
		})
	}
}

func TestErrNotAWebBlock(t *testing.T) {
	err := errNotAWebBlock("abc-123")
	if err == nil {
		t.Fatal("expected error")
	}
	want := "block abc-123 is not a web block"
	if err.Error() != want {
		t.Errorf("error = %q, want %q", err.Error(), want)
	}
}

func TestWebGetIsNotHidden(t *testing.T) {
	if webGetCmd.Hidden {
		t.Errorf("web get should not be Hidden")
	}
}

func TestWebSubcommandsRegistered(t *testing.T) {
	needles := []string{"open", "get", "snapshot", "screenshot", "run"}
	found := map[string]bool{}
	for _, c := range webCmd.Commands() {
		found[c.Name()] = true
	}
	for _, n := range needles {
		if !found[n] {
			t.Errorf("web cmd missing subcommand %q", n)
		}
	}
}

func TestWebRunRpcTimeoutSlack(t *testing.T) {
	d, err := parseWebRunTimeout("90s")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	rpcMs := (d + webRunRpcTimeoutSlack).Milliseconds()
	if rpcMs != 110000 {
		t.Errorf("rpc timeout ms = %d, want 110000 (run + 20s)", rpcMs)
	}
}

func TestWebGetRpcTimeout(t *testing.T) {
	if webGetRpcTimeout != 15*time.Second {
		t.Errorf("web get rpc timeout = %s, want 15s", webGetRpcTimeout)
	}
}
