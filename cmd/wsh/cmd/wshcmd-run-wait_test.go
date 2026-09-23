// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTrailerMarker(t *testing.T) {
	if got := trailerMarker(0); got != "\r\nprocess finished with exit code = 0\r\n\r\n" {
		t.Errorf("trailerMarker(0) = %q, want trailing CRLF framing", got)
	}
	if got := trailerMarker(127); got != "\r\nprocess finished with exit code = 127\r\n\r\n" {
		t.Errorf("trailerMarker(127) = %q, want exit code 127", got)
	}
}

func TestStripCmdTrailer(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		exitCode int
		want     string
	}{
		{
			name:     "exact trailer stripped",
			input:    "hello world\r\nprocess finished with exit code = 0\r\n\r\n",
			exitCode: 0,
			want:     "hello world",
		},
		{
			name:     "trailer with different exit code preserved",
			input:    "process finished with exit code = 7\r\n",
			exitCode: 0,
			want:     "process finished with exit code = 7\r\n",
		},
		{
			name:     "no trailer unchanged",
			input:    "some output\n",
			exitCode: 0,
			want:     "some output\n",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := stripCmdTrailer(tc.input, tc.exitCode)
			if got != tc.want {
				t.Errorf("stripCmdTrailer(%q, %d) = %q, want %q", tc.input, tc.exitCode, got, tc.want)
			}
		})
	}
}

func TestCleanCmdOutput(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		exitCode int
		want     string
	}{
		{
			name:     "simple output with trailer",
			input:    "hello\r\nprocess finished with exit code = 0\r\n\r\n",
			exitCode: 0,
			want:     "hello",
		},
		{
			name:     "strips SGR color codes",
			input:    "\x1b[32mok\x1b[0m\r\nprocess finished with exit code = 0\r\n\r\n",
			exitCode: 0,
			want:     "ok",
		},
		{
			name:     "strips terminal reset sequence and muted message",
			input:    "done\x1b[0m\x1b[?25h\x1b[?2004l\r\n[command exited - press enter to close]\r\nprocess finished with exit code = 0\r\n\r\n",
			exitCode: 0,
			want:     "done",
		},
		{
			name:     "exit code 1 trailer",
			input:    "boom\r\nprocess finished with exit code = 1\r\n\r\n",
			exitCode: 1,
			want:     "boom",
		},
		{
			name:     "empty output",
			input:    "\r\nprocess finished with exit code = 0\r\n\r\n",
			exitCode: 0,
			want:     "",
		},
		{
			name:     "no trailer and no ansi",
			input:    "plain output",
			exitCode: 0,
			want:     "plain output",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := cleanCmdOutput(tc.input, tc.exitCode)
			if got != tc.want {
				t.Errorf("cleanCmdOutput(%q, %d) = %q, want %q", tc.input, tc.exitCode, got, tc.want)
			}
		})
	}
}

func TestRunJSONOutputMarshal(t *testing.T) {
	out := runJSONOutput{
		Stdout:       "hello",
		Stderr:       "",
		ExitCode:     0,
		DurationMs:   123,
		BlockId:      "block:abc",
		OutputMerged: true,
	}
	data, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}
	if m["stdout"] != "hello" {
		t.Errorf("stdout = %v, want hello", m["stdout"])
	}
	if m["stderr"] != "" {
		t.Errorf("stderr = %v, want empty", m["stderr"])
	}
	if m["exitcode"] != float64(0) {
		t.Errorf("exitcode = %v, want 0", m["exitcode"])
	}
	if m["durationms"] != float64(123) {
		t.Errorf("durationms = %v, want 123", m["durationms"])
	}
	if m["blockid"] != "block:abc" {
		t.Errorf("blockid = %v, want block:abc", m["blockid"])
	}
	if m["outputmerged"] != true {
		t.Errorf("outputmerged = %v, want true", m["outputmerged"])
	}
	// JSON must be a single line (no stray newlines on stdout).
	if strings.Contains(string(data), "\n") {
		t.Errorf("marshaled JSON contains newline: %q", string(data))
	}
}

func TestRunWaitTimeoutErrorIncludesBlockId(t *testing.T) {
	err := runWaitTimeoutError("abc-block", "running")
	if err == nil {
		t.Fatal("expected error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "abc-block") {
		t.Errorf("timeout error %q missing block id", msg)
	}
	if !strings.Contains(msg, "running") {
		t.Errorf("timeout error %q missing last status", msg)
	}
}

func TestIsNonLocalConnName(t *testing.T) {
	tests := []struct {
		name     string
		connName string
		want     bool
	}{
		{name: "empty", connName: "", want: false},
		{name: "local", connName: "local", want: false},
		{name: "local variant", connName: "local:gitbash", want: false},
		{name: "wsl", connName: "wsl://Ubuntu", want: false},
		{name: "ssh host", connName: "user@host", want: true},
		{name: "ssh hostname", connName: "prod-server", want: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isNonLocalConnName(tc.connName); got != tc.want {
				t.Errorf("isNonLocalConnName(%q) = %v, want %v", tc.connName, got, tc.want)
			}
		})
	}
}
