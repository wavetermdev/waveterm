package mapqueue

import (
	"fmt"
	"log"
	"runtime/debug"
	"sync"
)

type MQEntry struct {
	Lock    *sync.Mutex
	Running bool
	Queue   chan func()
}

type MapQueue struct {
	Lock      *sync.Mutex
	M         map[string]*MQEntry
	QueueSize int
}

func MakeMapQueue(queueSize int) *MapQueue {
	rtn := &MapQueue{
		Lock:      &sync.Mutex{},
		M:         make(map[string]*MQEntry),
		QueueSize: queueSize,
	}
	return rtn
}

func (mq *MapQueue) getEntry(id string) *MQEntry {
	mq.Lock.Lock()
	defer mq.Lock.Unlock()
	entry := mq.M[id]
	if entry == nil {
		entry = &MQEntry{
			Lock:    &sync.Mutex{},
			Running: false,
			Queue:   make(chan func(), mq.QueueSize),
		}
		mq.M[id] = entry
	}
	return entry
}

func (entry *MQEntry) add(fn func()) error {
	select {
	case entry.Queue <- fn:
		break
	default:
		return fmt.Errorf("input queue full")
	}
	entry.tryRun()
	return nil
}

func runFn(fn func()) {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[error] panic in MQEntry runFn: %v\n", r)
		debug.PrintStack()
		return
	}()
	fn()
}

func (entry *MQEntry) tryRun() {
	entry.Lock.Lock()
	defer entry.Lock.Unlock()
	if entry.Running {
		return
	}
	if len(entry.Queue) > 0 {
		entry.Running = true
		go entry.run()
	}
}

func (entry *MQEntry) run() {
	for fn := range entry.Queue {
		runFn(fn)
	}
	entry.Lock.Lock()
	entry.Running = false
	entry.Lock.Unlock()
	entry.tryRun()
}

func (mq *MapQueue) Enqueue(id string, fn func()) error {
	entry := mq.getEntry(id)
	err := entry.add(fn)
	if err != nil {
		return fmt.Errorf("cannot enqueue: %v", err)
	}
	return nil
}
