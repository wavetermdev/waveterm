// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bookmarks

import "github.com/wavetermdev/waveterm/wavesrv/pkg/scbus"

type BookmarksUpdate struct {
	Bookmarks        []*BookmarkType `json:"bookmarks"`
	SelectedBookmark string          `json:"selectedbookmark,omitempty"`
}

func (BookmarksUpdate) GetType() string {
	return "bookmarks"
}

func AddBookmarksUpdate(update *scbus.ModelUpdatePacketType, bookmarks []*BookmarkType, selectedBookmark *string) {
	if selectedBookmark == nil {
		update.AddUpdate(BookmarksUpdate{Bookmarks: bookmarks})
	} else {
		update.AddUpdate(BookmarksUpdate{Bookmarks: bookmarks, SelectedBookmark: *selectedBookmark})
	}
}
