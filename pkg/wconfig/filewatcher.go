// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
)

const configDir = "config"

var configDirAbsPath = filepath.Join(wavebase.GetWaveHomeDir(), configDir)
var termThemesDirAbsPath = filepath.Join(configDirAbsPath, termThemesDir)

var instance *Watcher
var once sync.Once

type Watcher struct {
	initialized  bool
	watcher      *fsnotify.Watcher
	mutex        sync.Mutex
	settingsData SettingsConfigType
}

type WatcherUpdate struct {
	Settings SettingsConfigType `json:"settings"`
	Error    string             `json:"error"`
}

func LoadFullSettings() (*SettingsConfigType, error) {
	// first load settings.json
	// then load themes
	// then apply defaults
	settings, err := readFileContents[SettingsConfigType](settingsAbsPath, false)
	if err != nil {
		return nil, err
	}
	themes, err := readThemes()
	if err != nil {
		return nil, err
	}
	if settings.TermThemes == nil {
		settings.TermThemes = make(map[string]TermThemeType)
	}
	for k, v := range themes {
		settings.TermThemes[k] = v
	}
	applyDefaultSettings(settings)
	return settings, nil
}

func readThemes() (map[string]TermThemeType, error) {
	files, err := os.ReadDir(termThemesDirAbsPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("error reading themes directory: %v", err)
	}
	themes := make(map[string]TermThemeType)
	for _, file := range files {
		if !file.IsDir() && filepath.Ext(file.Name()) == ".json" {
			log.Printf("reading theme file %s\n", file.Name())
			theme, err := readFileContents[TermThemeType](filepath.Join(termThemesDirAbsPath, file.Name()), true)
			if err != nil {
				log.Printf("error reading theme file %s: %v", file.Name(), err)
				continue
			}
			if theme == nil {
				continue
			}
			themeName := getThemeName(file.Name())
			themes[themeName] = *theme
		}
	}
	return themes, nil

}

func readFileContents[T any](filePath string, nilOnNotExist bool) (*T, error) {
	var content T
	data, err := os.ReadFile(filePath)
	if errors.Is(err, os.ErrNotExist) {
		if nilOnNotExist {
			return nil, nil
		} else {
			return &content, nil
		}
	}
	if err != nil {
		log.Printf("could not read file %s: %v", filePath, err)
		return nil, err
	}
	if err := json.Unmarshal(data, &content); err != nil {
		log.Printf("could not unmarshal file %s: %v", filePath, err)
		return nil, err
	}
	return &content, nil
}

func isInDirectory(fileName, directory string) bool {
	rel, err := filepath.Rel(directory, fileName)
	return err == nil && !strings.HasPrefix(rel, "..")
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
		if err := instance.addSettingsFile(settingsAbsPath); err != nil {
			log.Printf("failed to add path %s to watcher: %v", settingsAbsPath, err)
			return
		}
		if err := instance.addTermThemesDir(termThemesDirAbsPath); err != nil {
			log.Printf("failed to add terminal themes path %s to watcher: %v", termThemesDirAbsPath, err)
			return
		}
	})
	return instance
}

func (w *Watcher) addSettingsFile(filePath string) error {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	dir := filepath.Dir(filePath)
	err := os.MkdirAll(dir, 0751)
	if err != nil {
		return fmt.Errorf("error creating config directory: %v", err)
	}

	w.watcher.Add(filePath)
	log.Printf("started config watcher: %v\n", filePath)
	return nil
}

func (w *Watcher) addTermThemesDir(dir string) error {
	w.mutex.Lock()
	defer w.mutex.Unlock()

	_, err := os.Stat(dir)
	if os.IsNotExist(err) {
		if err := os.MkdirAll(dir, 0751); err != nil {
			return fmt.Errorf("error creating themes directory: %v", err)
		}
	} else if err != nil {
		return fmt.Errorf("error accessing themes directory: %v", err)
	}
	if err := w.watcher.Add(dir); err != nil {
		return fmt.Errorf("error adding themes directory to watcher: %v", err)
	}
	log.Printf("started termthemes watcher: %v\n", dir)
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
	settings, err := LoadFullSettings()
	if err != nil {
		return err
	}
	w.settingsData = *settings
	message := WatcherUpdate{
		Settings: w.settingsData,
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

	if message.Error != "" {
		log.Printf("watcher: error processing update: %v. error: %s", message.Settings, message.Error)
	} else {
		log.Printf("watcher: update: %v", message.Settings)
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

	if isInDirectory(fileName, termThemesDirAbsPath) {
		w.handleTermThemesEvent(event, fileName)
	} else if filepath.Base(fileName) == filepath.Base(settingsAbsPath) {
		w.handleSettingsFileEvent(event, fileName)
	}
}

func (w *Watcher) handleTermThemesEvent(event fsnotify.Event, fileName string) {
	settings, err := LoadFullSettings()
	if err != nil {
		log.Printf("error loading settings after term-themes event: %v", err)
		return
	}
	w.settingsData = *settings
	w.broadcast(WatcherUpdate{Settings: w.settingsData})
}

func (w *Watcher) handleSettingsFileEvent(event fsnotify.Event, fileName string) {
	settings, err := LoadFullSettings()
	if err != nil {
		log.Printf("error loading settings after settings file event: %v", err)
		return
	}
	w.settingsData = *settings
	w.broadcast(WatcherUpdate{Settings: w.settingsData})
}

func getThemeName(fileName string) string {
	return strings.TrimSuffix(filepath.Base(fileName), filepath.Ext(fileName))
}

func (w *Watcher) AddWidget(newWidget WidgetsConfigType) error {
	current := w.GetSettingsConfig()
	current.Widgets = append(current.Widgets, newWidget)
	update, err := json.Marshal(current)
	if err != nil {
		return err
	}

	os.MkdirAll(filepath.Dir(settingsFile), 0751)
	return os.WriteFile(settingsFile, update, 0644)
}

func (w *Watcher) RmWidget(idx uint) error {
	current := w.GetSettingsConfig().Widgets
	truncated := append(current[:idx], current[idx+1:]...)
	update, err := json.Marshal(truncated)
	if err != nil {
		return err
	}

	os.MkdirAll(filepath.Dir(settingsFile), 0751)
	return os.WriteFile(settingsFile, update, 0644)
}
