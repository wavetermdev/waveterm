// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package suggestion

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// returns (baseDir, queryPrefix, error)
func resolveBaseDir(cwd string, query string) (string, string, error) {
	if cwd == "" {
		cwd = "~"
	}
	cwd, err := wavebase.ExpandHomeDir(cwd)
	if err != nil {
		return "", "", fmt.Errorf("error expanding home dir: %w", err)
	}
	if query == "" {
		return cwd, "", nil
	}
	if strings.HasPrefix(query, "~/") {
		var err error
		query, err = wavebase.ExpandHomeDir(query)
		if err != nil {
			return "", "", fmt.Errorf("error expanding query home dir: %w", err)
		}
	}
	rtn := cwd
	if strings.HasPrefix(query, "/") {
		queryDir := filepath.Dir(query)
		return queryDir, queryDir, nil
	}
	rtn = filepath.Join(cwd, query)
	queryDir := filepath.Dir(query)
	rtnDir := filepath.Dir(rtn)
	return rtnDir, queryDir, nil
}

func FetchSuggestions(ctx context.Context, data wshrpc.FetchSuggestionsData) (*wshrpc.FetchSuggestionsResponse, error) {
	if data.SuggestionType != "file" {
		return nil, fmt.Errorf("unsupported suggestion type: %q", data.SuggestionType)
	}
	baseDir, queryPrefix, err := resolveBaseDir(data.FileCwd, data.Query)
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
	lowerQuery := strings.ToLower(data.Query)
	for _, dirEnt := range dirEnts {
		if len(suggestions) > 50 {
			break
		}
		fileName := dirEnt.Name()
		match := strings.Contains(strings.ToLower(fileName), lowerQuery)
		if !match {
			continue
		}
		s := wshrpc.SuggestionType{
			Type: "file",
		}
		s.FilePath = filepath.Join(baseDir, fileName)
		s.SuggestionId = utilfn.QuickHashString(s.FilePath)
		s.FileName = filepath.Join(queryPrefix, fileName)
		s.FileMimeType = fileutil.DetectMimeTypeWithDirEnt(s.FilePath, dirEnt)
		suggestions = append(suggestions, s)
	}
	return &wshrpc.FetchSuggestionsResponse{
		Suggestions: suggestions,
		ReqNum:      data.ReqNum,
	}, nil
}
