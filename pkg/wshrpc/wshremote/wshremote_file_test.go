// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestRemoteFileMultiInfoCommand_PathResolution(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)

	cwdDir := filepath.Join(homeDir, "cwd")
	if err := os.MkdirAll(cwdDir, 0755); err != nil {
		t.Fatalf("mkdir cwd: %v", err)
	}
	relFile := filepath.Join(cwdDir, "rel.txt")
	if err := os.WriteFile(relFile, []byte("rel"), 0644); err != nil {
		t.Fatalf("write rel file: %v", err)
	}
	homeFile := filepath.Join(homeDir, "home.txt")
	if err := os.WriteFile(homeFile, []byte("home"), 0644); err != nil {
		t.Fatalf("write home file: %v", err)
	}

	impl := &ServerImpl{}
	resp, err := impl.RemoteFileMultiInfoCommand(context.Background(), wshrpc.CommandRemoteFileMultiInfoData{
		Cwd:   "~/cwd",
		Paths: []string{"rel.txt", "~/home.txt", filepath.Join(homeDir, "missing.txt")},
	})
	if err != nil {
		t.Fatalf("RemoteFileMultiInfoCommand returned error: %v", err)
	}

	if got := resp["rel.txt"].Path; got != "~/cwd/rel.txt" {
		t.Fatalf("relative path resolved incorrectly: got %q", got)
	}
	if got := resp["~/home.txt"].Path; got != "~/home.txt" {
		t.Fatalf("home path resolved incorrectly: got %q", got)
	}
	if !resp[filepath.Join(homeDir, "missing.txt")].NotFound {
		t.Fatalf("expected missing path to be marked NotFound")
	}
}

