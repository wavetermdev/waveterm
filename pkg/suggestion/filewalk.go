// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package suggestion

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

const ListDirChanSize = 50

type DirEntryResult struct {
	Entry fs.DirEntry
	Err   error
}

func listDirectory(ctx context.Context, dir string, maxFiles int) (<-chan DirEntryResult, error) {
	// Open the directory outside the goroutine for early error reporting.
	f, err := os.Open(dir)
	if err != nil {
		return nil, err
	}

	// Ensure we have a directory.
	fi, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if !fi.IsDir() {
		f.Close()
		return nil, fmt.Errorf("%s is not a directory", dir)
	}

	ch := make(chan DirEntryResult, ListDirChanSize)
	go func() {
		defer close(ch)
		// Make sure to close the directory when done.
		defer f.Close()

		// Read up to maxFiles entries.
		entries, err := f.ReadDir(maxFiles)
		if err != nil {
			utilfn.SendWithCtxCheck(ctx, ch, DirEntryResult{Err: err})
			return
		}

		// Send each entry over the channel.
		for _, entry := range entries {
			ok := utilfn.SendWithCtxCheck(ctx, ch, DirEntryResult{Entry: entry})
			if !ok {
				return
			}
		}

		// Add parent directory (“..”) entry if not at the filesystem root.
		if filepath.Dir(dir) != dir {
			mockDir := &MockDirEntry{
				NameStr:  "..",
				IsDirVal: true,
				FileMode: fs.ModeDir | 0755,
			}
			utilfn.SendWithCtxCheck(ctx, ch, DirEntryResult{Entry: mockDir})
		}
	}()
	return ch, nil
}
