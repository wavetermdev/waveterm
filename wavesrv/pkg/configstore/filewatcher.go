package configstore

import (
	"log"
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
// Singleton for now per mike's suggestion
func GetWatcher(handler EventHandler) (*Watcher, error) {
	var err error
	once.Do(func() {
		instance, err = makeWatcher(handler)
		if err == nil {
			instance.Start()
		}
	})
	return instance, err
}

func makeWatcher(handler EventHandler) (*Watcher, error) {
	fsWatcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Watcher{
		watcher: fsWatcher,
		handler: handler,
	}, nil
}

func (w *Watcher) AddPath(path string) error {
	return w.watcher.Add(path)
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
	switch {
	case event.Op&fsnotify.Write == fsnotify.Write || event.Op&fsnotify.Create == fsnotify.Create:
		w.handler.HandleCreate(event)
	case event.Op&fsnotify.Remove == fsnotify.Remove:
		w.handler.HandleRemove(event)
	case event.Op&fsnotify.Rename == fsnotify.Rename:
		w.handler.HandleRename(event)
	}
}
