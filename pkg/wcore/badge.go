// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// BadgeStore is a write-through cache for badges.
// Each oref can carry two independent badges:
//   - a persistent badge (stored in the DB and survives restarts)
//   - a transient badge (in-memory only, cleared on restart)
//
// Values are stored by value (not pointer) to prevent external mutation.
type BadgeStore struct {
	lock       *sync.Mutex
	persistent map[string]baseds.Badge // keyed by oref string
	transient  map[string]baseds.Badge // keyed by oref string
}

var globalBadgeStore = &BadgeStore{
	lock:       &sync.Mutex{},
	persistent: make(map[string]baseds.Badge),
	transient:  make(map[string]baseds.Badge),
}

// InitBadgeStore loads all persisted badges from the DB into the in-memory
// cache and subscribes to incoming badge events.
func InitBadgeStore() error {
	log.Printf("initializing badge store\n")

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()

	// Load persisted badges from all tabs.
	tabs, err := wstore.DBGetAllObjsByType[*waveobj.Tab](ctx, waveobj.OType_Tab)
	if err != nil {
		return fmt.Errorf("badge store: error loading tabs from DB: %w", err)
	}
	for _, tab := range tabs {
		if tab.Badge != nil {
			oref := waveobj.MakeORef(waveobj.OType_Tab, tab.OID).String()
			globalBadgeStore.persistent[oref] = *tab.Badge
		}
	}

	// Load persisted badges from all blocks.
	blocks, err := wstore.DBGetAllObjsByType[*waveobj.Block](ctx, waveobj.OType_Block)
	if err != nil {
		return fmt.Errorf("badge store: error loading blocks from DB: %w", err)
	}
	for _, block := range blocks {
		if block.Badge != nil {
			oref := waveobj.MakeORef(waveobj.OType_Block, block.OID).String()
			globalBadgeStore.persistent[oref] = *block.Badge
		}
	}

	log.Printf("badge store: loaded %d persisted badges\n", len(globalBadgeStore.persistent))

	// Subscribe to badge events so we can update the cache when events arrive.
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
	if data.ORef == "" {
		log.Printf("badge store: received badge event with empty oref\n")
		return
	}

	oref, err := waveobj.ParseORef(data.ORef)
	if err != nil {
		log.Printf("badge store: error parsing oref %q: %v\n", data.ORef, err)
		return
	}

	setBadge(oref, data.Badge, data.Persistent, data.Clear)
}

// setBadge updates the appropriate in-memory map and, when persistent, writes
// through to the DB and fires a WaveObjUpdate event so the frontend stays in sync.
func setBadge(oref waveobj.ORef, badge *baseds.Badge, persistent bool, clear bool) {
	globalBadgeStore.lock.Lock()
	defer globalBadgeStore.lock.Unlock()

	orefStr := oref.String()

	if persistent {
		if clear || badge == nil {
			delete(globalBadgeStore.persistent, orefStr)
			log.Printf("badge store: persistent badge cleared: oref=%s\n", orefStr)
			go persistBadge(oref, nil)
		} else {
			globalBadgeStore.persistent[orefStr] = *badge
			log.Printf("badge store: persistent badge set: oref=%s badge=%+v\n", orefStr, *badge)
			go persistBadge(oref, badge)
		}
	} else {
		if clear || badge == nil {
			delete(globalBadgeStore.transient, orefStr)
			log.Printf("badge store: transient badge cleared: oref=%s\n", orefStr)
		} else {
			globalBadgeStore.transient[orefStr] = *badge
			log.Printf("badge store: transient badge set: oref=%s badge=%+v\n", orefStr, *badge)
		}
	}
}

// persistBadge writes the badge (or nil to clear) to the appropriate DB object.
func persistBadge(oref waveobj.ORef, badge *baseds.Badge) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()

	switch oref.OType {
	case waveobj.OType_Tab:
		err := wstore.DBUpdateFn[*waveobj.Tab](ctx, oref.OID, func(tab *waveobj.Tab) {
			tab.Badge = badge
		})
		if err != nil {
			log.Printf("badge store: error persisting badge for tab %s: %v\n", oref.OID, err)
			return
		}
		log.Printf("badge store: persisted badge for tab %s\n", oref.OID)
		SendWaveObjUpdate(oref)

	case waveobj.OType_Block:
		err := wstore.DBUpdateFn[*waveobj.Block](ctx, oref.OID, func(block *waveobj.Block) {
			block.Badge = badge
		})
		if err != nil {
			log.Printf("badge store: error persisting badge for block %s: %v\n", oref.OID, err)
			return
		}
		log.Printf("badge store: persisted badge for block %s\n", oref.OID)
		SendWaveObjUpdate(oref)

	default:
		log.Printf("badge store: unsupported oref type for persistence: %s\n", oref.OType)
	}
}

// GetAllBadges returns a snapshot of all currently active badges as a slice of
// BadgeEvent values.  Each entry carries the ORef, the Persistent flag, and the
// Badge itself.  An oref that has both a persistent and a transient badge will
// appear twice in the result.
func GetAllBadges() []baseds.BadgeEvent {
	globalBadgeStore.lock.Lock()
	defer globalBadgeStore.lock.Unlock()

	result := make([]baseds.BadgeEvent, 0, len(globalBadgeStore.persistent)+len(globalBadgeStore.transient))
	for orefStr, badge := range globalBadgeStore.persistent {
		b := badge // copy
		result = append(result, baseds.BadgeEvent{
			ORef:       orefStr,
			Persistent: true,
			Badge:      &b,
		})
	}
	for orefStr, badge := range globalBadgeStore.transient {
		b := badge // copy
		result = append(result, baseds.BadgeEvent{
			ORef:  orefStr,
			Badge: &b,
		})
	}
	return result
}
