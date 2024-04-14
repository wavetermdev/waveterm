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

// LoadAndWatchThemes initializes the file watching and loads initial data.
func (t *TermThemes) LoadAndWatchThemes() {
	dirPath := path.Join(scbase.GetWaveHomeDir(), TermThemeDir)
	if _, err := os.Stat(dirPath); errors.Is(err, os.ErrNotExist) {
		log.Printf("directory does not exist: %s", dirPath)
		return
	}

	// Load existing files and handle JSON conversion
	if err := t.loadInitialFiles(dirPath); err != nil {
		log.Println("failed to load initial files:", err)
		return
	}

	update := scbus.MakeUpdatePacket()
	update.AddUpdate(t.Themes)

	if err := t.State.WriteUpdate(update); err != nil {
		log.Printf("error sending initial file data via WebSocket: %v", err)
	}

	t.setupFileWatcher(dirPath)
}

// Reads all JSON files in the specified directory.
func (t *TermThemes) loadInitialFiles(dirPath string) error {
	files, err := os.ReadDir(dirPath)
	if err != nil {
		return err
	}

	for _, file := range files {
		if filepath.Ext(file.Name()) == ".json" {
			filePath := filepath.Join(dirPath, file.Name())
			data, err := os.ReadFile(filePath)
			if err != nil {
				log.Printf("error reading file %s: %v", filePath, err)
				continue
			}

			content := make(map[string]string)
			if err := json.Unmarshal(data, &content); err != nil {
				log.Printf("error unmarshalling JSON from file %s: %v", filePath, err)
				continue
			}
			t.Themes[file.Name()] = content
		}
	}
	return nil
}

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
				log.Printf("event: %s, Op: %v\n", event.Name, event.Op)
				if event.Op&fsnotify.Write == fsnotify.Write && filepath.Ext(event.Name) == ".json" {
					t.handleFileChange(event.Name)
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Println("watcher error:", err)
			}
		}
	}()

	err = watcher.Add(dirPath)
	if err != nil {
		log.Println("error adding directory to watcher:", err)
	}
}

func (t *TermThemes) handleFileChange(filePath string) error {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("error reading file %s: %v", filePath, err)
	}

	var content map[string]string
	if err := json.Unmarshal(data, &content); err != nil {
		return fmt.Errorf("error unmarshalling JSON from file %s: %v", filePath, err)
	}

	t.Themes[filepath.Base(filePath)] = content
	update := scbus.MakeUpdatePacket()
	update.AddUpdate(t.Themes)
	return t.State.WriteUpdate(update)
}
