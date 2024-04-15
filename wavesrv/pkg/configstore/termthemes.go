package configstore

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path"
	"path/filepath"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbus"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scws"
)

const (
	TermThemesTypeStr = "termthemes"
	TermThemeDir      = "config/terminal-themes/"
)

type TermThemesType map[string]map[string]string

func (tt TermThemesType) GetType() string {
	return TermThemesTypeStr
}

type TermThemes struct {
	Themes TermThemesType
	State  *scws.WSState // Using WSState to manage WebSocket operations
}

// Factory function to create a new TermThemes instance with WSState.
func MakeTermThemes(state *scws.WSState) *TermThemes {
	return &TermThemes{
		Themes: make(TermThemesType),
		State:  state,
	}
}

// LoadAndWatchThemes initializes file scanning and sets up file watching.
func (t *TermThemes) LoadAndWatchThemes() {
	dirPath := path.Join(scbase.GetWaveHomeDir(), TermThemeDir)
	if _, err := os.Stat(dirPath); errors.Is(err, os.ErrNotExist) {
		log.Printf("directory does not exist: %s", dirPath)
		return
	}

	if err := t.scanDirAndUpdate(dirPath); err != nil {
		log.Printf("failed to scan directory and update themes: %v", err)
		return
	}

	t.setupFileWatcher(dirPath)
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

// setupFileWatcher sets up a file system watcher on the given directory.
func (t *TermThemes) setupFileWatcher(dirPath string) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Println("error creating file watcher:", err)
		return
	}
	go func() {
		defer func() {
			watcher.Close()
			log.Println("file watcher stopped.")
		}()
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				log.Printf("event: %s, Op: %v", event.Name, event.Op)
				t.handleFileEvent(event)
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Println("watcher error:", err)
			}
		}
	}()

	if err := watcher.Add(dirPath); err != nil {
		log.Println("error adding directory to watcher:", err)
	}
}

// handleFileEvent handles file system events and triggers a directory rescan only on rename events.
func (t *TermThemes) handleFileEvent(event fsnotify.Event) {
	filePath := event.Name
	fileName := filepath.Base(filePath)

	// Normalize the file path for consistency across platforms
	normalizedPath := filepath.ToSlash(filePath)

	switch event.Op {
	case fsnotify.Write, fsnotify.Create:
		log.Println("performing write or create event...")
		// For write and create events, update or add the file to the Themes map.
		content, err := t.readFileContents(normalizedPath)
		if err != nil {
			log.Printf("error reading file %s: %v", normalizedPath, err)
			return
		}
		t.Themes[fileName] = content
		t.updateThemes() // Update themes after adding or changing the file.

	case fsnotify.Remove:
		log.Println("performing delete event...")
		// For remove events, delete the file from the Themes map.
		delete(t.Themes, fileName)
		t.updateThemes() // Update themes after removing the file.

	case fsnotify.Rename:
		// Rename might affect file identity; rescan to ensure accuracy
		log.Printf("rename event detected, rescanning directory: %s", normalizedPath)
		if err := t.scanDirAndUpdate(path.Dir(normalizedPath)); err != nil {
			log.Printf("error rescanning directory after rename: %v", err)
		}
	}
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
