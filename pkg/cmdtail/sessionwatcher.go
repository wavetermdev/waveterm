// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package cmdtail

import (
	"fmt"
	"os"
	"path"
	"regexp"
	"sync"

	"github.com/fsnotify/fsnotify"
	"github.com/google/uuid"
	"github.com/scripthaus-dev/sh2-runner/pkg/base"
)

const FileTypePty = "ptyout"
const FileTypeRun = "runout"
const eventChSize = 10

type FileUpdateEvent struct {
	SessionId string
	CmdId     string
	FileType  string
	Size      int64
	Err       error
}

type SessionWatcher struct {
	Lock      *sync.Mutex
	Sessions  map[string]bool
	ScHomeDir string
	Watcher   *fsnotify.Watcher
	EventCh   chan FileUpdateEvent
	Err       error
	Running   bool
}

func MakeSessionWatcher() (*SessionWatcher, error) {
	scHomeDir, err := base.GetScHomeDir()
	if err != nil {
		return nil, err
	}
	rtn := &SessionWatcher{
		Lock:      &sync.Mutex{},
		Sessions:  make(map[string]bool),
		ScHomeDir: scHomeDir,
		EventCh:   make(chan FileUpdateEvent, eventChSize),
	}
	rtn.Watcher, err = fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func (w *SessionWatcher) Close() error {
	return w.Watcher.Close()
}

func (w *SessionWatcher) UnWatchSession(sessionId string) error {
	_, err := uuid.Parse(sessionId)
	if err != nil {
		return fmt.Errorf("WatchSession, bad sessionid '%s': %w", sessionId, err)
	}
	w.Lock.Lock()
	defer w.Lock.Unlock()
	if !w.Sessions[sessionId] {
		return nil
	}
	sessionDir := path.Join(w.ScHomeDir, base.SessionsDirBaseName, sessionId)
	err = w.Watcher.Remove(sessionDir)
	if err != nil {
		return err
	}
	w.Sessions[sessionId] = false
	return nil
}

func (w *SessionWatcher) WatchSession(sessionId string) error {
	_, err := uuid.Parse(sessionId)
	if err != nil {
		return fmt.Errorf("WatchSession, bad sessionid '%s': %w", sessionId, err)
	}

	w.Lock.Lock()
	defer w.Lock.Unlock()
	if w.Sessions[sessionId] {
		return nil
	}
	sessionDir := path.Join(w.ScHomeDir, base.SessionsDirBaseName, sessionId)
	err = w.Watcher.Add(sessionDir)
	if err != nil {
		return err
	}
	w.Sessions[sessionId] = true
	return nil
}

func (w *SessionWatcher) setRunning() bool {
	w.Lock.Lock()
	defer w.Lock.Unlock()
	if w.Running {
		return false
	}
	w.Running = true
	return true
}

var swUpdateFileRe = regexp.MustCompile("/([a-z0-9-]+)/([a-z0-9-]+)\\.(ptyout|runout)$")

func (w *SessionWatcher) updateFile(relFileName string) {
	m := swUpdateFileRe.FindStringSubmatch(relFileName)
	if m == nil {
		return
	}
	event := FileUpdateEvent{SessionId: m[1], CmdId: m[2], FileType: m[3]}
	finfo, err := os.Stat(relFileName)
	if err != nil {
		event.Err = err
		w.EventCh <- event
		return
	}
	event.Size = finfo.Size()
	w.EventCh <- event
	return
}

func (w *SessionWatcher) Run(stopCh chan bool) error {
	ok := w.setRunning()
	if !ok {
		return fmt.Errorf("Cannot run SessionWatcher (alreaady running)")
	}
	defer func() {
		w.Lock.Lock()
		defer w.Lock.Unlock()
		w.Running = false
		close(w.EventCh)
	}()
	for {
		select {
		case event, ok := <-w.Watcher.Events:
			if !ok {
				return nil
			}
			if (event.Op&fsnotify.Write == fsnotify.Write) || (event.Op&fsnotify.Create == fsnotify.Create) {
				w.updateFile(event.Name)
			}

		case err, ok := <-w.Watcher.Errors:
			if !ok {
				return nil
			}
			return fmt.Errorf("Got error in SessionWatcher: %w", err)

		case <-stopCh:
			return nil
		}
	}
	return nil
}
