package configstore

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbus"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scws"
)

const (
	TermThemesTypeStr       = "termthemeoptions"
	TermThemesDir           = "config/terminal-themes/"
	TermThemesReconnectTime = 30 * time.Second
)

var TermThemesMap = make(map[string]*TermThemes)
var GlobalLock = &sync.Mutex{}

type TermThemesType map[string]map[string]string

func (tt TermThemesType) GetType() string {
	return TermThemesTypeStr
}

type TermThemes struct {
	Themes      TermThemesType
	State       *scws.WSState // Using WSState to manage WebSocket operations
	Watcher     *fsnotify.Watcher
	Lock        *sync.Mutex
	ConnectTime time.Time
}

func setTermThemes(tt *TermThemes) {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	TermThemesMap[tt.State.ClientId] = tt
}

func getTermThemes(clientId string) *TermThemes {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	return TermThemesMap[clientId]
}

func removeTermThemesAfterTimeout(clientId string, connectTime time.Time, waitDuration time.Duration) {
	go func() {
		time.Sleep(waitDuration)
		GlobalLock.Lock()
		defer GlobalLock.Unlock()
		tt := TermThemesMap[clientId]
		if tt == nil || tt.ConnectTime != connectTime {
			return
		}
		delete(TermThemesMap, clientId)
	}()
}

func getNameAndPath(event fsnotify.Event) (string, string) {
	filePath := event.Name
	fileName := filepath.Base(filePath)

	// Normalize the file path for consistency across platforms
	normalizedPath := filepath.ToSlash(filePath)
	return fileName, normalizedPath
}

func SetupTermThemes(state *scws.WSState) {
	if state == nil {
		log.Println("WSState is nil")
		return
	}
	tt := getTermThemes(state.ClientId)
	if tt == nil {
		log.Println("creating new instance of TermThemes...")
		tt = MakeTermThemes(state)
		if err := tt.SetupWatcher(); err != nil {
			log.Printf("error setting up watcher: %v", err)
			return
		}
		log.Println("watcher setup successful...")
		setTermThemes(tt)
	} else {
		log.Println("reusing existing instance of TermThemes...")
		tt.UpdateConnectTime()
	}
	stateConnectTime := tt.GetConnectTime()
	defer removeTermThemesAfterTimeout(state.ClientId, stateConnectTime, TermThemesReconnectTime)

	tt.LoadThemes()
}

// Factory method for TermThemes
func MakeTermThemes(state *scws.WSState) *TermThemes {
	return &TermThemes{
		Themes:      make(map[string]map[string]string),
		State:       state,
		Lock:        &sync.Mutex{},
		ConnectTime: time.Now(),
	}
}

func (t *TermThemes) SetupWatcher() error {
	dirPath := path.Join(scbase.GetWaveHomeDir(), TermThemesDir)
	watcher, err := GetWatcher(t)
	if err != nil {
		return fmt.Errorf("error getting watcher: %v", err)
	}
	err = watcher.AddPath(dirPath)
	if err != nil {
		return fmt.Errorf("error adding path to watcher: %v", err)
	}
	return nil
}

func (t *TermThemes) HandleCreate(event fsnotify.Event) {
	fileName, normalizedPath := getNameAndPath(event)

	log.Println("performing write or create event...")
	// For write and create events, update or add the file to the Themes map.
	content, err := t.readFileContents(normalizedPath)
	if err != nil {
		log.Printf("error reading file %s: %v", normalizedPath, err)
		return
	}
	t.Themes[fileName] = content
	t.updateThemes()
}

func (t *TermThemes) HandleRemove(event fsnotify.Event) {
	fileName, _ := getNameAndPath(event)

	log.Println("performing delete event...")
	// For remove events, delete the file from the Themes map.
	delete(t.Themes, fileName)
	t.updateThemes() // Update themes after removing the file.
}

func (t *TermThemes) HandleRename(event fsnotify.Event) {
	_, normalizedPath := getNameAndPath(event)

	// Rename might affect file identity; rescan to ensure accuracy
	log.Printf("rename event detected, rescanning directory: %s", normalizedPath)
	if err := t.scanDirAndUpdate(path.Dir(normalizedPath)); err != nil {
		log.Printf("error rescanning directory after rename: %v", err)
	}
}

func (t *TermThemes) UpdateConnectTime() {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	t.ConnectTime = time.Now()
}

func (t *TermThemes) GetConnectTime() time.Time {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	return t.ConnectTime
}

// LoadThemes initializes file scanning.
func (t *TermThemes) LoadThemes() {
	dirPath := path.Join(scbase.GetWaveHomeDir(), TermThemesDir)
	if _, err := os.Stat(dirPath); errors.Is(err, os.ErrNotExist) {
		log.Printf("directory does not exist: %s", dirPath)
		return
	}

	if err := t.scanDirAndUpdate(dirPath); err != nil {
		log.Printf("failed to scan directory and update themes: %v", err)
		return
	}
}

// scanDirAndUpdate scans the directory and updates themes.
func (t *TermThemes) scanDirAndUpdate(dirPath string) error {
	log.Println("performing directory scan...")
	newThemes, err := t.scanDir(dirPath)
	if err != nil {
		return err
	}

	t.Themes = newThemes
	return t.updateThemes()
}

// scanDir reads all JSON files in the specified directory.
func (t *TermThemes) scanDir(dirPath string) (TermThemesType, error) {
	newThemes := make(TermThemesType)

	files, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, err
	}

	for _, file := range files {
		if filepath.Ext(file.Name()) == ".json" {
			filePath := filepath.Join(dirPath, file.Name())
			content, err := t.readFileContents(filePath)
			if err != nil {
				log.Printf("error reading file %s: %v", filePath, err)
				continue
			}
			newThemes[file.Name()] = content
		}
	}

	return newThemes, nil
}

// readFileContents reads and unmarshals the JSON content from a file.
func (t *TermThemes) readFileContents(filePath string) (map[string]string, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	var content map[string]string
	if err := json.Unmarshal(data, &content); err != nil {
		return nil, err
	}
	return content, nil
}

// updateThemes sends an update of all themes via WebSocket.
func (t *TermThemes) updateThemes() error {
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(t.Themes)
	if err := t.State.WriteUpdate(update); err != nil {
		return fmt.Errorf("error sending updated themes via WebSocket: %v", err)
	}
	return nil
}
