// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilds

import (
	"testing"
	"time"
)

func collectItems[T any](ch <-chan T, count int, timeout time.Duration) []T {
	result := make([]T, 0, count)
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for i := 0; i < count; i++ {
		select {
		case item := <-ch:
			result = append(result, item)
		case <-timer.C:
			return result
		}
	}
	return result
}

func TestQuickReorderQueue_InOrder(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 100*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "item1")
	q.QueueItem("session1", 2, "item2")
	q.QueueItem("session1", 3, "item3")

	items := collectItems(q.C(), 3, 500*time.Millisecond)

	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}
	if items[0] != "item1" || items[1] != "item2" || items[2] != "item3" {
		t.Errorf("expected [item1, item2, item3], got %v", items)
	}
}

func TestQuickReorderQueue_OutOfOrder(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 200*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "item1")
	q.QueueItem("session1", 3, "item3")
	q.QueueItem("session1", 2, "item2")

	items := collectItems(q.C(), 3, 500*time.Millisecond)

	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}
	if items[0] != "item1" || items[1] != "item2" || items[2] != "item3" {
		t.Errorf("expected [item1, item2, item3], got %v", items)
	}
}

func TestQuickReorderQueue_MultipleOutOfOrder(t *testing.T) {
	q := MakeQuickReorderQueue[int](10, 200*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, 1)
	q.QueueItem("session1", 5, 5)
	q.QueueItem("session1", 3, 3)
	q.QueueItem("session1", 2, 2)
	q.QueueItem("session1", 4, 4)

	items := collectItems(q.C(), 5, 500*time.Millisecond)

	if len(items) != 5 {
		t.Fatalf("expected 5 items, got %d", len(items))
	}
	for i := 0; i < 5; i++ {
		if items[i] != i+1 {
			t.Errorf("expected item %d at position %d, got %d", i+1, i, items[i])
		}
	}
}

func TestQuickReorderQueue_TwoSessions_StrongSeparation(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 200*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "s1-1")
	q.QueueItem("session1", 2, "s1-2")
	q.QueueItem("session1", 3, "s1-3")

	time.Sleep(500 * time.Millisecond)

	q.QueueItem("session2", 1, "s2-1")
	q.QueueItem("session2", 2, "s2-2")

	items := collectItems(q.C(), 5, 500*time.Millisecond)

	if len(items) != 5 {
		t.Fatalf("expected 5 items, got %d", len(items))
	}

	expected := []string{"s1-1", "s1-2", "s1-3", "s2-1", "s2-2"}
	for i, exp := range expected {
		if items[i] != exp {
			t.Errorf("expected %s at position %d, got %s", exp, i, items[i])
		}
	}
}

func TestQuickReorderQueue_TwoSessions_OutOfOrder(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 200*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "s1-1")
	q.QueueItem("session1", 3, "s1-3")

	time.Sleep(500 * time.Millisecond)

	q.QueueItem("session2", 1, "s2-1")
	q.QueueItem("session1", 2, "s1-2")
	q.QueueItem("session2", 3, "s2-3")
	q.QueueItem("session2", 2, "s2-2")

	items := collectItems(q.C(), 6, 500*time.Millisecond)

	if len(items) != 6 {
		t.Fatalf("expected 6 items, got %d", len(items))
	}

	expected := []string{"s1-1", "s1-3", "s2-1", "s1-2", "s2-2", "s2-3"}
	for i, exp := range expected {
		if items[i] != exp {
			t.Errorf("expected %s at position %d, got %s", exp, i, items[i])
		}
	}
}

func TestQuickReorderQueue_ThreeSessions_Sequential(t *testing.T) {
	q := MakeQuickReorderQueue[string](20, 200*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "s1-1")
	q.QueueItem("session1", 2, "s1-2")

	time.Sleep(500 * time.Millisecond)

	q.QueueItem("session2", 1, "s2-1")
	q.QueueItem("session2", 2, "s2-2")

	time.Sleep(500 * time.Millisecond)

	q.QueueItem("session3", 1, "s3-1")
	q.QueueItem("session3", 2, "s3-2")

	items := collectItems(q.C(), 6, 1*time.Second)

	if len(items) != 6 {
		t.Fatalf("expected 6 items, got %d", len(items))
	}

	expected := []string{"s1-1", "s1-2", "s2-1", "s2-2", "s3-1", "s3-2"}
	for i, exp := range expected {
		if items[i] != exp {
			t.Errorf("expected %s at position %d, got %s", exp, i, items[i])
		}
	}
}

