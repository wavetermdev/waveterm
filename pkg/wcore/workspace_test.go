// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package wcore

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// initTestWStore points wstore at a fresh, real sqlite DB (real migrations,
// real driver - not mocked) under t.TempDir() so each test gets an isolated
// store. Creates the db subdirectory directly rather than via
// wavebase.EnsureWaveDBDir(), which caches success process-wide by a fixed
// key - fine for a real single-lifetime process, but it would silently
// no-op for every test after the first, each pointed at its own fresh
// (not-yet-existing) temp dir.
func initTestWStore(t *testing.T) context.Context {
	t.Helper()
	dataDir := t.TempDir()
	wavebase.DataHome_VarCache = dataDir
	if err := os.MkdirAll(filepath.Join(dataDir, wavebase.WaveDBDir), 0700); err != nil {
		t.Fatalf("failed to create wave db dir: %v", err)
	}
	if err := wstore.InitWStore(); err != nil {
		t.Fatalf("failed to init wstore: %v", err)
	}
	return context.Background()
}

func containsWorkspaceId(list waveobj.WorkspaceList, id string) bool {
	for _, entry := range list {
		if entry.WorkspaceId == id {
			return true
		}
	}
	return false
}

// TestListWorkspaces_ExcludesUnsavedWithoutMutating confirms ListWorkspaces
// keeps excluding an unsaved (blank Name/Icon/Color) workspace - this is the
// intentional CreateWindow/DeleteWorkspace scratch-workspace lifecycle
// (blank workspaces are deliberately unnamed until a user "saves" them, and
// auto-cleaned up on window close otherwise), not the bug. It must also
// leave the unsaved workspace's stored fields completely untouched - no
// backfill, no persistence - since writing defaults into it would silently
// convert it into a "saved" workspace and break that cleanup lifecycle.
func TestListWorkspaces_ExcludesUnsavedWithoutMutating(t *testing.T) {
	ctx := initTestWStore(t)

	saved := &waveobj.Workspace{
		OID:    uuid.NewString(),
		Name:   "Workspace1",
		Icon:   "flask",
		Color:  "#FF453A",
		TabIds: []string{uuid.NewString()},
	}
	if err := wstore.DBInsert(ctx, saved); err != nil {
		t.Fatalf("failed to insert saved workspace: %v", err)
	}

	unsavedTabId := uuid.NewString()
	unsaved := &waveobj.Workspace{
		OID:    uuid.NewString(),
		Name:   "",
		Icon:   "",
		Color:  "",
		TabIds: []string{unsavedTabId},
	}
	if err := wstore.DBInsert(ctx, unsaved); err != nil {
		t.Fatalf("failed to insert unsaved workspace: %v", err)
	}

	list, err := ListWorkspaces(ctx)
	if err != nil {
		t.Fatalf("ListWorkspaces failed: %v", err)
	}
	if len(list) != 1 || !containsWorkspaceId(list, saved.OID) {
		t.Fatalf("expected only the saved workspace, got %+v", list)
	}
	if containsWorkspaceId(list, unsaved.OID) {
		t.Fatalf("unsaved workspace must stay excluded from ListWorkspaces (switcher-facing)")
	}

	// The unsaved workspace's stored fields must be byte-for-byte untouched
	// by the call - no backfill, no persisted mutation of any kind.
	refetched, err := wstore.DBMustGet[*waveobj.Workspace](ctx, unsaved.OID)
	if err != nil {
		t.Fatalf("failed to refetch unsaved workspace: %v", err)
	}
	if refetched.Name != "" || refetched.Icon != "" || refetched.Color != "" {
		t.Fatalf("ListWorkspaces must not persist any backfill into an unsaved workspace, got name=%q icon=%q color=%q",
			refetched.Name, refetched.Icon, refetched.Color)
	}
	if len(refetched.TabIds) != 1 || refetched.TabIds[0] != unsavedTabId {
		t.Fatalf("ListWorkspaces must not disturb existing fields, got TabIds=%v", refetched.TabIds)
	}
}

// TestListAllWorkspaces_IncludesUnsavedWithoutMutating is the actual fix:
// CLI tooling (wsh workspace list, wsh blocks list) needs visibility into
// every live workspace regardless of saved status - confirmed against a
// real user's database, where an unsaved workspace held a continuously-used
// session's own tab, completely invisible to those commands. It must
// include the unsaved workspace, but - just like ListWorkspaces - must
// never write anything into it; only the caller decides whether/how to
// display an unnamed workspace.
func TestListAllWorkspaces_IncludesUnsavedWithoutMutating(t *testing.T) {
	ctx := initTestWStore(t)

	saved := &waveobj.Workspace{
		OID:    uuid.NewString(),
		Name:   "Workspace1",
		Icon:   "flask",
		Color:  "#FF453A",
		TabIds: []string{uuid.NewString()},
	}
	if err := wstore.DBInsert(ctx, saved); err != nil {
		t.Fatalf("failed to insert saved workspace: %v", err)
	}

	unsavedTabId := uuid.NewString()
	unsaved := &waveobj.Workspace{
		OID:    uuid.NewString(),
		Name:   "",
		Icon:   "",
		Color:  "",
		TabIds: []string{unsavedTabId},
	}
	if err := wstore.DBInsert(ctx, unsaved); err != nil {
		t.Fatalf("failed to insert unsaved workspace: %v", err)
	}

	list, err := ListAllWorkspaces(ctx)
	if err != nil {
		t.Fatalf("ListAllWorkspaces failed: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected both workspaces (the unsaved one must now be visible to CLI tooling), got %d: %+v", len(list), list)
	}
	if !containsWorkspaceId(list, saved.OID) || !containsWorkspaceId(list, unsaved.OID) {
		t.Fatalf("expected both workspace IDs present, got %+v", list)
	}

	// No mutation, same as ListWorkspaces - this function only changes what
	// gets included, never what gets written.
	refetched, err := wstore.DBMustGet[*waveobj.Workspace](ctx, unsaved.OID)
	if err != nil {
		t.Fatalf("failed to refetch unsaved workspace: %v", err)
	}
	if refetched.Name != "" || refetched.Icon != "" || refetched.Color != "" {
		t.Fatalf("ListAllWorkspaces must not persist any backfill either, got name=%q icon=%q color=%q",
			refetched.Name, refetched.Icon, refetched.Color)
	}
	if len(refetched.TabIds) != 1 || refetched.TabIds[0] != unsavedTabId {
		t.Fatalf("ListAllWorkspaces must not disturb existing fields, got TabIds=%v", refetched.TabIds)
	}
}
