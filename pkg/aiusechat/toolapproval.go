// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

const (
	InitialApprovalTimeout = 2 * time.Minute
	KeepAliveExtension     = 1 * time.Minute
)

type ApprovalRequest struct {
	ToolUseData  *uctypes.UIMessageDataToolUse
	ResponseChan chan string
	timer        *time.Timer
	mu           sync.Mutex
}

type ApprovalRegistry struct {
	mu       sync.RWMutex
	requests map[string]*ApprovalRequest
}

var globalApprovalRegistry = &ApprovalRegistry{
	requests: make(map[string]*ApprovalRequest),
}

func RegisterToolApproval(toolUseData *uctypes.UIMessageDataToolUse) chan string {
	req := &ApprovalRequest{
		ToolUseData:  toolUseData,
		ResponseChan: make(chan string, 1),
	}

	req.timer = time.AfterFunc(InitialApprovalTimeout, func() {
		req.mu.Lock()
		defer req.mu.Unlock()
		select {
		case req.ResponseChan <- uctypes.ApprovalTimeout:
		default:
		}
		UnregisterToolApproval(toolUseData.ToolCallId)
	})

	globalApprovalRegistry.mu.Lock()
	globalApprovalRegistry.requests[toolUseData.ToolCallId] = req
	globalApprovalRegistry.mu.Unlock()

	return req.ResponseChan
}

func UpdateToolApproval(toolCallId string, approval string, keepAlive bool) error {
	globalApprovalRegistry.mu.RLock()
	req, exists := globalApprovalRegistry.requests[toolCallId]
	globalApprovalRegistry.mu.RUnlock()

	if !exists {
		return nil
	}

	req.mu.Lock()
	defer req.mu.Unlock()

	if keepAlive && approval == "" {
		req.timer.Reset(KeepAliveExtension)
		return nil
	}

	req.timer.Stop()

	select {
	case req.ResponseChan <- approval:
	default:
	}

	UnregisterToolApproval(toolCallId)
	return nil
}

func UnregisterToolApproval(toolCallId string) {
	globalApprovalRegistry.mu.Lock()
	defer globalApprovalRegistry.mu.Unlock()

	if req, exists := globalApprovalRegistry.requests[toolCallId]; exists {
		req.mu.Lock()
		if req.timer != nil {
			req.timer.Stop()
		}
		close(req.ResponseChan)
		req.mu.Unlock()
		delete(globalApprovalRegistry.requests, toolCallId)
	}
}