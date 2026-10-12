// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestUpsertFileBookmarkInMap(t *testing.T) {
	m := make(waveobj.MetaMapType)
	m, err := UpsertFileBookmarkInMap(m, "k1", FileBookmark{BookmarkType: "folder", Label: "Home", Path: "~", DisplayOrder: 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	entry := m.GetMap("k1")
	if entry == nil {
		t.Fatalf("expected entry for k1")
	}
	if entry["path"] != "~" || entry["bookmarktype"] != "folder" {
		t.Fatalf("unexpected entry: %#v", entry)
	}

	m, err = UpsertFileBookmarkInMap(m, "k1", FileBookmark{BookmarkType: "folder", Label: "Home2", Path: "~/x", DisplayOrder: 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if m.GetMap("k1")["label"] != "Home2" {
		t.Fatalf("expected upsert to overwrite label")
	}
}

func TestRemoveFileBookmarkInMap(t *testing.T) {
	m := make(waveobj.MetaMapType)
	m, _ = UpsertFileBookmarkInMap(m, "k1", FileBookmark{Label: "a", Path: "~"})
	m, _ = UpsertFileBookmarkInMap(m, "k2", FileBookmark{Label: "b", Path: "/"})
	m = RemoveFileBookmarkInMap(m, "k1")
	if m.GetMap("k1") != nil {
		t.Fatalf("expected k1 removed")
	}
	if m.GetMap("k2") == nil {
		t.Fatalf("expected k2 preserved")
	}
}
