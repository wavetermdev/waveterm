package utilds

import (
	"sync"
	"time"
)

type VersionTs struct {
	lock        sync.Mutex
	lastVersion int64
}

func (v *VersionTs) GetVersionTs() int64 {
	v.lock.Lock()
	defer v.lock.Unlock()

	nowMs := time.Now().UnixMilli()
	if nowMs <= v.lastVersion {
		v.lastVersion++
		return v.lastVersion
	}
	v.lastVersion = nowMs
	return v.lastVersion
}
