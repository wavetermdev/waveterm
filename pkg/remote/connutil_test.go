// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"testing"
)

func TestParseOpts(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantUser string
		wantHost string
		wantPort string
		wantErr  bool
	}{
		{"user@host:port", "user@myserver:22", "user", "myserver", "22", false},
		{"host only", "myserver", "", "myserver", "", false},
		{"chinese host alias", "PROD-服务器", "", "PROD-服务器", "", false},
		{"mixed ascii and chinese with user and port", "user@PROD-阿里云:22", "user", "PROD-阿里云", "22", false},
		{"unicode user and host", "用户@服务器:22", "用户", "服务器", "22", false},
		{"unicode only host", "服务器", "", "服务器", "", false},
		{"japanese host", "サーバー", "", "サーバー", "", false},
		{"empty string", "", "", "", "", true},
		{"just colon", ":", "", "", "", true},
		{"just at", "@", "", "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opts, err := ParseOpts(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if opts.SSHUser != tt.wantUser {
				t.Errorf("user: got %q, want %q", opts.SSHUser, tt.wantUser)
			}
			if opts.SSHHost != tt.wantHost {
				t.Errorf("host: got %q, want %q", opts.SSHHost, tt.wantHost)
			}
			if opts.SSHPort != tt.wantPort {
				t.Errorf("port: got %q, want %q", opts.SSHPort, tt.wantPort)
			}
		})
	}
}
