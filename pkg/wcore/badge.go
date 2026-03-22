// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"log"
	"sync"

	"github.com/woveterm/wove/pkg/baseds"
	"github.com/woveterm/wove/pkg/util/utilfn"
	"github.com/woveterm/wove/pkg/waveobj"
	"github.com/woveterm/wove/pkg/wps"
	"github.com/woveterm/wove/pkg/wshrpc/wshclient"
)

// BadgeStore is an in-memory store for transient badges.
// Badges are not persisted and are cleared on restart.
// Values are stored by value (not pointer) to prevent external mutation.
type BadgeStore struct {
	lock      *sync.Mutex
	transient map[string]baseds.Badge // keyed by oref string
}

var globalBadgeStore = &BadgeStore{
	lock:      &sync.Mutex{},
	transient: make(map[string]baseds.Badge),
}

// InitBadgeStore subscribes to incoming badge events.
func InitBadgeStore() error {
	log.Printf("initializing badge store\n")

	rpcClient := wshclient.GetBareRpcClient()
	rpcClient.EventListener.On(wps.Event_Badge, handleBadgeEvent)
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_Badge,
		AllScopes: true,
	}, nil)

	return nil
}

func handleBadgeEvent(event *wps.WaveEvent) {
	if event.Event != wps.Event_Badge {
		return
	}
	var data baseds.BadgeEvent
	err := utilfn.ReUnmarshal(&data, event.Data)
	if err != nil {
		log.Printf("badge store: error unmarshaling BadgeEvent: %v\n", err)
		return
	}
	if data.ClearAll {
		clearAllBadges()
		return
	}
	if data.ORef == "" {
		log.Printf("badge store: received badge event with empty oref\n")
		return
	}
	oref, err := waveobj.ParseORef(data.ORef)
	if err != nil {
		log.Printf("badge store: error parsing oref %q: %v\n", data.ORef, err)
		return
	}
	if oref.OType != waveobj.OType_Block && oref.OType != waveobj.OType_Tab {
		log.Printf("badge store: can only handle block/tab orefs")
		return
	}

	setBadge(oref, data)
}

// cmpBadge compares two badges by priority then by badgeid (both descending).
// Returns 1 if a > b, -1 if a < b, 0 if equal.
func cmpBadge(a, b baseds.Badge) int {
	if a.Priority != b.Priority {
		if a.Priority > b.Priority {
			return 1
		}
		return -1
	}
	if a.BadgeId != b.BadgeId {
		if a.BadgeId > b.BadgeId {
			return 1
		}
		return -1
	}
	return 0
}

// setBadge updates the in-memory transient map.
func setBadge(oref waveobj.ORef, data baseds.BadgeEvent) {
	globalBadgeStore.lock.Lock()
	defer globalBadgeStore.lock.Unlock()

	orefStr := oref.String()
	if orefStr == "" {
		return
	}

	if data.ClearById != "" {
		existing, ok := globalBadgeStore.transient[orefStr]
		if !ok || existing.BadgeId != data.ClearById {
			return
		}
		delete(globalBadgeStore.transient, orefStr)
		log.Printf("badge store: badge cleared by id: oref=%s id=%s\n", orefStr, data.ClearById)
		return
	}
	if data.Clear {
		delete(globalBadgeStore.transient, orefStr)
		log.Printf("badge store: badge cleared: oref=%s\n", orefStr)
		return
	}
	if data.Badge == nil {
		return
	}
	incoming := *data.Badge
	existing, hasExisting := globalBadgeStore.transient[orefStr]
	if !hasExisting || cmpBadge(incoming, existing) > 0 {
		globalBadgeStore.transient[orefStr] = incoming
		log.Printf("badge store: badge set: oref=%s badge=%+v\n", orefStr, incoming)
	}
}

// clearAllBadges removes all badges from the transient store.
func clearAllBadges() {
	globalBadgeStore.lock.Lock()
	defer globalBadgeStore.lock.Unlock()

	count := len(globalBadgeStore.transient)
	globalBadgeStore.transient = make(map[string]baseds.Badge)
	log.Printf("badge store: cleared all %d badges\n", count)
}

// GetAllBadges returns a snapshot of all currently active badges.
func GetAllBadges() []baseds.BadgeEvent {
	globalBadgeStore.lock.Lock()
	defer globalBadgeStore.lock.Unlock()

	result := make([]baseds.BadgeEvent, 0, len(globalBadgeStore.transient))
	for orefStr, badge := range globalBadgeStore.transient {
		b := badge // copy
		result = append(result, baseds.BadgeEvent{
			ORef:  orefStr,
			Badge: &b,
		})
	}
	return result
}
