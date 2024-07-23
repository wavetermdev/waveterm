// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// wave pubsub system
package wps

import (
	"sync"

	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
)

// this broker interface is mostly generic
// strong typing and event types can be defined elsewhere

type WaveEvent struct {
	Event  string   `json:"event"`
	Scopes []string `json:"scopes,omitempty"`
	Sender string   `json:"sender,omitempty"`
	Data   any      `json:"data,omitempty"`
}

type SubscriptionRequest struct {
	Event     string   `json:"event"`
	Scopes    []string `json:"scopes,omitempty"`
	AllScopes bool     `json:"allscopes,omitempty"`
}

type Client interface {
	ClientId() string
	SendEvent(event WaveEvent)
}

type BrokerSubscription struct {
	AllSubs   []string            // clientids of client subscribed to "all" events
	ScopeSubs map[string][]string // clientids of client subscribed to specific scopes
}

type Broker struct {
	Lock      *sync.Mutex
	ClientMap map[string]Client
	SubMap    map[string]*BrokerSubscription
}

func (b *Broker) Subscribe(subscriber Client, sub SubscriptionRequest) {
	b.Lock.Lock()
	defer b.Lock.Unlock()
	clientId := subscriber.ClientId()
	bs := b.SubMap[sub.Event]
	if bs == nil {
		bs = &BrokerSubscription{
			AllSubs:   []string{},
			ScopeSubs: make(map[string][]string),
		}
		b.SubMap[sub.Event] = bs
	}
	if sub.AllScopes {
		bs.AllSubs = utilfn.AddElemToSliceUniq(bs.AllSubs, clientId)
	}
	for _, scope := range sub.Scopes {
		scopeSubs := bs.ScopeSubs[scope]
		scopeSubs = utilfn.AddElemToSliceUniq(scopeSubs, clientId)
		bs.ScopeSubs[scope] = scopeSubs
	}
}

func (bs *BrokerSubscription) IsEmpty() bool {
	return len(bs.AllSubs) == 0 && len(bs.ScopeSubs) == 0
}

func (b *Broker) Unsubscribe(subscriber Client, sub SubscriptionRequest) {
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
		scopeSubs := bs.ScopeSubs[scope]
		scopeSubs = utilfn.RemoveElemFromSlice(scopeSubs, clientId)
		if len(scopeSubs) == 0 {
			delete(bs.ScopeSubs, scope)
		} else {
			bs.ScopeSubs[scope] = scopeSubs
		}
	}
	if bs.IsEmpty() {
		delete(b.SubMap, sub.Event)
	}
}

func (b *Broker) UnsubscribeAll(subscriber Client) {
	b.Lock.Lock()
	defer b.Lock.Unlock()
	clientId := subscriber.ClientId()
	delete(b.ClientMap, clientId)
	for eventType, bs := range b.SubMap {
		bs.AllSubs = utilfn.RemoveElemFromSlice(bs.AllSubs, clientId)
		for scope, scopeSubs := range bs.ScopeSubs {
			scopeSubs = utilfn.RemoveElemFromSlice(scopeSubs, clientId)
			if len(scopeSubs) == 0 {
				delete(bs.ScopeSubs, scope)
			} else {
				bs.ScopeSubs[scope] = scopeSubs
			}
		}
		if bs.IsEmpty() {
			delete(b.SubMap, eventType)
		}
	}
}

func (b *Broker) Publish(subscriber Client, event WaveEvent) {
	clientIds := b.getMatchingClientIds(event)
	for _, clientId := range clientIds {
		client := b.ClientMap[clientId]
		if client != nil {
			client.SendEvent(event)
		}
	}
}

func (b *Broker) getMatchingClientIds(event WaveEvent) []string {
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
	}
	var rtn []string
	for clientId := range clientIds {
		rtn = append(rtn, clientId)
	}
	return rtn
}
