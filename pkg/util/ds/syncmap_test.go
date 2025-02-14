package ds

import (
	"testing"
)

func TestSyncMap_Set(t *testing.T) {
	sm := MakeSyncMap[int]()
	sm.Set("key1", 1)
	if sm.Get("key1") != 1 {
		t.Errorf("expected 1, got %d", sm.Get("key1"))
	}
}

func TestSyncMap_Get(t *testing.T) {
	sm := MakeSyncMap[int]()
	sm.Set("key1", 1)
	if sm.Get("key1") != 1 {
		t.Errorf("expected 1, got %d", sm.Get("key1"))
	}
	if sm.Get("key2") != 0 {
		t.Errorf("expected 0, got %d", sm.Get("key2"))
	}
}

func TestSyncMap_GetEx(t *testing.T) {
	sm := MakeSyncMap[int]()
	sm.Set("key1", 1)
	value, ok := sm.GetEx("key1")
	if !ok || value != 1 {
		t.Errorf("expected 1, got %d", value)
	}
	value, ok = sm.GetEx("key2")
	if ok || value != 0 {
		t.Errorf("expected 0, got %d", value)
	}
}

func TestSyncMap_Delete(t *testing.T) {
	sm := MakeSyncMap[int]()
	sm.Set("key1", 1)
	sm.Delete("key1")
	if sm.Get("key1") != 0 {
		t.Errorf("expected 0, got %d", sm.Get("key1"))
	}
}
