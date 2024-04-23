package configstore

import (
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbus"
)

var instance *Watcher
var once sync.Once

type Watcher struct {
	watcher *fsnotify.Watcher
	mutex   sync.Mutex
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
		if err := instance.addPath(configDirAbsPath); err != nil {
			log.Printf("failed to add path %s to watcher: %v", configDirAbsPath, err)
			return
		}
	})
	return instance
}

// addPath adds the specified path and all its subdirectories to the watcher
func (w *Watcher) addPath(path string) error {
	return filepath.Walk(path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if err := w.watcher.Add(path); err != nil {
				return err
			}
			log.Printf("added to watcher: %s", path)
		}
		return nil
	})
}

func (w *Watcher) Start() {
	go func() {
		for {
			select {
			case event, ok := <-w.watcher.Events:
				if !ok {
					return
				}
				log.Printf("event: %s, Op: %v", event.Name, event.Op)
				w.mutex.Lock()
				w.handleEvent(event)
				w.mutex.Unlock()
			case err, ok := <-w.watcher.Errors:
				if !ok {
					return
				}
				log.Println("watcher error:", err)
			}
		}
	}()
}

func (w *Watcher) Close() {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	if w.watcher != nil {
		w.watcher.Close()
		w.watcher = nil
		log.Println("file watcher closed.")
	}
}

func (w *Watcher) handleEvent(event fsnotify.Event) {
	config := make(ConfigReturn)
	fileName, normalizedPath := getNameAndPath(event)

	if event.Op&fsnotify.Write == fsnotify.Write || event.Op&fsnotify.Create == fsnotify.Create || event.Op&fsnotify.Rename == fsnotify.Rename {
		content, err := readFileContents(normalizedPath)
		if err != nil {
			log.Printf("error reading file %s: %v", normalizedPath, err)
			return
		}
		config[fileName] = &content
	}

	if event.Op&fsnotify.Remove == fsnotify.Remove {
		config[fileName] = nil
	}

	update := scbus.MakeUpdatePacket()
	update.AddUpdate(config)
	scbus.MainUpdateBus.DoUpdate(update)
}
