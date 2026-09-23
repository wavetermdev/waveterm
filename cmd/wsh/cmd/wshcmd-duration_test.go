// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"testing"
	"time"
)

func TestParseDurationFlag(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		def     time.Duration
		want    time.Duration
		wantErr bool
	}{
		{name: "empty uses default", in: "", def: 60 * time.Second, want: 60 * time.Second},
		{name: "go duration seconds", in: "30s", def: 60 * time.Second, want: 30 * time.Second},
		{name: "go duration minutes", in: "5m", def: 60 * time.Second, want: 5 * time.Minute},
		{name: "integer seconds", in: "12", def: 60 * time.Second, want: 12 * time.Second},
		{name: "zero errors", in: "0", def: 60 * time.Second, wantErr: true},
		{name: "negative errors", in: "-1s", def: 60 * time.Second, wantErr: true},
		{name: "garbage errors", in: "nope", def: 60 * time.Second, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseDurationFlag(tt.in, tt.def)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseDurationFlag(%q) err = %v, wantErr %v", tt.in, err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			if got != tt.want {
				t.Errorf("parseDurationFlag(%q) = %s, want %s", tt.in, got, tt.want)
			}
		})
	}
}
