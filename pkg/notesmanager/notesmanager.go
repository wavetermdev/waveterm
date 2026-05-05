// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package notesmanager

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const defaultNotesPath = "~/notes.md"

type NotesManager struct {
	lock               sync.Mutex
	currentContent     string
	lastWrittenModTime time.Time
	watcher            *fsnotify.Watcher
	notesPath          string
	tmpPath            string
	initialized        bool
	initErr            error // fatal: reads and writes both fail
	readOnlyErr        error // non-fatal: reads work, writes fail
}

var instance *NotesManager
var instanceLock sync.Mutex

func GetNotesManager() *NotesManager {
	instanceLock.Lock()
	defer instanceLock.Unlock()
	if instance == nil {
		instance = &NotesManager{}
	}
	return instance
}

func notesFilePaths() (string, string, error) {
	notesPath, err := wavebase.ExpandHomeDir(defaultNotesPath)
	if err != nil {
		return "", "", fmt.Errorf("expanding notes path: %w", err)
	}
	// derive tmp path: ~/notes.md -> ~/notes.md.tmp
	tmpPath := notesPath + ".tmp"
	return notesPath, tmpPath, nil
}

func normalizeContent(s string) string {
	return strings.ReplaceAll(s, "\r\n", "\n")
}

// ensureInit lazily initializes the file watcher and reads the current content.
// Must be called with nm.lock held.
func (nm *NotesManager) ensureInit() error {
	if nm.initialized {
		return nm.initErr
	}
	nm.initialized = true
	nm.initErr = nm.doInit()
	return nm.initErr
}

func (nm *NotesManager) doInit() error {
	notesPath, tmpPath, err := notesFilePaths()
	if err != nil {
		return err
	}

	// reject if path is a directory or otherwise not a regular file
	if info, statErr := os.Stat(notesPath); statErr == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("notes path %q is not a regular file", notesPath)
		}
	} else if !os.IsNotExist(statErr) {
		return fmt.Errorf("cannot stat notes file: %w", statErr)
	}

	// validate parent directory is accessible
	parentDir := filepath.Dir(notesPath)
	if info, statErr := os.Stat(parentDir); statErr != nil {
		return fmt.Errorf("notes directory %q is not accessible: %w", parentDir, statErr)
	} else if !info.IsDir() {
		return fmt.Errorf("notes parent path %q is not a directory", parentDir)
	}

	nm.notesPath = notesPath
	nm.tmpPath = tmpPath
	fmt.Printf("notesmanager: notes path: %s\n", notesPath)

	// probe directory write+delete permissions using the tmp path
	probeWriteErr := os.WriteFile(tmpPath, []byte{}, 0644)
	if probeWriteErr == nil {
		probeWriteErr = os.Remove(tmpPath)
	}
	if probeWriteErr != nil {
		nm.readOnlyErr = fmt.Errorf("notes directory %q is not writable: %w", parentDir, probeWriteErr)
	}

	data, err := os.ReadFile(notesPath)
	if os.IsNotExist(err) {
		if nm.readOnlyErr == nil {
			// create blank file now that we've confirmed write access
			if writeErr := os.WriteFile(notesPath, []byte{}, 0644); writeErr != nil {
				return fmt.Errorf("cannot create notes file %q: %w", notesPath, writeErr)
			}
		}
	} else if err != nil {
		return fmt.Errorf("cannot read notes file: %w", err)
	} else {
		nm.currentContent = normalizeContent(string(data))
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("creating file watcher: %w", err)
	}
	// watch the parent directory so renames into place are caught
	if watchErr := watcher.Add(parentDir); watchErr != nil {
		watcher.Close()
		return fmt.Errorf("adding watch path: %w", watchErr)
	}
	nm.watcher = watcher

	go nm.watchLoop()
	return nil
}

func (nm *NotesManager) watchLoop() {
	for {
		select {
		case event, ok := <-nm.watcher.Events:
			if !ok {
				return
			}
			if filepath.Clean(event.Name) != filepath.Clean(nm.notesPath) {
				continue
			}
			if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename|fsnotify.Remove) == 0 {
				continue
			}
			nm.handleExternalChange()
		case _, ok := <-nm.watcher.Errors:
			if !ok {
				return
			}
		}
	}
}

func (nm *NotesManager) handleExternalChange() {
	data, err := os.ReadFile(nm.notesPath)
	if err != nil && !os.IsNotExist(err) {
		return
	}
	var content string
	if err == nil {
		content = normalizeContent(string(data))
	}

	var modTime time.Time
	if info, statErr := os.Stat(nm.notesPath); statErr == nil {
		modTime = info.ModTime()
	}

	nm.lock.Lock()
	if !modTime.IsZero() && modTime.Equal(nm.lastWrittenModTime) {
		nm.lock.Unlock()
		return
	}
	if content == nm.currentContent {
		nm.lock.Unlock()
		return
	}
	nm.currentContent = content
	nm.lock.Unlock()

	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_NotesUpdated,
		Data: wshrpc.NotesUpdatedData{
			Content:    content,
			SourceOref: "external",
			ReadOnly:   nm.readOnlyErr != nil,
		},
	})
}

func (nm *NotesManager) GetNote(ctx context.Context) (wshrpc.NoteData, error) {
	nm.lock.Lock()
	defer nm.lock.Unlock()
	if err := nm.ensureInit(); err != nil {
		return wshrpc.NoteData{}, err
	}
	return wshrpc.NoteData{
		Content:  nm.currentContent,
		ReadOnly: nm.readOnlyErr != nil,
	}, nil
}


func (nm *NotesManager) WriteNote(ctx context.Context, data wshrpc.CommandWriteNoteData) error {
	content := normalizeContent(data.Content)

	nm.lock.Lock()
	defer nm.lock.Unlock()
	if err := nm.ensureInit(); err != nil {
		return err
	}
	if nm.readOnlyErr != nil {
		return nm.readOnlyErr
	}

	if err := os.WriteFile(nm.tmpPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("writing notes temp file: %w", err)
	}
	if err := os.Rename(nm.tmpPath, nm.notesPath); err != nil {
		return fmt.Errorf("renaming notes temp file: %w", err)
	}

	info, err := os.Stat(nm.notesPath)
	if err != nil {
		return fmt.Errorf("stat after write: %w", err)
	}
	nm.lastWrittenModTime = info.ModTime()
	nm.currentContent = content

	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_NotesUpdated,
		Data: wshrpc.NotesUpdatedData{
			Content:    content,
			SourceOref: data.SourceOref,
		},
	})
	return nil
}
