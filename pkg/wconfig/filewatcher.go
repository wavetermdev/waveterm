// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"log"
	"path/filepath"
	"regexp"
	"sync"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/pkg/eventbus"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

var configDirAbsPath = filepath.Join(wavebase.GetWaveHomeDir(), wavebase.ConfigDir)

var instance *Watcher
var once sync.Once

type Watcher struct {
	initialized bool
	watcher     *fsnotify.Watcher
	mutex       sync.Mutex
	fullConfig  FullConfigType
}

type WatcherUpdate struct {
	FullConfig FullConfigType `json:"fullconfig"`
}

// GetWatcher returns the singleton instance of the Watcher
func GetWatcher() *Watcher {
	once.Do(func() {
		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			log.Printf("failed to create file watcher: %v", err)
			return
		}
		instance = &Watcher{watcher: watcher}
		err = instance.watcher.Add(configDirAbsPath)
		if err != nil {
			log.Printf("failed to add path %s to watcher: %v", configDirAbsPath, err)
		}
	})
	return instance
}

func (w *Watcher) Start() {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	log.Printf("starting file watcher\n")
	w.initialized = true
	w.sendInitialValues()

	go func() {
		for {
			select {
			case event, ok := <-w.watcher.Events:
				if !ok {
					return
				}
				w.handleEvent(event)
			case err, ok := <-w.watcher.Errors:
				if !ok {
					return
				}
				log.Println("watcher error:", err)
			}
		}
	}()
}

// for initial values, exit on first error
func (w *Watcher) sendInitialValues() error {
	w.fullConfig = ReadFullConfig()
	message := WatcherUpdate{
		FullConfig: w.fullConfig,
	}
	w.broadcast(message)
	return nil
}

func (w *Watcher) Close() {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	if w.watcher != nil {
		w.watcher.Close()
		w.watcher = nil
		log.Println("file watcher closed")
	}
}

func (w *Watcher) broadcast(message WatcherUpdate) {
	// send to frontend
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: eventbus.WSEvent_Config,
		Data:      message,
	})
}

func (w *Watcher) GetFullConfig() FullConfigType {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	return w.fullConfig
}

func (w *Watcher) handleEvent(event fsnotify.Event) {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	fileName := filepath.ToSlash(event.Name)
	if event.Op == fsnotify.Chmod {
		return
	}
	if !isValidSubSettingsFileName(fileName) {
		return
	}
	w.handleSettingsFileEvent(event, fileName)
}

var validFileRe = regexp.MustCompile(`^[a-zA-Z0-9_@.-]+\.json$`)

func isValidSubSettingsFileName(fileName string) bool {
	if filepath.Ext(fileName) != ".json" {
		return false
	}
	baseName := filepath.Base(fileName)
	return validFileRe.MatchString(baseName)
}

func (w *Watcher) handleSettingsFileEvent(event fsnotify.Event, fileName string) {
	fullConfig := ReadFullConfig()
	w.fullConfig = fullConfig
	w.broadcast(WatcherUpdate{FullConfig: w.fullConfig})
}
