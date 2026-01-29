// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"log"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

type TabIndicatorStore struct {
	lock          *sync.Mutex
	bellIndicators map[string]bool // tabId -> bell indicator state
}

var globalTabIndicatorStore = &TabIndicatorStore{
	lock:          &sync.Mutex{},
	bellIndicators: make(map[string]bool),
}

func InitTabIndicatorStore() {
	log.Printf("initializing tab indicator store\n")
	rpcClient := wshclient.GetBareRpcClient()
	rpcClient.EventListener.On(wps.Event_TabBellIndicator, handleTabBellIndicatorEvent)
	wshclient.EventSubCommand(rpcClient, wps.SubscriptionRequest{
		Event:     wps.Event_TabBellIndicator,
		AllScopes: true,
	}, nil)
}

type TabBellIndicatorData struct {
	TabId          string `json:"tabid"`
	BellIndicator bool   `json:"bellindicator"`
}

func handleTabBellIndicatorEvent(event *wps.WaveEvent) {
	if event.Event != wps.Event_TabBellIndicator {
		return
	}
	var data TabBellIndicatorData
	err := utilfn.ReUnmarshal(&data, event.Data)
	if err != nil {
		log.Printf("error unmarshaling TabBellIndicatorData: %v\n", err)
		return
	}
	SetTabBellIndicator(data.TabId, data.BellIndicator)
}

func SetTabBellIndicator(tabId string, value bool) {
	globalTabIndicatorStore.lock.Lock()
	defer globalTabIndicatorStore.lock.Unlock()
	if value {
		globalTabIndicatorStore.bellIndicators[tabId] = true
	} else {
		delete(globalTabIndicatorStore.bellIndicators, tabId)
	}
	log.Printf("tab bell indicator set: tabId=%s value=%v\n", tabId, value)
}

func GetTabBellIndicator(tabId string) bool {
	globalTabIndicatorStore.lock.Lock()
	defer globalTabIndicatorStore.lock.Unlock()
	return globalTabIndicatorStore.bellIndicators[tabId]
}

func GetAllTabBellIndicators() map[string]bool {
	globalTabIndicatorStore.lock.Lock()
	defer globalTabIndicatorStore.lock.Unlock()
	result := make(map[string]bool)
	for tabId, value := range globalTabIndicatorStore.bellIndicators {
		result[tabId] = value
	}
	return result
}

func ClearTabBellIndicator(tabId string) {
	SetTabBellIndicator(tabId, false)
}

func ClearAllTabBellIndicators() {
	globalTabIndicatorStore.lock.Lock()
	defer globalTabIndicatorStore.lock.Unlock()
	globalTabIndicatorStore.bellIndicators = make(map[string]bool)
	log.Printf("all tab bell indicators cleared\n")
}
