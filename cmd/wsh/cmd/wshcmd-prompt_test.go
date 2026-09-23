// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import "testing"

func TestParseOptionsFlag(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    []string
		wantErr bool
	}{
		{
			name: "empty returns nil",
			in:   "",
			want: nil,
		},
		{
			name: "whitespace only returns nil",
			in:   "   ",
			want: nil,
		},
		{
			name: "single option",
			in:   "yes",
			want: []string{"yes"},
		},
		{
			name: "two options",
			in:   "yes,no",
			want: []string{"yes", "no"},
		},
		{
			name: "three options",
			in:   "a,b,c",
			want: []string{"a", "b", "c"},
		},
		{
			name: "trims whitespace",
			in:   " yes , no , maybe ",
			want: []string{"yes", "no", "maybe"},
		},
		{
			name:    "empty option errors",
			in:      "a,,b",
			wantErr: true,
		},
		{
			name:    "leading comma errors",
			in:      ",a",
			wantErr: true,
		},
		{
			name:    "trailing comma errors",
			in:      "a,",
			wantErr: true,
		},
		{
			name:    "comma with spaces errors",
			in:      "a, ,b",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseOptionsFlag(tt.in)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parseOptionsFlag(%q) expected error, got nil", tt.in)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseOptionsFlag(%q) unexpected error: %v", tt.in, err)
			}
			if len(got) != len(tt.want) {
				t.Fatalf("parseOptionsFlag(%q) = %v, want %v", tt.in, got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("parseOptionsFlag(%q)[%d] = %q, want %q", tt.in, i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestPromptTimeouts(t *testing.T) {
	tests := []struct {
		name           string
		in             string
		wantTimeoutMs  int
		wantRpcTimeout int64
		wantErr        bool
	}{
		{
			name:           "empty uses 60s default",
			in:             "",
			wantTimeoutMs:  60000,
			wantRpcTimeout: 90000,
		},
		{
			name:           "60s flag",
			in:             "60s",
			wantTimeoutMs:  60000,
			wantRpcTimeout: 90000,
		},
		{
			name:           "30s plus 30s slack",
			in:             "30s",
			wantTimeoutMs:  30000,
			wantRpcTimeout: 60000,
		},
		{
			name:           "5m plus 30s slack",
			in:             "5m",
			wantTimeoutMs:  300000,
			wantRpcTimeout: 330000,
		},
		{
			name:           "integer seconds",
			in:             "12",
			wantTimeoutMs:  12000,
			wantRpcTimeout: 42000,
		},
		{
			name:    "invalid duration",
			in:      "nope",
			wantErr: true,
		},
		{
			name:    "zero errors",
			in:      "0",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			timeoutMs, rpcTimeoutMs, err := promptTimeouts(tt.in)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("promptTimeouts(%q) expected error, got nil", tt.in)
				}
				return
			}
			if err != nil {
				t.Fatalf("promptTimeouts(%q) unexpected error: %v", tt.in, err)
			}
			if timeoutMs != tt.wantTimeoutMs {
				t.Fatalf("promptTimeouts(%q) timeoutMs = %d, want %d", tt.in, timeoutMs, tt.wantTimeoutMs)
			}
			if rpcTimeoutMs != tt.wantRpcTimeout {
				t.Fatalf("promptTimeouts(%q) rpcTimeoutMs = %d, want %d", tt.in, rpcTimeoutMs, tt.wantRpcTimeout)
			}
		})
	}
}

func TestMakePromptData(t *testing.T) {
	data := makePromptData("Deploy?", []string{"yes", "no"}, "Confirm", "no", 60000)
	if data.Question != "Deploy?" {
		t.Fatalf("Question = %q, want %q", data.Question, "Deploy?")
	}
	if len(data.Options) != 2 || data.Options[0] != "yes" || data.Options[1] != "no" {
		t.Fatalf("Options = %v, want [yes no]", data.Options)
	}
	if data.Title != "Confirm" {
		t.Fatalf("Title = %q, want %q", data.Title, "Confirm")
	}
	if data.DefaultOption != "no" {
		t.Fatalf("DefaultOption = %q, want %q", data.DefaultOption, "no")
	}
	if data.TimeoutMs != 60000 {
		t.Fatalf("TimeoutMs = %d, want 60000", data.TimeoutMs)
	}
}
