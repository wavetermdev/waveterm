package cmdrunner

import (
	"github.com/wavetermdev/waveterm/wavesrv/pkg/bookmarks"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/history"
)

type MainViewUpdate struct {
	MainView      string                     `json:"mainview"`
	HistoryView   *history.HistoryViewData   `json:"historyview,omitempty"`
	BookmarksView *bookmarks.BookmarksUpdate `json:"bookmarksview,omitempty"`
}

func (MainViewUpdate) GetType() string {
	return "mainview"
}
