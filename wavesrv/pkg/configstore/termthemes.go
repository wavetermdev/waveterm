package configstore

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path"
	"path/filepath"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
)

const ConfigReturnTypeStr = "termthemes"
const configDir = "config/terminal-themes/"

var configDirAbsPath = path.Join(scbase.GetWaveHomeDir(), configDir)

type ConfigReturn map[string]*map[string]string

func (tt ConfigReturn) GetType() string {
	return ConfigReturnTypeStr
}

func getNameAndPath(event fsnotify.Event) (string, string) {
	filePath := event.Name
	fileName := filepath.Base(filePath)

	// Normalize the file path for consistency across platforms
	normalizedPath := filepath.ToSlash(filePath)
	return fileName, normalizedPath
}

// readFileContents reads and unmarshals the JSON content from a file.
func readFileContents(filePath string) (map[string]string, error) {
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

// ScanConfigs reads all JSON files in the specified directory and its subdirectories.
func ScanConfigs() (ConfigReturn, error) {
	config := make(ConfigReturn)

	if _, err := os.Stat(configDirAbsPath); errors.Is(err, os.ErrNotExist) {
		log.Printf("directory does not exist: %s", configDirAbsPath)
		return ConfigReturn{}, nil
	}

	err := filepath.Walk(configDirAbsPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && filepath.Ext(info.Name()) == ".json" {
			content, err := readFileContents(path)
			if err != nil {
				log.Printf("error reading file %s: %v", path, err)
				return nil // continue walking despite error in reading file
			}
			// Use the relative path from the directory as the key to store themes
			relPath, err := filepath.Rel(configDirAbsPath, path)
			if err != nil {
				log.Printf("error getting relative file path %s: %v", path, err)
				return nil // continue walking despite error in getting relative path
			}
			config[relPath] = &content
		}
		return nil
	})

	if err != nil {
		return nil, err
	}

	return config, nil
}
