// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// wave pubsub system
package wps

import (
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// this broker interface is mostly generic
// strong typing and event types can be defined elsewhere

const MaxPersist = 4096

type Client interface {
	SendEvent(routeId string, event WaveEvent)
}

type BrokerSubscription struct {
	AllSubs   []string            // routeids subscribed to "all" events
	ScopeSubs map[string][]string // routeids subscribed to specific scopes
	StarSubs  map[string][]string // routeids subscribed to star scope (scopes with "*" or "**" in them)
}

type persistKey struct {
	Event string
	Scope string
}

type persistEventWrap struct {
	Events []*WaveEvent
}

type BrokerType struct {
	Lock       *sync.Mutex
	Client     Client
	SubMap     map[string]*BrokerSubscription
	PersistMap map[persistKey]*persistEventWrap
}

var Broker = &BrokerType{
	Lock:       &sync.Mutex{},
	SubMap:     make(map[string]*BrokerSubscription),
	PersistMap: make(map[persistKey]*persistEventWrap),
}

func scopeHasStarMatch(scope string) bool {
	parts := strings.Split(scope, ":")
	for _, part := range parts {
		if part == "*" || part == "**" {
			return true
		}
	}
	return false
}

func (b *BrokerType) SetClient(client Client) {
	b.Lock.Lock()
	defer b.Lock.Unlock()
	b.Client = client
}

func (b *BrokerType) GetClient() Client {
	b.Lock.Lock()
	defer b.Lock.Unlock()
	return b.Client
}

// if already subscribed, this will *resubscribe* with the new subscription (remove the old one, and replace with this one)
func (b *BrokerType) Subscribe(subRouteId string, sub SubscriptionRequest) {
	// log.Printf("[wps] sub %s %s\n", subRouteId, sub.Event)
	if sub.Event == "" {
		return
	}
	b.Lock.Lock()
	defer b.Lock.Unlock()
	b.unsubscribe_nolock(subRouteId, sub.Event)
	bs := b.SubMap[sub.Event]
	if bs == nil {
		bs = &BrokerSubscription{
			AllSubs:   []string{},
			ScopeSubs: make(map[string][]string),
			StarSubs:  make(map[string][]string),
		}
		b.SubMap[sub.Event] = bs
	}
	if sub.AllScopes {
		bs.AllSubs = utilfn.AddElemToSliceUniq(bs.AllSubs, subRouteId)
		return
	}
	for _, scope := range sub.Scopes {
		starMatch := scopeHasStarMatch(scope)
		if starMatch {
			addStrToScopeMap(bs.StarSubs, scope, subRouteId)
		} else {
			addStrToScopeMap(bs.ScopeSubs, scope, subRouteId)
		}
	}
}

func (bs *BrokerSubscription) IsEmpty() bool {
	return len(bs.AllSubs) == 0 && len(bs.ScopeSubs) == 0 && len(bs.StarSubs) == 0
}

func removeStrFromScopeMap(scopeMap map[string][]string, scope string, routeId string) {
	scopeSubs := scopeMap[scope]
	scopeSubs = utilfn.RemoveElemFromSlice(scopeSubs, routeId)
	if len(scopeSubs) == 0 {
		delete(scopeMap, scope)
	} else {
		scopeMap[scope] = scopeSubs
	}
}

func removeStrFromScopeMapAll(scopeMap map[string][]string, routeId string) {
	for scope, scopeSubs := range scopeMap {
		scopeSubs = utilfn.RemoveElemFromSlice(scopeSubs, routeId)
		if len(scopeSubs) == 0 {
			delete(scopeMap, scope)
		} else {
			scopeMap[scope] = scopeSubs
		}
	}
}

func addStrToScopeMap(scopeMap map[string][]string, scope string, routeId string) {
	scopeSubs := scopeMap[scope]
	scopeSubs = utilfn.AddElemToSliceUniq(scopeSubs, routeId)
	scopeMap[scope] = scopeSubs
}

func (b *BrokerType) Unsubscribe(subRouteId string, eventName string) {
	// log.Printf("[wps] unsub %s %s\n", subRouteId, eventName)
	b.Lock.Lock()
	defer b.Lock.Unlock()
	b.unsubscribe_nolock(subRouteId, eventName)
}

func (b *BrokerType) unsubscribe_nolock(subRouteId string, eventName string) {
	bs := b.SubMap[eventName]
	if bs == nil {
		return
	}
	bs.AllSubs = utilfn.RemoveElemFromSlice(bs.AllSubs, subRouteId)
	for scope := range bs.ScopeSubs {
		removeStrFromScopeMap(bs.ScopeSubs, scope, subRouteId)
	}
	for scope := range bs.StarSubs {
		removeStrFromScopeMap(bs.StarSubs, scope, subRouteId)
	}
	if bs.IsEmpty() {
		delete(b.SubMap, eventName)
	}
}

func (b *BrokerType) UnsubscribeAll(subRouteId string) {
	b.Lock.Lock()
	defer b.Lock.Unlock()
	for eventType, bs := range b.SubMap {
		bs.AllSubs = utilfn.RemoveElemFromSlice(bs.AllSubs, subRouteId)
		removeStrFromScopeMapAll(bs.StarSubs, subRouteId)
		removeStrFromScopeMapAll(bs.ScopeSubs, subRouteId)
		if bs.IsEmpty() {
			delete(b.SubMap, eventType)
		}
	}
}

// does not take wildcards, use "" for all
func (b *BrokerType) ReadEventHistory(eventType string, scope string, maxItems int) []*WaveEvent {
	if maxItems <= 0 {
		return nil
	}
	b.Lock.Lock()
	defer b.Lock.Unlock()
	key := persistKey{Event: eventType, Scope: scope}
	pe := b.PersistMap[key]
	if pe == nil || len(pe.Events) == 0 {
		return nil
	}
	if maxItems > len(pe.Events) {
		maxItems = len(pe.Events)
	}
	// return new arr
	rtn := make([]*WaveEvent, maxItems)
	copy(rtn, pe.Events[len(pe.Events)-maxItems:])
	return rtn
}

func (b *BrokerType) persistEvent(event WaveEvent) {
	if event.Persist <= 0 {
		return
	}
	numPersist := event.Persist
	if numPersist > MaxPersist {
		numPersist = MaxPersist
	}
	scopeMap := make(map[string]bool)
	for _, scope := range event.Scopes {
		scopeMap[scope] = true
	}
	scopeMap[""] = true
	b.Lock.Lock()
	defer b.Lock.Unlock()
	for scope := range scopeMap {
		key := persistKey{Event: event.Event, Scope: scope}
		pe := b.PersistMap[key]
		if pe == nil {
			pe = &persistEventWrap{
				Events: make([]*WaveEvent, 0, numPersist),
			}
			b.PersistMap[key] = pe
		}
		pe.Events = append(pe.Events, &event)
		if len(pe.Events) > numPersist {
			pe.Events = pe.Events[len(pe.Events)-numPersist:]
		}
	}
}

func (b *BrokerType) Publish(event WaveEvent) {
	// log.Printf("BrokerType.Publish: %v\n", event)
	if event.Persist > 0 {
		b.persistEvent(event)
	}
	client := b.GetClient()
	if client == nil {
		return
	}
	routeIds := b.getMatchingRouteIds(event)
	for _, routeId := range routeIds {
		client.SendEvent(routeId, event)
	}
}

func (b *BrokerType) SendUpdateEvents(updates waveobj.UpdatesRtnType) {
	for _, update := range updates {
		b.Publish(WaveEvent{
			Event:  Event_WaveObjUpdate,
			Scopes: []string{waveobj.MakeORef(update.OType, update.OID).String()},
			Data:   update,
		})
	}
}

func (b *BrokerType) getMatchingRouteIds(event WaveEvent) []string {
	b.Lock.Lock()
	defer b.Lock.Unlock()
	bs := b.SubMap[event.Event]
	if bs == nil {
		return nil
	}
	routeIds := make(map[string]bool)
	for _, routeId := range bs.AllSubs {
		routeIds[routeId] = true
	}
	for _, scope := range event.Scopes {
		for _, routeId := range bs.ScopeSubs[scope] {
			routeIds[routeId] = true
		}
		for starScope := range bs.StarSubs {
			if utilfn.StarMatchString(starScope, scope, ":") {
				for _, routeId := range bs.StarSubs[starScope] {
					routeIds[routeId] = true
				}
			}
		}
	}
	var rtn []string
	for routeId := range routeIds {
		rtn = append(rtn, routeId)
	}
	// log.Printf("getMatchingRouteIds %v %v\n", event, rtn)
	return rtn
}
