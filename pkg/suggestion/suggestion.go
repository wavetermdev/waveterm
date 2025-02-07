// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package suggestion

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

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

func FetchSuggestions(ctx context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	if data.SuggestionType != "file" {
		return nil, fmt.Errorf("unsupported suggestion type: %q", data.SuggestionType)
	}
	baseDir, queryPrefix, searchTerm, err := resolveFileQuery(data.FileCwd, data.Query)
	if err != nil {
		return nil, fmt.Errorf("error resolving base dir: %w", err)
	}
	dirFd, err := os.Open(baseDir)
	if err != nil {
		return nil, fmt.Errorf("error opening directory: %w", err)
	}
	defer dirFd.Close()
	finfo, err := dirFd.Stat()
	if err != nil {
		return nil, fmt.Errorf("error getting directory info: %w", err)
	}
	if !finfo.IsDir() {
		return nil, fmt.Errorf("not a directory: %s", baseDir)
	}
	dirEnts, err := dirFd.ReadDir(1000)
	if err != nil {
		return nil, fmt.Errorf("error reading directory: %w", err)
	}

	var suggestions []wshrpc.SuggestionType
	if filepath.Dir(baseDir) != baseDir {
		dirEnts = append(dirEnts, &MockDirEntry{NameStr: "..", IsDirVal: true, FileMode: fs.ModeDir | 0755})
	}
	lowerSearchTerm := strings.ToLower(searchTerm)
	for _, dirEnt := range dirEnts {
		// Limit to at most 50 suggestions.
		if len(suggestions) > 50 {
			break
		}
		fileName := dirEnt.Name()
		// If a search term is provided, only include entries that match.
		if lowerSearchTerm != "" && !strings.Contains(strings.ToLower(fileName), lowerSearchTerm) {
			continue
		}
		s := wshrpc.SuggestionType{
			Type: "file",
		}
		fullPath := filepath.Join(baseDir, fileName)
		s.FilePath = fullPath
		s.SuggestionId = utilfn.QuickHashString(fullPath)
		// Build the display name using the queryPrefix.
		s.FileName = filepath.Join(queryPrefix, fileName)
		s.FileMimeType = fileutil.DetectMimeTypeWithDirEnt(fullPath, dirEnt)
		suggestions = append(suggestions, s)
	}
	return &wshrpc.FetchSuggestionsResponse{
		Suggestions:   suggestions,
		ReqNum:        data.ReqNum,
		HighlightTerm: searchTerm,
	}, nil
}
