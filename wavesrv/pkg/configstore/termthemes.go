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
)

const (
	TermThemesStateTypeStr       = "termthemeoptions"
	TermThemesStateDir           = "config/terminal-themes/"
	TermThemesStateReconnectTime = 30 * time.Second
)

var TermThemesStateMap = make(map[string]*TermThemesState)
var TermThemesStateLock = &sync.Mutex{}

type TermThemeOptionsType map[string]map[string]string

func (tt TermThemeOptionsType) GetType() string {
	return TermThemesStateTypeStr
}

type TermThemesState struct {
	Themes      TermThemeOptionsType
	ClientId    string
	Watcher     *fsnotify.Watcher
	Lock        *sync.Mutex
	ConnectTime time.Time
	DirPath     string
}

func setTermThemesState(tt *TermThemesState) {
	TermThemesStateLock.Lock()
	defer TermThemesStateLock.Unlock()
	TermThemesStateMap[tt.ClientId] = tt
}

func GetTermThemesState(clientId string) *TermThemesState {
	TermThemesStateLock.Lock()
	defer TermThemesStateLock.Unlock()
	return TermThemesStateMap[clientId]
}

func isValidPath() bool {
	dirPath := path.Join(scbase.GetWaveHomeDir(), TermThemesStateDir)
	if _, err := os.Stat(dirPath); errors.Is(err, os.ErrNotExist) {
		log.Printf("directory does not exist: %s", dirPath)
		return false
	}
	return true
}

func removeTermThemesStateAfterTimeout(clientId string, connectTime time.Time, waitDuration time.Duration) {
	go func() {
		time.Sleep(waitDuration)
		TermThemesStateLock.Lock()
		defer TermThemesStateLock.Unlock()
		tt := TermThemesStateMap[clientId]
		if tt == nil || tt.ConnectTime != connectTime {
			return
		}
		delete(TermThemesStateMap, clientId)
	}()
}

func getNameAndPath(event fsnotify.Event) (string, string) {
	filePath := event.Name
	fileName := filepath.Base(filePath)

	// Normalize the file path for consistency across platforms
	normalizedPath := filepath.ToSlash(filePath)
	return fileName, normalizedPath
}

func SetupTermThemesState(clientId string) {
	if clientId == "" {
		log.Println("clientId is empty")
		return
	}
	if !isValidPath() {
		log.Println("invalid dir path")
		return
	}
	tt := GetTermThemesState(clientId)
	if tt == nil {
		log.Println("creating new instance of TermThemesState...")
		tt = MakeTermThemesState(clientId)
		if err := tt.SetupWatcher(); err != nil {
			log.Printf("error setting up watcher: %v", err)
			return
		}
		log.Println("watcher setup successful...")
		setTermThemesState(tt)
	} else {
		log.Println("reusing existing instance of TermThemesState...")
		tt.UpdateConnectTime()
	}
	stateConnectTime := tt.GetConnectTime()
	defer removeTermThemesStateAfterTimeout(clientId, stateConnectTime, TermThemesStateReconnectTime)
}

// Factory method for TermThemesState
func MakeTermThemesState(clientId string) *TermThemesState {
	return &TermThemesState{
		Themes:      make(map[string]map[string]string),
		ClientId:    clientId,
		Lock:        &sync.Mutex{},
		ConnectTime: time.Now(),
		DirPath:     path.Join(scbase.GetWaveHomeDir(), TermThemesStateDir),
	}
}

func (t *TermThemesState) SetupWatcher() error {
	dirPath := path.Join(scbase.GetWaveHomeDir(), TermThemesStateDir)
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

func (t *TermThemesState) HandleCreate(event fsnotify.Event) {
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

func (t *TermThemesState) HandleRemove(event fsnotify.Event) {
	fileName, _ := getNameAndPath(event)

	log.Println("performing delete event...")
	// For remove events, delete the file from the Themes map.
	delete(t.Themes, fileName)
	t.updateThemes() // Update themes after removing the file.
}

func (t *TermThemesState) HandleRename(event fsnotify.Event) {
	_, normalizedPath := getNameAndPath(event)

	// Rename might affect file identity; rescan to ensure accuracy
	log.Printf("rename event detected, rescanning directory: %s", normalizedPath)
	if err := t.scanDirAndUpdate(); err != nil {
		log.Printf("error rescanning directory after rename: %v", err)
	}
}

func (t *TermThemesState) UpdateConnectTime() {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	t.ConnectTime = time.Now()
}

func (t *TermThemesState) GetConnectTime() time.Time {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	return t.ConnectTime
}

// scanDirAndUpdate scans the directory and updates themes.
func (t *TermThemesState) scanDirAndUpdate() error {
	newThemes, err := t.ScanDir()
	if err != nil {
		return err
	}

	t.Themes = newThemes
	t.updateThemes()
	return nil
}

// scanDir reads all JSON files in the specified directory.
func (t *TermThemesState) ScanDir() (TermThemeOptionsType, error) {
	newThemes := make(TermThemeOptionsType)

	files, err := os.ReadDir(t.DirPath)
	if err != nil {
		return nil, err
	}

	for _, file := range files {
		if filepath.Ext(file.Name()) == ".json" {
			filePath := filepath.Join(t.DirPath, file.Name())
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
func (t *TermThemesState) readFileContents(filePath string) (map[string]string, error) {
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
func (t *TermThemesState) updateThemes() {
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(t.Themes)
	scbus.MainUpdateBus.DoUpdate(update)
}
