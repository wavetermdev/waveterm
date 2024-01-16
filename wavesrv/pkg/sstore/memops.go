// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// in-memory storage for waveterm server
package sstore

import (
	"fmt"
	"log"
	"sync"

	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/utilfn"
)

// global lock for all memory operations
// memory ops are very fast, so this is not a bottleneck
var MemLock *sync.Mutex = &sync.Mutex{}
var ScreenMemStore map[string]*ScreenMemState = make(map[string]*ScreenMemState) // map of screenid -> ScreenMemState

type StatusIndicatorLevel int

const (
	StatusIndicatorLevel_None StatusIndicatorLevel = iota
	StatusIndicatorLevel_Output
	StatusIndicatorLevel_Success
	StatusIndicatorLevel_Error
)

func dumpScreenMemStore() {
	MemLock.Lock()
	defer MemLock.Unlock()
	for k, v := range ScreenMemStore {
		log.Printf("  ScreenMemStore[%s] = %+v\n", k, v)
	}
}

type OpenAICmdInfoChatStore struct {
	MessageCount int                                `json:"messagecount"`
	Messages     []*packet.OpenAICmdInfoChatMessage `json:"messages"`
}

type ScreenMemState struct {
	NumRunningCommands int                     `json:"numrunningcommands,omitempty"`
	IndicatorType      StatusIndicatorLevel    `json:"indicatortype,omitempty"`
	CmdInputText       utilfn.StrWithPos       `json:"cmdinputtext,omitempty"`
	CmdInputSeqNum     int                     `json:"cmdinputseqnum,omitempty"`
	AICmdInfoChat      *OpenAICmdInfoChatStore `json:"aicmdinfochat,omitempty"`
}

func ScreenMemDeepCopyCmdInfoChatStore(store *OpenAICmdInfoChatStore) *OpenAICmdInfoChatStore {
	rtnMessages := []*packet.OpenAICmdInfoChatMessage{}
	for index := 0; index < len(store.Messages); index++ {
		messageToCopy := *store.Messages[index]
		if messageToCopy.AssistantResponse != nil {
			assistantResponseCopy := *messageToCopy.AssistantResponse
			messageToCopy.AssistantResponse = &assistantResponseCopy
		}
		rtnMessages = append(rtnMessages, &messageToCopy)
	}
	rtn := &OpenAICmdInfoChatStore{MessageCount: store.MessageCount, Messages: rtnMessages}
	return rtn
}

func ScreenMemInitCmdInfoChat(screenId string) {
	greetingMessagePk := &packet.OpenAICmdInfoChatMessage{
		MessageID:           0,
		IsAssistantResponse: true,
		AssistantResponse: &packet.OpenAICmdInfoPacketOutputType{
			Message: packet.OpenAICmdInfoChatGreetingMessage,
		},
	}
	ScreenMemStore[screenId].AICmdInfoChat = &OpenAICmdInfoChatStore{MessageCount: 1, Messages: []*packet.OpenAICmdInfoChatMessage{greetingMessagePk}}
}

func ScreenMemClearCmdInfoChat(screenId string) {
	MemLock.Lock()
	defer MemLock.Unlock()
	if ScreenMemStore[screenId] == nil {
		ScreenMemStore[screenId] = &ScreenMemState{}
	}
	ScreenMemInitCmdInfoChat(screenId)
}

func ScreenMemAddCmdInfoChatMessage(screenId string, msg *packet.OpenAICmdInfoChatMessage) {
	MemLock.Lock()
	defer MemLock.Unlock()
	if ScreenMemStore[screenId] == nil {
		ScreenMemStore[screenId] = &ScreenMemState{}
	}
	if ScreenMemStore[screenId].AICmdInfoChat == nil {
		log.Printf("AICmdInfoChat is null, creating")
		ScreenMemInitCmdInfoChat(screenId)
	}

	CmdInfoChat := ScreenMemStore[screenId].AICmdInfoChat
	CmdInfoChat.Messages = append(CmdInfoChat.Messages, msg)
	CmdInfoChat.MessageCount++
}

