// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import "testing"

func TestFishCwdExpr(t *testing.T) {
	tests := []struct {
		name string
		cwd  string
		want string
	}{
		{
			name: "tilde-alone",
			cwd:  "~",
			want: "~",
		},
		{
			name: "tilde-dir",
			cwd:  "~/.ssh",
			want: "\"$HOME/.ssh\"",
		},
		{
			name: "tilde-with-spaces",
			cwd:  "~/Documents/My Files",
			want: "\"$HOME/Documents/My Files\"",
		},
		{
			name: "absolute-path",
			cwd:  "/var/log",
			want: "/var/log",
		},
		{
			name: "path-with-spaces-quoted",
			cwd:  "/path with spaces",
			want: "'/path with spaces'",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := fishCwdExpr(tt.cwd)
			if got != tt.want {
				t.Fatalf("fishCwdExpr(%q)=%q, want %q", tt.cwd, got, tt.want)
			}
		})
	}
}

func TestPwshCwdExpr(t *testing.T) {
	tests := []struct {
		name string
		cwd  string
		want string
	}{
		{
			name: "tilde-alone",
			cwd:  "~",
			want: "~",
		},
		{
			name: "tilde-dir",
			cwd:  "~/.ssh",
			want: "~/.ssh",
		},
		{
			name: "tilde-with-spaces",
			cwd:  "~/Documents/My Files",
			want: "~'/Documents/My Files'",
		},
		{
			name: "tilde-with-dollars",
			cwd:  "~/path$with$dollars",
			want: "~'/path$with$dollars'",
		},
		{
			name: "tilde-with-backticks",
			cwd:  "~/path`with`backticks",
			want: "~'/path`with`backticks'",
		},
		{
			name: "tilde-with-single-quotes",
			cwd:  "~/path'with'quotes",
			want: "~'/path''with''quotes'",
		},
		{
			name: "absolute-path",
			cwd:  "/var/log",
			want: "/var/log",
		},
		{
			name: "path-with-spaces-quoted",
			cwd:  "/path with spaces",
			want: "'/path with spaces'",
		},
		{
			name: "path-with-dollars",
			cwd:  "/path$with$dollars",
			want: "'/path$with$dollars'",
		},
		{
			name: "path-with-parens",
			cwd:  "/path(with)parens",
			want: "'/path(with)parens'",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := pwshCwdExpr(tt.cwd)
			if got != tt.want {
				t.Fatalf("pwshCwdExpr(%q)=%q, want %q", tt.cwd, got, tt.want)
			}
		})
	}
}

func TestPosixCwdExprNoWshRemote(t *testing.T) {
	tests := []struct {
		name    string
		cwd     string
		sshUser string
		want    string
	}{
		{
			name:    "tilde-dir-uses-username-home",
			cwd:     "~/.ssh",
			sshUser: "root",
			want:    "~root/.ssh",
		},
		{
			name:    "tilde-root-uses-username-home",
			cwd:     "~",
			sshUser: "root",
			want:    "~root",
		},
		{
			name:    "tilde-slash-uses-username-home",
			cwd:     "~/",
			sshUser: "root",
			want:    "~root/",
		},
		{
			name:    "non-tilde-falls-back",
			cwd:     "/var/log",
			sshUser: "root",
			want:    "/var/log",
		},
		{
			name:    "missing-user-falls-back-to-home-var",
			cwd:     "~/.ssh",
			sshUser: "",
			want:    "\"$HOME/.ssh\"",
		},
		{
			name:    "tilde-with-spaces-and-user",
			cwd:     "~/My Documents",
			sshUser: "root",
			want:    "~root'/My Documents'",
		},
		{
			name:    "tilde-with-special-chars-and-user",
			cwd:     "~/a;echo pwn",
			sshUser: "root",
			want:    "~root'/a;echo pwn'",
		},
		{
			name:    "tilde-with-quoted-path",
			cwd:     `~/"quoted"`,
			sshUser: "root",
			want:    `~root'/"quoted"'`,
		},
		{
			name:    "tilde-with-spaces-no-user",
			cwd:     "~/My Docs",
			sshUser: "",
			want:    "\"$HOME/My Docs\"",
		},
		{
			name:    "tilde-with-special-chars-no-user",
			cwd:     "~/a;echo pwn",
			sshUser: "",
			want:    "\"$HOME/a;echo pwn\"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := posixCwdExprNoWshRemote(tt.cwd, tt.sshUser)
			if got != tt.want {
				t.Fatalf("posixCwdExprNoWshRemote(%q, %q)=%q, want %q", tt.cwd, tt.sshUser, got, tt.want)
			}
		})
	}
}
