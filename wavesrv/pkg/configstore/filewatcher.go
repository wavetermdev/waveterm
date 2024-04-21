package configstore

import (
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"
)

type EventHandler interface {
	HandleCreate(event fsnotify.Event)
	HandleRemove(event fsnotify.Event)
	HandleRename(event fsnotify.Event)
}

type Watcher struct {
	watcher *fsnotify.Watcher
	handler EventHandler
	mutex   sync.Mutex
}

var (
	instance *Watcher
	once     sync.Once
)

// GetWatcher returns the singleton instance of the Watcher
func GetWatcher() *Watcher {
	once.Do(func() {
		instance = makeWatcher()
		instance.Start()
	})
	return instance
}

func makeWatcher() *Watcher {
	fsWatcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Fatalf("failed to create file watcher: %v", err)
		return nil
	}
	return &Watcher{
		watcher: fsWatcher,
	}
}

// SetEventHandler sets the event handler for the watcher
func (w *Watcher) SetEventHandler(handler EventHandler) {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	w.handler = handler
}

// AddPath adds the specified path and all its subdirectories to the watcher
func (w *Watcher) AddPath(path string) error {
	err := filepath.Walk(path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			err = w.watcher.Add(path)
			if err != nil {
				return err
			}
			log.Printf("added to watcher: %s", path)
		}
		return nil
	})
	return err
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
				if w.handler != nil {
					w.handleEvent(event)
				} else {
					log.Printf("event received but no handler is set")
				}
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
	switch {
	case event.Op&fsnotify.Write == fsnotify.Write || event.Op&fsnotify.Create == fsnotify.Create:
		w.handler.HandleCreate(event)
	case event.Op&fsnotify.Remove == fsnotify.Remove:
		w.handler.HandleRemove(event)
	case event.Op&fsnotify.Rename == fsnotify.Rename:
		w.handler.HandleRename(event)
	}
}
