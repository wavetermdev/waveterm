// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package suggestion

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// returns (baseDir, queryPrefix, searchTerm, error)
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
	if query == "~" || strings.HasPrefix(query, "~/") {
		ogQuery := query
		query, err = wavebase.ExpandHomeDir(query)
		if err != nil {
			return "", "", "", fmt.Errorf("error expanding query home dir: %w", err)
		}
		if ogQuery == "~" || ogQuery == "~/" {
			return query, "~/", "", nil
		}
	}
	// Handle absolute queries (starting with "/")
	if strings.HasPrefix(query, "/") {
		if query == "/" {
			return "/", "/", "", nil
		}
		if strings.HasSuffix(query, "/") {
			// If the query ends with a slash, we want to list all entries inside that directory.
			// Remove the trailing slash to get a canonical directory path.
			baseDir := strings.TrimRight(query, "/")
			// For display purposes, keep the trailing slash in the query prefix.
			queryPrefix := query
			return baseDir, queryPrefix, "", nil
		}
		// Otherwise (e.g. "/var/f"), baseDir is the directory containing the file and
		// queryPrefix is the directory part.
		baseDir := filepath.Dir(query)
		queryPrefix := filepath.Dir(query)
		searchTerm := filepath.Base(query)
		return baseDir, queryPrefix, searchTerm, nil
	}

	// For relative queries:
	if strings.HasSuffix(query, "/") {
		// When the query ends with a slash, the entire query represents a directory.
		// Compute the full directory path by joining the cwd and query,
		// then trim any trailing slash.
		fullPath := filepath.Join(cwd, query)
		baseDir := strings.TrimRight(fullPath, string(filepath.Separator))
		// Keep the query prefix as typed so that the suggestions show the trailing slash.
		queryPrefix := query
		return baseDir, queryPrefix, "", nil
	}

	// For relative queries that do not end with a slash:
	fullPath := filepath.Join(cwd, query)
	baseDir := filepath.Dir(fullPath)
	queryPrefix := filepath.Dir(query)
	searchTerm := filepath.Base(query)
	return baseDir, queryPrefix, searchTerm, nil
}
func FetchSuggestions(ctx context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	if data.SuggestionType != "file" {
		return nil, fmt.Errorf("unsupported suggestion type: %q", data.SuggestionType)
	}
	baseDir, queryPrefix, searchTerm, err := resolveFileQuery(data.FileCwd, data.Query)
	if err != nil {
		return nil, fmt.Errorf("error resolving base dir: %w", err)
	}
	log.Printf("RESOLVE BASE DIR: %s, %s (from %s, %s)", baseDir, queryPrefix, data.FileCwd, data.Query)
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

	lowerSearchTerm := strings.ToLower(searchTerm)
	var suggestions []wshrpc.SuggestionType
	for _, dirEnt := range dirEnts {
		if len(suggestions) > 50 {
			break
		}
		fileName := dirEnt.Name()
		// If there is a search term, only include entries that match it.
		if lowerSearchTerm != "" && !strings.Contains(strings.ToLower(fileName), lowerSearchTerm) {
			continue
		}
		s := wshrpc.SuggestionType{
			Type: "file",
		}
		fullPath := filepath.Join(baseDir, fileName)
		s.FilePath = fullPath
		s.SuggestionId = utilfn.QuickHashString(fullPath)
		// The suggestion name is built using the queryPrefix.
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
