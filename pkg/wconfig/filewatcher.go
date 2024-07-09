// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
)

const configDir = "config"

var configDirAbsPath = filepath.Join(wavebase.GetWaveHomeDir(), configDir)

var instance *Watcher
var once sync.Once

type Watcher struct {
	initialized         bool
	watcher             *fsnotify.Watcher
	mutex               sync.Mutex
	settingsFile        string
	getSettingsDefaults func() SettingsConfigType
	settingsData        SettingsConfigType
}

type WatcherUpdate struct {
	File   string             `json:"file"`
	Update SettingsConfigType `json:"update"`
	Error  string             `json:"error"`
}

func readFileContents(filePath string, getDefaults func() SettingsConfigType) (*SettingsConfigType, error) {
	if getDefaults == nil {
		log.Printf("oopsie")
		return nil, fmt.Errorf("watcher started without defaults")
	}
	content := getDefaults()
	data, err := os.ReadFile(filePath)
	if err != nil {
		log.Printf("doopsie: %v", err)
		return nil, err
	}
	if err := json.Unmarshal(data, &content); err != nil {
		return nil, err
	}
	return &content, nil
}

// GetWatcher returns the singleton instance of the Watcher
func GetWatcher() *Watcher {
	once.Do(func() {
		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			log.Printf("failed to create file watcher: %v", err)
			return
		}
		os.MkdirAll(configDirAbsPath, 0751)
		instance = &Watcher{watcher: watcher}
		log.Printf("started config watcher: %v\n", configDirAbsPath)
		if err := instance.addSettingsFile(settingsAbsPath, getSettingsConfigDefaults); err != nil {
			log.Printf("failed to add path %s to watcher: %v", configDirAbsPath, err)
			return
		}
	})
	return instance
}

func (w *Watcher) addSettingsFile(filename string, getDefaults func() SettingsConfigType) error {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	w.getSettingsDefaults = getDefaults
	filename = filepath.ToSlash(filename)

	stat, err := os.Lstat(filename)
	if err != nil {
		fmt.Printf("warning: cannot stat file: %v", err)
	} else {
		if stat.IsDir() {
			return fmt.Errorf("warning: can't watch directory instead of file: %v", err)
		}

	}
	w.settingsFile = filename
	w.watcher.Add(filepath.Dir(filename))

	return nil
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
	filename := w.settingsFile

	content, err := readFileContents(w.settingsFile, w.getSettingsDefaults)
	if os.IsNotExist(err) || os.IsPermission(err) {
		log.Printf("settings file cannot be read: using defaults")
		defaults := w.getSettingsDefaults()
		content = &defaults
	} else if err != nil {
		return err
	}

	message := WatcherUpdate{
		File:   filename,
		Update: *content,
	}

	w.settingsData = message.Update
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

	if message.File == w.settingsFile {
		w.settingsData = message.Update
	}

	if message.Error != "" {
		log.Printf("watcher: error processing %s. sending defaults: %v", message.File, message.Error)
	} else {
		log.Printf("watcher: update: %s -> %v", message.File, message.Update)
	}
}

func (w *Watcher) GetSettingsConfig() SettingsConfigType {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	return w.settingsData
}

func (w *Watcher) handleEvent(event fsnotify.Event) {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	fileName := filepath.ToSlash(event.Name)

	// only consider events for the tracked files
	if fileName != w.settingsFile {
		return
	}
	defaults := w.getSettingsDefaults()

	if event.Op&fsnotify.Remove == fsnotify.Remove || event.Op&fsnotify.Rename == fsnotify.Rename {
		message := WatcherUpdate{
			File:   fileName,
			Update: defaults,
		}
		w.broadcast(message)
	}

	if event.Op&fsnotify.Write == fsnotify.Write || event.Op&fsnotify.Create == fsnotify.Create {
		content, err := readFileContents(fileName, w.getSettingsDefaults)
		if err != nil {
			message := WatcherUpdate{
				File:   fileName,
				Update: defaults,
				Error:  err.Error(),
			}
			w.broadcast(message)
			return
		}
		message := WatcherUpdate{
			File:   fileName,
			Update: *content,
		}

		w.broadcast(message)
	}
}

func (w *Watcher) AddWidget(newWidget WidgetsConfigType) error {
	current := w.GetSettingsConfig()
	current.Widgets = append(current.Widgets, newWidget)
	update, err := json.Marshal(current)
	if err != nil {
		return err
	}

	os.MkdirAll(filepath.Dir(w.settingsFile), 0751)
	return os.WriteFile(w.settingsFile, update, 0644)
}

func (w *Watcher) RmWidget(idx uint) error {
	current := w.GetSettingsConfig().Widgets
	truncated := append(current[:idx], current[idx+1:]...)
	update, err := json.Marshal(truncated)
	if err != nil {
		return err
	}

	os.MkdirAll(filepath.Dir(w.settingsFile), 0751)
	return os.WriteFile(w.settingsFile, update, 0644)
}
