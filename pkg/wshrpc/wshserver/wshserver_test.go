// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"reflect"
	"testing"
)

func TestParseTmuxSessionList(t *testing.T) {
	const s = tmuxSessionSentinel
	tests := []struct {
		name   string
		stdout string
		want   []string
	}{
		{
			name:   "empty output",
			stdout: "",
			want:   []string{},
		},
		{
			name:   "single session",
			stdout: s + "mactop\n",
			want:   []string{"mactop"},
		},
		{
			name:   "multiple sessions",
			stdout: s + "mactop\n" + s + "omlx-11335\n" + s + "omlx-11336\n",
			want:   []string{"mactop", "omlx-11335", "omlx-11336"},
		},
		{
			name:   "blank lines are discarded",
			stdout: "\n" + s + "mactop\n\n" + s + "omlx-11335\n\n",
			want:   []string{"mactop", "omlx-11335"},
		},
		{
			name:   "CRLF line endings",
			stdout: s + "mactop\r\n" + s + "omlx-11335\r\n",
			want:   []string{"mactop", "omlx-11335"},
		},
		{
			name:   "session name with spaces",
			stdout: s + "my session with spaces\n",
			want:   []string{"my session with spaces"},
		},
		{
			name:   "session name with leading/trailing whitespace is preserved",
			stdout: s + "  padded-name  \n",
			want:   []string{"  padded-name  "},
		},
		{
			name:   "ignores unsentineled lines",
			stdout: "some other output\n" + s + "mactop\n",
			want:   []string{"mactop"},
		},
		{
			name:   "login shell profile output before tmux records",
			stdout: "Last login: Thu Aug 26 14:00:00 2026 on ttys000\nWelcome to bash\n" + s + "mactop\n" + s + "omlx-11335\n",
			want:   []string{"mactop", "omlx-11335"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseTmuxSessionList(tt.stdout)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("parseTmuxSessionList(%q) = %#v, want %#v", tt.stdout, got, tt.want)
			}
		})
	}
}

func TestAppendTmuxSessionLine(t *testing.T) {
	const s = tmuxSessionSentinel
	var sessions []string
	sessions = appendTmuxSessionLine(sessions, "not a tmux record", s)
	sessions = appendTmuxSessionLine(sessions, s+"mactop", s)
	sessions = appendTmuxSessionLine(sessions, s+"  spaced name  ", s)             // name whitespace preserved
	sessions = appendTmuxSessionLine(sessions, "  "+s+"leading-space-sentinel", s) // sentinel not at line start → ignored
	sessions = appendTmuxSessionLine(sessions, s, s)                               // sentinel with no name
	sessions = appendTmuxSessionLine(sessions, "", s)
	sessions = appendTmuxSessionLine(sessions, s+"crlf\r", s) // trailing CR stripped
	if !reflect.DeepEqual(sessions, []string{"mactop", "  spaced name  ", "crlf"}) {
		t.Fatalf("appendTmuxSessionLine produced %#v", sessions)
	}
}
