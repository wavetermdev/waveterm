package remote

import (
	"fmt"
	"sync"
)

type CircleLog struct {
	Lock     *sync.Mutex
	StartPos int
	Log      []string
	MaxSize  int
}

func MakeCircleLog(maxSize int) *CircleLog {
	if maxSize <= 0 {
		panic("invalid maxsize, must be >= 0")
	}
	rtn := &CircleLog{
		Lock:     &sync.Mutex{},
		StartPos: 0,
		Log:      make([]string, 0, maxSize),
		MaxSize:  maxSize,
	}
	return rtn
}

func (l *CircleLog) Add(s string) {
	l.Lock.Lock()
	defer l.Lock.Unlock()
	if len(l.Log) < l.MaxSize {
		l.Log = append(l.Log, s)
		return
	}
	l.Log[l.StartPos] = s
	l.StartPos = (l.StartPos + 1) % l.MaxSize
}

func (l *CircleLog) Addf(sfmt string, args ...interface{}) {
	// no lock here, since l.Add() is synchronized
	s := fmt.Sprintf(sfmt, args...)
	l.Add(s)
}

func (l *CircleLog) GetEntries() []string {
	l.Lock.Lock()
	defer l.Lock.Unlock()
	rtn := make([]string, len(l.Log))
	for i := 0; i < len(l.Log); i++ {
		rtn[i] = l.Log[(l.StartPos+i)%l.MaxSize]
	}
	return rtn
}
