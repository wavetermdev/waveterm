// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"sync"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

type ApprovalRequest struct {
	approval       string
	done           bool
	doneChan       chan struct{}
	mu             sync.Mutex
	onCloseUnregFn func()
}

type ApprovalRegistry struct {
	mu       sync.Mutex
	requests map[string]*ApprovalRequest
}

var globalApprovalRegistry = &ApprovalRegistry{
	requests: make(map[string]*ApprovalRequest),
}

func registerToolApprovalRequest(toolCallId string, req *ApprovalRequest) {
	globalApprovalRegistry.mu.Lock()
	defer globalApprovalRegistry.mu.Unlock()
	globalApprovalRegistry.requests[toolCallId] = req
}

func UnregisterToolApproval(toolCallId string) {
	globalApprovalRegistry.mu.Lock()
	defer globalApprovalRegistry.mu.Unlock()
	req := globalApprovalRegistry.requests[toolCallId]
	delete(globalApprovalRegistry.requests, toolCallId)
	if req != nil && req.onCloseUnregFn != nil {
		req.onCloseUnregFn()
	}
}

func getToolApprovalRequest(toolCallId string) (*ApprovalRequest, bool) {
	globalApprovalRegistry.mu.Lock()
	defer globalApprovalRegistry.mu.Unlock()
	req, exists := globalApprovalRegistry.requests[toolCallId]
	return req, exists
}

func RegisterToolApproval(toolCallId string, sseHandler *sse.SSEHandlerCh) {
	req := &ApprovalRequest{
		doneChan: make(chan struct{}),
	}

	onCloseId := sseHandler.RegisterOnClose(func() {
		UpdateToolApproval(toolCallId, uctypes.ApprovalTimeout)
	})

	req.onCloseUnregFn = func() {
		sseHandler.UnregisterOnClose(onCloseId)
	}

	registerToolApprovalRequest(toolCallId, req)
}

func UpdateToolApproval(toolCallId string, approval string) error {
	req, exists := getToolApprovalRequest(toolCallId)
	if !exists {
		return nil
	}

	req.mu.Lock()
	defer req.mu.Unlock()

	if req.done {
		return nil
	}

	req.approval = approval
	req.done = true

	if req.onCloseUnregFn != nil {
		req.onCloseUnregFn()
	}

	close(req.doneChan)
	return nil
}

func WaitForToolApproval(toolCallId string) string {
	req, exists := getToolApprovalRequest(toolCallId)
	if !exists {
		return ""
	}

	<-req.doneChan

	req.mu.Lock()
	approval := req.approval
	req.mu.Unlock()

	globalApprovalRegistry.mu.Lock()
	delete(globalApprovalRegistry.requests, toolCallId)
	globalApprovalRegistry.mu.Unlock()

	return approval
}
