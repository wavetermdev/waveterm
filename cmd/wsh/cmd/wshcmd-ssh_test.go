// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import "testing"

func TestApplySSHOverrides(t *testing.T) {
	tests := []struct {
		name    string
		sshArg  string
		login   string
		port    string
		want    string
		wantErr bool
	}{
		{
			name:   "no overrides preserves target",
			sshArg: "root@bar.com:2022",
			want:   "root@bar.com:2022",
		},
		{
			name:   "login override replaces parsed user",
			sshArg: "root@bar.com",
			login:  "foo",
			want:   "foo@bar.com",
		},
		{
			name:   "port override replaces parsed port",
			sshArg: "root@bar.com:2022",
			port:   "2222",
			want:   "root@bar.com:2222",
		},
		{
			name:   "both overrides replace parsed user and port",
			sshArg: "root@bar.com:2022",
			login:  "foo",
			port:   "2200",
			want:   "foo@bar.com:2200",
		},
		{
			name:   "login override adds user to bare host",
			sshArg: "bar.com",
			login:  "foo",
			want:   "foo@bar.com",
		},
		{
			name:   "port override adds port to bare host",
			sshArg: "bar.com",
			port:   "2200",
			want:   "bar.com:2200",
		},
		{
			name:    "invalid target returns parse error when override requested",
			sshArg:  "bad host",
			login:   "foo",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := applySSHOverrides(tt.sshArg, tt.login, tt.port)
			if (err != nil) != tt.wantErr {
				t.Fatalf("applySSHOverrides() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if got != tt.want {
				t.Fatalf("applySSHOverrides() = %q, want %q", got, tt.want)
			}
		})
	}
}
