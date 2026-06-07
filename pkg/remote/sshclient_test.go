// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestMergeKeywords_LocalForward_Override(t *testing.T) {
	t.Parallel()
	old := &wconfig.ConnKeywords{SshLocalForward: []string{"8080 localhost:80"}}
	new := &wconfig.ConnKeywords{SshLocalForward: []string{"9090 localhost:90"}}
	got := mergeKeywords(old, new)
	if len(got.SshLocalForward) != 1 || got.SshLocalForward[0] != "9090 localhost:90" {
		t.Fatalf("expected [9090 localhost:90], got %v", got.SshLocalForward)
	}
}

func TestMergeKeywords_LocalForward_NilPreserves(t *testing.T) {
	t.Parallel()
	old := &wconfig.ConnKeywords{SshLocalForward: []string{"8080 localhost:80"}}
	new := &wconfig.ConnKeywords{}
	got := mergeKeywords(old, new)
	if len(got.SshLocalForward) != 1 || got.SshLocalForward[0] != "8080 localhost:80" {
		t.Fatalf("expected [8080 localhost:80], got %v", got.SshLocalForward)
	}
}

func TestMergeKeywords_RemoteForward_Override(t *testing.T) {
	t.Parallel()
	old := &wconfig.ConnKeywords{SshRemoteForward: []string{"9090 localhost:3000"}}
	new := &wconfig.ConnKeywords{SshRemoteForward: []string{"7070 localhost:7000"}}
	got := mergeKeywords(old, new)
	if len(got.SshRemoteForward) != 1 || got.SshRemoteForward[0] != "7070 localhost:7000" {
		t.Fatalf("expected [7070 localhost:7000], got %v", got.SshRemoteForward)
	}
}

func TestMergeKeywords_RemoteForward_NilPreserves(t *testing.T) {
	t.Parallel()
	old := &wconfig.ConnKeywords{SshRemoteForward: []string{"9090 localhost:3000"}}
	new := &wconfig.ConnKeywords{}
	got := mergeKeywords(old, new)
	if len(got.SshRemoteForward) != 1 || got.SshRemoteForward[0] != "9090 localhost:3000" {
		t.Fatalf("expected [9090 localhost:3000], got %v", got.SshRemoteForward)
	}
}

func TestMergeKeywords_BothForward_MultipleRules(t *testing.T) {
	t.Parallel()
	old := &wconfig.ConnKeywords{
		SshLocalForward:  []string{"8080 localhost:80", "8081 localhost:81"},
		SshRemoteForward: []string{"9090 localhost:3000"},
	}
	new := &wconfig.ConnKeywords{
		SshLocalForward: []string{"7070 localhost:70"},
	}
	got := mergeKeywords(old, new)
	if len(got.SshLocalForward) != 1 || got.SshLocalForward[0] != "7070 localhost:70" {
		t.Fatalf("expected local forward override, got %v", got.SshLocalForward)
	}
	if len(got.SshRemoteForward) != 1 || got.SshRemoteForward[0] != "9090 localhost:3000" {
		t.Fatalf("expected remote forward preserved, got %v", got.SshRemoteForward)
	}
}

func TestMergeKeywords_Forward_EmptyOverrides(t *testing.T) {
	t.Parallel()
	old := &wconfig.ConnKeywords{
		SshLocalForward:  []string{"8080 localhost:80"},
		SshRemoteForward: []string{"9090 localhost:3000"},
	}
	new := &wconfig.ConnKeywords{
		SshLocalForward:  []string{},
		SshRemoteForward: []string{},
	}
	got := mergeKeywords(old, new)
	if len(got.SshLocalForward) != 0 {
		t.Fatalf("expected empty local forward, got %v", got.SshLocalForward)
	}
	if len(got.SshRemoteForward) != 0 {
		t.Fatalf("expected empty remote forward, got %v", got.SshRemoteForward)
	}
}