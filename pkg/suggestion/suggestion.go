// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package suggestion

import (
	"container/heap"
	"context"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/junegunn/fzf/src/algo"
	"github.com/junegunn/fzf/src/util"
	"github.com/wavetermdev/waveterm/pkg/faviconcache"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const MaxSuggestions = 50

type MockDirEntry struct {
	NameStr  string
	IsDirVal bool
	FileMode fs.FileMode
}

func (m *MockDirEntry) Name() string               { return m.NameStr }
func (m *MockDirEntry) IsDir() bool                { return m.IsDirVal }
func (m *MockDirEntry) Type() fs.FileMode          { return m.FileMode }
func (m *MockDirEntry) Info() (fs.FileInfo, error) { return nil, fs.ErrInvalid }

var PathSepStr = string(os.PathSeparator)

// ensureTrailingSlash makes sure s ends with a slash.
func ensureTrailingSlash(s string) string {
	if s == "" {
		return s
	}
	if !strings.HasSuffix(s, PathSepStr) {
		return s + PathSepStr
	}
	return s
}

// resolveFileQuery returns (baseDir, queryPrefix, searchTerm, error).
//
// Our approach is to use the presence of a trailing slash to decide whether
// to treat the query as a directory listing (searchTerm is empty) or a search
// filter. (This means that a query of exactly "." or ".." is treated as a
// search filter, so that files with a dot in their name––including ".."––will
// be returned.)
//
// In addition, if there is a slash anywhere in the query (but not at the end),
// we treat everything before the last slash as a relative directory to search
// in, and the portion after the last slash as the search term.
func resolveFileQuery(cwd string, query string) (string, string, string, error) {
	// If no current working directory, default to "~".
	if cwd == "" {
		cwd = "~"
	}
	var err error
	cwd, err = wavebase.ExpandHomeDir(cwd)
	if err != nil {
		return "", "", "", fmt.Errorf("error expanding home dir: %w", err)
	}
	if query == "" {
		return cwd, "", "", nil
	}
	// Expand home if needed.
	tildeSlash := "~" + PathSepStr
	if query == "~" || strings.HasPrefix(query, tildeSlash) {
		ogQuery := query
		query, err = wavebase.ExpandHomeDir(query)
		if err != nil {
			return "", "", "", fmt.Errorf("error expanding query home dir: %w", err)
		}
		if ogQuery == "~" || ogQuery == tildeSlash {
			return query, tildeSlash, "", nil
		}
	}
	// Handle absolute queries.
	if filepath.IsAbs(query) {
		if filepath.Dir(query) == query {
			return query, query, "", nil
		}
		if strings.HasSuffix(query, PathSepStr) {
			// Remove trailing slash for canonical directory path.
			baseDir := strings.TrimRight(query, PathSepStr)
			// But keep the trailing slash in the queryPrefix for display.
			queryPrefix := query
			return baseDir, queryPrefix, "", nil
		}
		// Otherwise, e.g. "/var/f"
		baseDir := filepath.Dir(query)
		queryPrefix := filepath.Dir(query)
		searchTerm := filepath.Base(query)
		return baseDir, queryPrefix, searchTerm, nil
	}

	// For relative queries:
	// If the query ends with a slash (e.g. "./" or "waveterm/"), then treat it
	// as a directory listing.
	if strings.HasSuffix(query, PathSepStr) {
		fullPath := filepath.Join(cwd, query)
		baseDir := strings.TrimRight(fullPath, PathSepStr)
		queryPrefix := query
		return baseDir, queryPrefix, "", nil
	}

	// If there is a slash in the query, split into directory part and search term.
	if idx := strings.LastIndex(query, PathSepStr); idx != -1 {
		dirPart := query[:idx]
		term := query[idx+1:]
		baseDir := filepath.Join(cwd, dirPart)
		// For display purposes, set queryPrefix to the dirPart with a trailing slash.
		queryPrefix := ""
		if dirPart != "" {
			queryPrefix = ensureTrailingSlash(dirPart)
		}
		return baseDir, queryPrefix, term, nil
	}

	// No slash in query: search in the cwd.
	return cwd, "", query, nil
}

func DisposeSuggestions(ctx context.Context, widgetId string) {
	cacheDispose(widgetId)
}

func FetchSuggestions(ctx context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	if data.SuggestionType == "file" {
		return fetchFileSuggestions(ctx, data)
	}
	if data.SuggestionType == "bookmark" {
		return fetchBookmarkSuggestions(ctx, data)
	}
	return nil, fmt.Errorf("unsupported suggestion type: %q", data.SuggestionType)
}

func filterBookmarksForValid(bookmarks map[string]wconfig.WebBookmark) map[string]wconfig.WebBookmark {
	validBookmarks := make(map[string]wconfig.WebBookmark)
	for k, v := range bookmarks {
		if v.Url == "" {
			continue
		}
		u, err := url.ParseRequestURI(v.Url)
		if err != nil || u.Scheme == "" || u.Host == "" {
			continue
		}

		validBookmarks[k] = v
	}
	return validBookmarks
}

func fetchBookmarkSuggestions(_ context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	if data.SuggestionType != "bookmark" {
		return nil, fmt.Errorf("unsupported suggestion type: %q", data.SuggestionType)
	}

	// scoredEntry holds a bookmark along with its computed score, the match positions for the
	// field that will be used for display, the positions for the secondary field (if any),
	// and its original index in the Bookmarks list.
	type scoredEntry struct {
		bookmark    wconfig.WebBookmark
		score       int
		matchPos    []int // positions for the field that's used as Display
		subMatchPos []int // positions for the other field (if any)
		origIndex   int
	}

	bookmarks := wconfig.GetWatcher().GetFullConfig().Bookmarks
	bookmarks = filterBookmarksForValid(bookmarks)

	searchTerm := data.Query
	var patternRunes []rune
	if searchTerm != "" {
		patternRunes = []rune(strings.ToLower(searchTerm))
	}

	var scoredEntries []scoredEntry
	var slab util.Slab

	bookmarkKeys := utilfn.GetMapKeys(bookmarks)
	// sort by display:order and then by key
	sort.Slice(bookmarkKeys, func(i, j int) bool {
		bookmarkA := bookmarks[bookmarkKeys[i]]
		bookmarkB := bookmarks[bookmarkKeys[j]]
		if bookmarkA.DisplayOrder != bookmarkB.DisplayOrder {
			return bookmarkA.DisplayOrder < bookmarkB.DisplayOrder
		}
		return bookmarkKeys[i] < bookmarkKeys[j]
	})
	for i, bmkey := range bookmarkKeys {
		bookmark := bookmarks[bmkey]
		// If no search term, include all bookmarks (score 0, no positions).
		if searchTerm == "" {
			scoredEntries = append(scoredEntries, scoredEntry{
				bookmark:  bookmark,
				score:     0,
				origIndex: i,
			})
			continue
		}

		// For bookmarks with a title, Display is set to the title and SubText to the URL.
		// We perform fuzzy matching on both fields.
		if bookmark.Title != "" {
			// Fuzzy match against the title.
			candidateTitle := strings.ToLower(bookmark.Title)
			textTitle := util.ToChars([]byte(candidateTitle))
			resultTitle, titlePositionsPtr := algo.FuzzyMatchV2(false, true, true, &textTitle, patternRunes, true, &slab)
			var titleScore int
			var titlePositions []int
			if titlePositionsPtr != nil {
				titlePositions = *titlePositionsPtr
			}
			titleScore = resultTitle.Score

			// Fuzzy match against the URL.
			candidateUrl := strings.ToLower(bookmark.Url)
			textUrl := util.ToChars([]byte(candidateUrl))
			resultUrl, urlPositionsPtr := algo.FuzzyMatchV2(false, true, true, &textUrl, patternRunes, true, &slab)
			var urlScore int
			var urlPositions []int
			if urlPositionsPtr != nil {
				urlPositions = *urlPositionsPtr
			}
			urlScore = resultUrl.Score

			// Compute the overall score as the higher of the two.
			maxScore := titleScore
			if urlScore > maxScore {
				maxScore = urlScore
			}

			// If neither field produced a positive match, skip this bookmark.
			if maxScore <= 0 {
				continue
			}

			// Since Display is title, we use the title match positions as MatchPos and the URL match positions as SubMatchPos.
			scoredEntries = append(scoredEntries, scoredEntry{
				bookmark:    bookmark,
				score:       maxScore,
				matchPos:    titlePositions,
				subMatchPos: urlPositions,
				origIndex:   i,
			})
		} else {
			// For bookmarks with no title, Display is set to the URL.
			// Only perform fuzzy matching against the URL.
			candidateUrl := strings.ToLower(bookmark.Url)
			textUrl := util.ToChars([]byte(candidateUrl))
			resultUrl, urlPositionsPtr := algo.FuzzyMatchV2(false, true, true, &textUrl, patternRunes, true, &slab)
			urlScore := resultUrl.Score
			var urlPositions []int
			if urlPositionsPtr != nil {
				urlPositions = *urlPositionsPtr
			}

			// Skip this bookmark if the URL doesn't match.
			if urlScore <= 0 {
				continue
			}

			scoredEntries = append(scoredEntries, scoredEntry{
				bookmark:    bookmark,
				score:       urlScore,
				matchPos:    urlPositions, // match positions come from the URL, since that's what is displayed.
				subMatchPos: nil,
				origIndex:   i,
			})
		}
	}

	// Sort the scored entries in descending order by score.
	// For equal scores, preserve the original order from the Bookmarks list.
	sort.Slice(scoredEntries, func(i, j int) bool {
		if scoredEntries[i].score != scoredEntries[j].score {
			return scoredEntries[i].score > scoredEntries[j].score
		}
		return scoredEntries[i].origIndex < scoredEntries[j].origIndex
	})

	// Build up to MaxSuggestions suggestions.
	var suggestions []wshrpc.SuggestionType
	for _, entry := range scoredEntries {
		var display, subText string
		if entry.bookmark.Title != "" {
			display = entry.bookmark.Title
			subText = entry.bookmark.Url
		} else {
			display = entry.bookmark.Url
			subText = ""
		}

		suggestion := wshrpc.SuggestionType{
			Type:         "url",
			SuggestionId: utilfn.QuickHashString(entry.bookmark.Url),
			Display:      display,
			SubText:      subText,
			MatchPos:     entry.matchPos,    // These positions correspond to the field in Display.
			SubMatchPos:  entry.subMatchPos, // For bookmarks with a title, this is the URL match positions.
			Score:        entry.score,
			UrlUrl:       entry.bookmark.Url,
		}
		suggestion.IconSrc = faviconcache.GetFavicon(entry.bookmark.Url)
		suggestions = append(suggestions, suggestion)
		if len(suggestions) >= MaxSuggestions {
			break
		}
	}

	return &wshrpc.FetchSuggestionsResponse{
		Suggestions: suggestions,
		ReqNum:      data.ReqNum,
	}, nil
}

// Define a scored entry for fuzzy matching.
type scoredEntry struct {
	ent       fs.DirEntry
	score     int
	fileName  string
	positions []int
}

// We'll use a heap to only keep the top MaxSuggestions when a search term is provided.
// Define a min-heap so that the worst (lowest scoring) candidate is at the top.
type scoredEntryHeap []scoredEntry

// Less: lower score is “less”. For equal scores, a candidate with a longer filename is considered worse.
func (h scoredEntryHeap) Len() int { return len(h) }
func (h scoredEntryHeap) Less(i, j int) bool {
	if h[i].score != h[j].score {
		return h[i].score < h[j].score
	}
	return len(h[i].fileName) > len(h[j].fileName)
}
func (h scoredEntryHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *scoredEntryHeap) Push(x interface{}) { *h = append(*h, x.(scoredEntry)) }
func (h *scoredEntryHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[0 : n-1]
	return x
}

func fetchFileSuggestions(ctx context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	// Only support file suggestions.
	if data.SuggestionType != "file" {
		return nil, fmt.Errorf("unsupported suggestion type: %q", data.SuggestionType)
	}

	// Resolve the base directory, query prefix (for display) and search term.
	baseDir, queryPrefix, searchTerm, err := resolveFileQuery(data.FileCwd, data.Query)
	if err != nil {
		return nil, fmt.Errorf("error resolving base dir: %w", err)
	}

	// Use a cancellable context for directory listing.
	listingCtx, cancelFn := context.WithCancel(ctx)
	defer cancelFn()

	entriesCh, err := listDirectory(listingCtx, data.WidgetId, baseDir, 1000)
	if err != nil {
		return nil, fmt.Errorf("error listing directory: %w", err)
	}

	const maxEntries = MaxSuggestions // top-k entries

	// Always use a heap.
	var topHeap scoredEntryHeap
	heap.Init(&topHeap)

	var patternRunes []rune
	if searchTerm != "" {
		patternRunes = []rune(strings.ToLower(searchTerm))
	}

	var slab util.Slab
	var index int // used for ordering when searchTerm is empty

	// Process each directory entry.
	for result := range entriesCh {
		if result.Err != nil {
			return nil, fmt.Errorf("error reading directory: %w", result.Err)
		}
		de := result.Entry
		fileName := de.Name()
		var score int
		var candidatePositions []int

		if searchTerm != "" {
			// Perform fuzzy matching.
			candidate := strings.ToLower(fileName)
			text := util.ToChars([]byte(candidate))
			matchResult, positions := algo.FuzzyMatchV2(false, true, true, &text, patternRunes, true, &slab)
			if matchResult.Score <= 0 {
				index++
				continue
			}
			score = matchResult.Score
			if positions != nil {
				candidatePositions = *positions
			}
		} else {
			// Use ordering: first entry gets highest score.
			score = maxEntries - index
		}
		index++

		se := scoredEntry{
			ent:       de,
			score:     score,
			fileName:  fileName,
			positions: candidatePositions,
		}

		if topHeap.Len() < maxEntries {
			heap.Push(&topHeap, se)
		} else {
			// Replace the worst candidate if this one is better.
			worst := topHeap[0]
			if se.score > worst.score || (se.score == worst.score && len(se.fileName) < len(worst.fileName)) {
				heap.Pop(&topHeap)
				heap.Push(&topHeap, se)
			}
		}
		if searchTerm == "" && topHeap.Len() >= maxEntries {
			break
		}
	}

	// Extract and sort the scored entries (highest score first).
	scoredEntries := make([]scoredEntry, topHeap.Len())
	copy(scoredEntries, topHeap)
	sort.Slice(scoredEntries, func(i, j int) bool {
		if scoredEntries[i].score != scoredEntries[j].score {
			return scoredEntries[i].score > scoredEntries[j].score
		}
		return len(scoredEntries[i].fileName) < len(scoredEntries[j].fileName)
	})

	// Build suggestions from the scored entries.
	var suggestions []wshrpc.SuggestionType
	for _, candidate := range scoredEntries {
		fileName := candidate.ent.Name()
		fullPath := filepath.Join(baseDir, fileName)
		suggestionFileName := filepath.Join(queryPrefix, fileName)
		offset := len(suggestionFileName) - len(fileName)
		if offset > 0 && len(candidate.positions) > 0 {
			// Adjust match positions to account for the query prefix.
			for j := range candidate.positions {
				candidate.positions[j] += offset
			}
		}
		s := wshrpc.SuggestionType{
			Type:         "file",
			FilePath:     fullPath,
			SuggestionId: utilfn.QuickHashString(fullPath),
			Display:      suggestionFileName,
			FileName:     suggestionFileName,
			FileMimeType: fileutil.DetectMimeTypeWithDirEnt(fullPath, candidate.ent),
			MatchPos:     candidate.positions,
			Score:        candidate.score,
		}
		suggestions = append(suggestions, s)
		if len(suggestions) >= MaxSuggestions {
			break
		}
	}

	return &wshrpc.FetchSuggestionsResponse{
		Suggestions: suggestions,
		ReqNum:      data.ReqNum,
	}, nil
}