func TestQuickReorderQueue_SimpleTimeout(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 50*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "item1")
	q.QueueItem("session1", 3, "item3")

	time.Sleep(100 * time.Millisecond)

	items := collectItems(q.C(), 2, 100*time.Millisecond)

	if len(items) != 2 {
		t.Fatalf("expected 2 items after timeout, got %d", len(items))
	}
	if items[0] != "item1" {
		t.Errorf("expected item1 first, got %s", items[0])
	}
	if items[1] != "item3" {
		t.Errorf("expected item3 second (due to timeout), got %s", items[1])
	}

	q.QueueItem("session1", 5, "item5")
	q.QueueItem("session1", 4, "item4")

	time.Sleep(100 * time.Millisecond)

	items2 := collectItems(q.C(), 2, 100*time.Millisecond)

	if len(items2) != 2 {
		t.Fatalf("expected 2 more items after second timeout, got %d", len(items2))
	}
	if items2[0] != "item4" || items2[1] != "item5" {
		t.Errorf("expected [item4, item5] after reordering, got %v", items2)
	}
}

func TestQuickReorderQueue_RollingTimeout(t *testing.T) {
	q := MakeQuickReorderQueue[string](20, 50*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "item1")
	time.Sleep(10 * time.Millisecond)

	q.QueueItem("session1", 5, "item5")
	time.Sleep(10 * time.Millisecond)

	q.QueueItem("session1", 3, "item3")
	time.Sleep(10 * time.Millisecond)

	q.QueueItem("session1", 2, "item2")
	time.Sleep(10 * time.Millisecond)

	q.QueueItem("session1", 4, "item4")
	time.Sleep(10 * time.Millisecond)

	q.QueueItem("session1", 7, "item7")
	time.Sleep(10 * time.Millisecond)

	q.QueueItem("session1", 6, "item6")

	time.Sleep(100 * time.Millisecond)

	items := collectItems(q.C(), 7, 200*time.Millisecond)

	if len(items) != 7 {
		t.Fatalf("expected 7 items, got %d: %v", len(items), items)
	}

	expected := []string{"item1", "item2", "item3", "item4", "item5", "item6", "item7"}
	for i, exp := range expected {
		if items[i] != exp {
			t.Errorf("expected %s at position %d, got %s. Full output: %v", exp, i, items[i], items)
		}
	}
}

func TestQuickReorderQueue_Timeout(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 150*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "item1")
	q.QueueItem("session1", 3, "item3")

	time.Sleep(200 * time.Millisecond)

	items := collectItems(q.C(), 2, 100*time.Millisecond)

	if len(items) != 2 {
		t.Fatalf("expected 2 items after timeout, got %d", len(items))
	}
	if items[0] != "item1" {
		t.Errorf("expected item1 first, got %s", items[0])
	}
	if items[1] != "item3" {
		t.Errorf("expected item3 second (due to timeout), got %s", items[1])
	}
}

func TestQuickReorderQueue_TimeoutWithLateArrival(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 100*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "item1")
	q.QueueItem("session1", 3, "item3")

	time.Sleep(150 * time.Millisecond)

	items := collectItems(q.C(), 2, 100*time.Millisecond)

	if len(items) != 2 {
		t.Fatalf("expected 2 items after timeout, got %d", len(items))
	}

	q.QueueItem("session1", 2, "item2")

	lateItem := collectItems(q.C(), 1, 100*time.Millisecond)
	if len(lateItem) != 1 {
		t.Fatalf("expected 1 late item, got %d", len(lateItem))
	}
	if lateItem[0] != "item2" {
		t.Errorf("expected item2, got %s", lateItem[0])
	}
}

