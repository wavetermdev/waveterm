// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// wave pubsub system
package wps

import (
	"strings"
	"sync"

	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
)

// this broker interface is mostly generic
// strong typing and event types can be defined elsewhere

type Client interface {
	ClientId() string
	SendEvent(event wshrpc.WaveEvent)
}

type BrokerSubscription struct {
	AllSubs   []string            // clientids of client subscribed to "all" events
	ScopeSubs map[string][]string // clientids of client subscribed to specific scopes
	StarSubs  map[string][]string // clientids of client subscribed to star scope (scopes with "*" or "**" in them)
}

type BrokerType struct {
	Lock      *sync.Mutex
	ClientMap map[string]Client
	SubMap    map[string]*BrokerSubscription
}

var Broker = &BrokerType{
	Lock:      &sync.Mutex{},
	ClientMap: make(map[string]Client),
	SubMap:    make(map[string]*BrokerSubscription),
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

func (b *BrokerType) Subscribe(subscriber Client, sub wshrpc.SubscriptionRequest) {
	b.Lock.Lock()
	defer b.Lock.Unlock()
	clientId := subscriber.ClientId()
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
		bs.AllSubs = utilfn.AddElemToSliceUniq(bs.AllSubs, clientId)
	}
	for _, scope := range sub.Scopes {
		starMatch := scopeHasStarMatch(scope)
		if starMatch {
			addStrToScopeMap(bs.StarSubs, scope, clientId)
		} else {
			addStrToScopeMap(bs.ScopeSubs, scope, clientId)
		}
	}
}

func (bs *BrokerSubscription) IsEmpty() bool {
	return len(bs.AllSubs) == 0 && len(bs.ScopeSubs) == 0 && len(bs.StarSubs) == 0
}

func removeStrFromScopeMap(scopeMap map[string][]string, scope string, clientId string) {
	scopeSubs := scopeMap[scope]
	scopeSubs = utilfn.RemoveElemFromSlice(scopeSubs, clientId)
	if len(scopeSubs) == 0 {
		delete(scopeMap, scope)
	} else {
		scopeMap[scope] = scopeSubs
	}
}

func removeStrFromScopeMapAll(scopeMap map[string][]string, clientId string) {
	for scope, scopeSubs := range scopeMap {
		scopeSubs = utilfn.RemoveElemFromSlice(scopeSubs, clientId)
		if len(scopeSubs) == 0 {
			delete(scopeMap, scope)
		} else {
			scopeMap[scope] = scopeSubs
		}
	}
}

func addStrToScopeMap(scopeMap map[string][]string, scope string, clientId string) {
	scopeSubs := scopeMap[scope]
	scopeSubs = utilfn.AddElemToSliceUniq(scopeSubs, clientId)
	scopeMap[scope] = scopeSubs
}

func (b *BrokerType) Unsubscribe(subscriber Client, sub wshrpc.SubscriptionRequest) {
	b.Lock.Lock()
	defer b.Lock.Unlock()
	clientId := subscriber.ClientId()
	bs := b.SubMap[sub.Event]
	if bs == nil {
		return
	}
	if sub.AllScopes {
		bs.AllSubs = utilfn.RemoveElemFromSlice(bs.AllSubs, clientId)
	}
	for _, scope := range sub.Scopes {
		starMatch := scopeHasStarMatch(scope)
		if starMatch {
			removeStrFromScopeMap(bs.StarSubs, scope, clientId)
		} else {
			removeStrFromScopeMap(bs.ScopeSubs, scope, clientId)
		}
	}
	if bs.IsEmpty() {
		delete(b.SubMap, sub.Event)
	}
}

func (b *BrokerType) UnsubscribeAll(subscriber Client) {
	b.Lock.Lock()
	defer b.Lock.Unlock()
	clientId := subscriber.ClientId()
	delete(b.ClientMap, clientId)
	for eventType, bs := range b.SubMap {
		bs.AllSubs = utilfn.RemoveElemFromSlice(bs.AllSubs, clientId)
		removeStrFromScopeMapAll(bs.StarSubs, clientId)
		removeStrFromScopeMapAll(bs.ScopeSubs, clientId)
		if bs.IsEmpty() {
			delete(b.SubMap, eventType)
		}
	}
}

func (b *BrokerType) Publish(event wshrpc.WaveEvent) {
	clientIds := b.getMatchingClientIds(event)
	for _, clientId := range clientIds {
		client := b.ClientMap[clientId]
		if client != nil {
			client.SendEvent(event)
		}
	}
}

func (b *BrokerType) getMatchingClientIds(event wshrpc.WaveEvent) []string {
	b.Lock.Lock()
	defer b.Lock.Unlock()
	bs := b.SubMap[event.Event]
	if bs == nil {
		return nil
	}
	clientIds := make(map[string]bool)
	for _, clientId := range bs.AllSubs {
		clientIds[clientId] = true
	}
	for _, scope := range event.Scopes {
		for _, clientId := range bs.ScopeSubs[scope] {
			clientIds[clientId] = true
		}
		for starScope := range bs.StarSubs {
			if utilfn.StarMatchString(starScope, scope, ":") {
				for _, clientId := range bs.StarSubs[starScope] {
					clientIds[clientId] = true
				}
			}
		}
	}
	var rtn []string
	for clientId := range clientIds {
		rtn = append(rtn, clientId)
	}
	return rtn
}
