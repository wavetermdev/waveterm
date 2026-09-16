// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package wcore

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// initTestWStore points wstore at a fresh, real sqlite DB (real migrations,
// real driver - not mocked) under t.TempDir() so each test gets an isolated
// store.
func initTestWStore(t *testing.T) context.Context {
	t.Helper()
	wavebase.DataHome_VarCache = t.TempDir()
	if err := wavebase.EnsureWaveDBDir(); err != nil {
		t.Fatalf("failed to ensure wave db dir: %v", err)
	}
	if err := wstore.InitWStore(); err != nil {
		t.Fatalf("failed to init wstore: %v", err)
	}
	return context.Background()
}

// TestListWorkspaces_BackfillsIncompleteWorkspace reproduces the exact bug
// confirmed against a real user's database: a workspace missing Name/Icon/
// Color (which normal creation via CreateWorkspace/UpdateWorkspace never
// produces - this only happens on workspaces predating those fields, or a
// migration gap) was silently dropped from ListWorkspaces entirely, along
// with every tab and block inside it. It must now be included, with
// defaults backfilled and persisted rather than just patched in memory.
func TestListWorkspaces_BackfillsIncompleteWorkspace(t *testing.T) {
	ctx := initTestWStore(t)

	complete := &waveobj.Workspace{
		OID:    uuid.NewString(),
		Name:   "Workspace1",
		Icon:   "flask",
		Color:  "#FF453A",
		TabIds: []string{uuid.NewString()},
	}
	if err := wstore.DBInsert(ctx, complete); err != nil {
		t.Fatalf("failed to insert complete workspace: %v", err)
	}

	incompleteTabId := uuid.NewString()
	incomplete := &waveobj.Workspace{
		OID:    uuid.NewString(),
		Name:   "",
		Icon:   "",
		Color:  "",
		TabIds: []string{incompleteTabId},
	}
	if err := wstore.DBInsert(ctx, incomplete); err != nil {
		t.Fatalf("failed to insert incomplete workspace: %v", err)
	}

	list, err := ListWorkspaces(ctx)
	if err != nil {
		t.Fatalf("ListWorkspaces failed: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 workspaces (the previously-dropped one must now be included), got %d: %+v", len(list), list)
	}

	var found bool
	for _, entry := range list {
		if entry.WorkspaceId == incomplete.OID {
			found = true
		}
	}
	if !found {
		t.Fatalf("the incomplete workspace %q was dropped from ListWorkspaces, same as the original bug", incomplete.OID)
	}

	// The backfill must be persisted, not just patched on the in-memory
	// value ListWorkspaces happened to build - re-fetch independently.
	refetched, err := wstore.DBMustGet[*waveobj.Workspace](ctx, incomplete.OID)
	if err != nil {
		t.Fatalf("failed to refetch workspace: %v", err)
	}
	if refetched.Name == "" {
		t.Errorf("Name was not persisted (still empty on refetch)")
	}
	if refetched.Icon == "" {
		t.Errorf("Icon was not persisted (still empty on refetch)")
	}
	if refetched.Color == "" {
		t.Errorf("Color was not persisted (still empty on refetch)")
	}
	if len(refetched.TabIds) != 1 || refetched.TabIds[0] != incompleteTabId {
		t.Errorf("backfill must not disturb existing fields (TabIds), got %v", refetched.TabIds)
	}

	// The complete, already-normal workspace must be completely unaffected -
	// same values, not re-persisted or altered.
	refetchedComplete, err := wstore.DBMustGet[*waveobj.Workspace](ctx, complete.OID)
	if err != nil {
		t.Fatalf("failed to refetch complete workspace: %v", err)
	}
	if refetchedComplete.Name != "Workspace1" || refetchedComplete.Icon != "flask" || refetchedComplete.Color != "#FF453A" {
		t.Errorf("an already-complete workspace must be left untouched, got name=%q icon=%q color=%q",
			refetchedComplete.Name, refetchedComplete.Icon, refetchedComplete.Color)
	}
}