func TestQuickReorderQueue_SessionOverlap_SmallWindow(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 200*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "s1-1")
	q.QueueItem("session1", 2, "s1-2")
	q.QueueItem("session1", 3, "s1-3")

	time.Sleep(500 * time.Millisecond)

	q.QueueItem("session2", 1, "s2-1")

	time.Sleep(50 * time.Millisecond)

	q.QueueItem("session1", 4, "s1-4")
	q.QueueItem("session2", 2, "s2-2")

	items := collectItems(q.C(), 6, 500*time.Millisecond)

	if len(items) != 6 {
		t.Fatalf("expected 6 items, got %d", len(items))
	}

	expected := []string{"s1-1", "s1-2", "s1-3", "s2-1", "s1-4", "s2-2"}
	for i, exp := range expected {
		if items[i] != exp {
			t.Errorf("expected %s at position %d, got %s", exp, i, items[i])
		}
	}
}

func TestQuickReorderQueue_DuplicateSequence(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 200*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "item1-first")
	q.QueueItem("session1", 2, "item2")
	q.QueueItem("session1", 1, "item1-duplicate")

	items := collectItems(q.C(), 3, 500*time.Millisecond)

	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}
	if items[0] != "item1-first" || items[1] != "item2" || items[2] != "item1-duplicate" {
		t.Errorf("got %v", items)
	}
}

func TestQuickReorderQueue_SetNextSeqNum(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 200*time.Millisecond)
	defer q.Close()

	q.SetNextSeqNum(5)

	q.QueueItem("session1", 5, "item5")
	q.QueueItem("session1", 6, "item6")
	q.QueueItem("session1", 7, "item7")

	items := collectItems(q.C(), 3, 500*time.Millisecond)

	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}
	if items[0] != "item5" || items[1] != "item6" || items[2] != "item7" {
		t.Errorf("expected [item5, item6, item7], got %v", items)
	}
}

func TestQuickReorderQueue_EmptyBuffer(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 200*time.Millisecond)
	defer q.Close()

	select {
	case <-q.C():
		t.Error("should not have any items")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestQuickReorderQueue_Close(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 200*time.Millisecond)

	q.QueueItem("session1", 1, "item1")

	q.Close()

	_, ok := <-q.C()
	if !ok {
		t.Error("expected to read item1 before close")
	}

	_, ok = <-q.C()
	if ok {
		t.Error("channel should be closed")
	}
}

func TestQuickReorderQueue_CloseWithBufferedItems(t *testing.T) {
	q := MakeQuickReorderQueue[string](10, 200*time.Millisecond)

	q.QueueItem("session1", 1, "item1")
	q.QueueItem("session1", 3, "item3")

	q.Close()

	item, ok := <-q.C()
	if !ok || item != "item1" {
		t.Errorf("expected item1, got %s (ok=%v)", item, ok)
	}

	_, ok = <-q.C()
	if ok {
		t.Error("channel should be closed, item3 should be dropped as buffered")
	}
}

func TestQuickReorderQueue_MultiSessionComplexReordering(t *testing.T) {
	q := MakeQuickReorderQueue[string](20, 300*time.Millisecond)
	defer q.Close()

	q.QueueItem("session1", 1, "s1-1")
	q.QueueItem("session1", 4, "s1-4")
	q.QueueItem("session1", 2, "s1-2")

	time.Sleep(500 * time.Millisecond)

	q.QueueItem("session2", 2, "s2-2")
	q.QueueItem("session2", 1, "s2-1")
	q.QueueItem("session1", 3, "s1-3")

	time.Sleep(500 * time.Millisecond)

	q.QueueItem("session3", 1, "s3-1")
	q.QueueItem("session2", 3, "s2-3")

	items := collectItems(q.C(), 8, 1*time.Second)

	if len(items) != 8 {
		t.Fatalf("expected 8 items, got %d", len(items))
	}

	expected := []string{"s1-1", "s1-2", "s1-4", "s2-1", "s2-2", "s1-3", "s3-1", "s2-3"}
	for i, exp := range expected {
		if items[i] != exp {
			t.Errorf("expected %s at position %d, got %s", exp, i, items[i])
		}
	}
}