func ScreenMemGetCmdInfoMessageCount(screenId string) int {
	MemLock.Lock()
	defer MemLock.Unlock()
	if ScreenMemStore[screenId] == nil {
		ScreenMemStore[screenId] = &ScreenMemState{}
	}
	if ScreenMemStore[screenId].AICmdInfoChat == nil {
		ScreenMemInitCmdInfoChat(screenId)
	}
	return ScreenMemStore[screenId].AICmdInfoChat.MessageCount
}

func ScreenMemGetCmdInfoChat(screenId string) *OpenAICmdInfoChatStore {
	MemLock.Lock()
	defer MemLock.Unlock()
	if ScreenMemStore[screenId] == nil {
		ScreenMemStore[screenId] = &ScreenMemState{}
	}
	if ScreenMemStore[screenId].AICmdInfoChat == nil {
		ScreenMemInitCmdInfoChat(screenId)
	}
	return ScreenMemDeepCopyCmdInfoChatStore(ScreenMemStore[screenId].AICmdInfoChat)
}

func ScreenMemUpdateCmdInfoChatMessage(screenId string, messageID int, msg *packet.OpenAICmdInfoChatMessage) error {
	MemLock.Lock()
	defer MemLock.Unlock()
	if ScreenMemStore[screenId] == nil {
		ScreenMemStore[screenId] = &ScreenMemState{}
	}
	if ScreenMemStore[screenId].AICmdInfoChat == nil {
		ScreenMemInitCmdInfoChat(screenId)
	}
	CmdInfoChat := ScreenMemStore[screenId].AICmdInfoChat
	if messageID >= 0 && messageID < len(CmdInfoChat.Messages) {
		CmdInfoChat.Messages[messageID] = msg
	} else {
		return fmt.Errorf("ScreenMemUpdateCmdInfoChatMessage: error: Message Id out of range: %d", messageID)
	}
	return nil
}

func ScreenMemSetCmdInputText(screenId string, sp utilfn.StrWithPos, seqNum int) {
	MemLock.Lock()
	defer MemLock.Unlock()
	if ScreenMemStore[screenId] == nil {
		ScreenMemStore[screenId] = &ScreenMemState{}
	}
	if seqNum <= ScreenMemStore[screenId].CmdInputSeqNum {
		return
	}
	ScreenMemStore[screenId].CmdInputText = sp
	ScreenMemStore[screenId].CmdInputSeqNum = seqNum
}

func ScreenMemSetNumRunningCommands(screenId string, num int) {
	MemLock.Lock()
	defer MemLock.Unlock()
	if ScreenMemStore[screenId] == nil {
		ScreenMemStore[screenId] = &ScreenMemState{}
	}
	ScreenMemStore[screenId].NumRunningCommands = num
}

// If the new indicator level is higher than the current indicator, update the current indicator. Returns true if the indicator was updated.
func ScreenMemCombineIndicatorLevels(screenId string, level StatusIndicatorLevel) bool {
	MemLock.Lock()
	defer MemLock.Unlock()
	if ScreenMemStore[screenId] == nil {
		ScreenMemStore[screenId] = &ScreenMemState{}
	}
	if level > ScreenMemStore[screenId].IndicatorType {
		ScreenMemStore[screenId].IndicatorType = level
		return true
	} else {
		return false
	}
}

// Set the indicator to the given level, regardless of the current indicator level.
func ScreenMemSetIndicatorLevel(screenId string, level StatusIndicatorLevel) {
	MemLock.Lock()
	defer MemLock.Unlock()
	if ScreenMemStore[screenId] == nil {
		ScreenMemStore[screenId] = &ScreenMemState{}
	}
	ScreenMemStore[screenId].IndicatorType = StatusIndicatorLevel_None
}

// safe because we return a copy
func GetScreenMemState(screenId string) *ScreenMemState {
	MemLock.Lock()
	defer MemLock.Unlock()
	ptr := ScreenMemStore[screenId]
	if ptr == nil {
		return nil
	}
	rtn := *ptr
	return &rtn
}
