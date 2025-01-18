// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package shellutil

import "testing"

func TestQuote(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantHard string
		wantSoft string
	}{
		{
			name:     "simple strings",
			input:    "simple",
			wantHard: "simple",
			wantSoft: "simple",
		},
		{
			name:     "safe path",
			input:    "path/to/file.txt",
			wantHard: "path/to/file.txt",
			wantSoft: "path/to/file.txt",
		},
		{
			name:     "empty string",
			input:    "",
			wantHard: `""`,
			wantSoft: `""`,
		},
		{
			name:     "tilde alone",
			input:    "~",
			wantHard: `"~"`,
			wantSoft: "~",
		},
		{
			name:     "tilde with safe path",
			input:    "~/foo",
			wantHard: `"~/foo"`,
			wantSoft: "~/foo",
		},
		{
			name:     "tilde with spaces",
			input:    "~/foo bar",
			wantHard: `"~/foo bar"`,
			wantSoft: `~"/foo bar"`,
		},
		{
			name:     "tilde with variable",
			input:    "~/foo$bar",
			wantHard: `"~/foo\$bar"`,
			wantSoft: `~"/foo$bar"`,
		},
		{
			name:     "invalid tilde path",
			input:    "~foo",
			wantHard: `"~foo"`,
			wantSoft: `"~foo"`,
		},
		{
			name:     "variable at start",
			input:    "$HOME/.config",
			wantHard: `"\$HOME/.config"`,
			wantSoft: `"$HOME/.config"`,
		},
		{
			name:     "variable in middle",
			input:    "prefix$HOME",
			wantHard: `"prefix\$HOME"`,
			wantSoft: `"prefix$HOME"`,
		},
		{
			name:     "double quotes",
			input:    `has "quotes"`,
			wantHard: `"has \"quotes\""`,
			wantSoft: `"has \"quotes\""`,
		},
		{
			name:     "backslash",
			input:    `back\slash`,
			wantHard: `"back\\slash"`,
			wantSoft: `"back\\slash"`,
		},
		{
			name:     "backtick",
			input:    "`cmd`",
			wantHard: "\"\\`cmd\\`\"",
			wantSoft: "\"\\`cmd\\`\"",
		},
		{
			name:     "spaces",
			input:    "spaces here",
			wantHard: `"spaces here"`,
			wantSoft: `"spaces here"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := HardQuote(tt.input); got != tt.wantHard {
				t.Errorf("HardQuote(%q) = %q, want %q", tt.input, got, tt.wantHard)
			}
			if got := SoftQuote(tt.input); got != tt.wantSoft {
				t.Errorf("SoftQuote(%q) = %q, want %q", tt.input, got, tt.wantSoft)
			}
		})
	}
}
