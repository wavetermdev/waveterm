// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"log"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

type TabIndicatorStore struct {
	lock       *sync.Mutex
	indicators map[string]*wshrpc.TabIndicator
}

var globalTabIndicatorStore = &TabIndicatorStore{
	lock:       &sync.Mutex{},
	indicators: make(map[string]*wshrpc.TabIndicator),
}

func InitTabIndicatorStore() {
	log.Printf("initializing tab indicator store\n")
	rpcClient := wshclient.GetBareRpcClient()
	rpcClient.EventListener.On(wps.Event_TabIndicator, handleTabIndicatorEvent)
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_TabIndicator,
		AllScopes: true,
	}, nil)
}

func handleTabIndicatorEvent(event *wps.WaveEvent) {
	if event.Event != wps.Event_TabIndicator {
		return
	}
	var data wshrpc.TabIndicatorEventData
	err := utilfn.ReUnmarshal(&data, event.Data)
	if err != nil {
		log.Printf("error unmarshaling TabIndicatorEventData: %v\n", err)
		return
	}
	setTabIndicator(data.TabId, data.Indicator)
}

func setTabIndicator(tabId string, indicator *wshrpc.TabIndicator) {
	globalTabIndicatorStore.lock.Lock()
	defer globalTabIndicatorStore.lock.Unlock()
	if indicator == nil {
		delete(globalTabIndicatorStore.indicators, tabId)
		log.Printf("tab indicator cleared: tabId=%s\n", tabId)
		return
	}
	currentIndicator := globalTabIndicatorStore.indicators[tabId]
	if currentIndicator == nil {
		globalTabIndicatorStore.indicators[tabId] = indicator
		log.Printf("tab indicator set: tabId=%s indicator=%v\n", tabId, indicator)
		return
	}
	if indicator.Priority >= currentIndicator.Priority {
		if indicator.ClearOnFocus && !currentIndicator.ClearOnFocus {
			indicator.PersistentIndicator = currentIndicator
		}
		globalTabIndicatorStore.indicators[tabId] = indicator
		log.Printf("tab indicator updated: tabId=%s indicator=%v\n", tabId, indicator)
	} else {
		log.Printf("tab indicator not updated (lower priority): tabId=%s currentPriority=%v newPriority=%v\n", tabId, currentIndicator.Priority, indicator.Priority)
	}
}

func GetTabIndicator(tabId string) *wshrpc.TabIndicator {
	globalTabIndicatorStore.lock.Lock()
	defer globalTabIndicatorStore.lock.Unlock()
	return globalTabIndicatorStore.indicators[tabId]
}

func GetAllTabIndicators() map[string]*wshrpc.TabIndicator {
	globalTabIndicatorStore.lock.Lock()
	defer globalTabIndicatorStore.lock.Unlock()
	result := make(map[string]*wshrpc.TabIndicator)
	for tabId, indicator := range globalTabIndicatorStore.indicators {
		result[tabId] = indicator
	}
	return result
}
