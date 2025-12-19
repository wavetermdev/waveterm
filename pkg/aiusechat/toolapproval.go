// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
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

func (req *ApprovalRequest) updateApproval(approval string) {
	req.mu.Lock()
	defer req.mu.Unlock()

	if req.done {
		return
	}

	req.approval = approval
	req.done = true

	if req.onCloseUnregFn != nil {
		req.onCloseUnregFn()
	}

	close(req.doneChan)
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
	if req != nil {
		req.updateApproval("")
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

	req.updateApproval(approval)
	return nil
}

func WaitForToolApproval(ctx context.Context, toolCallId string) (string, error) {
	req, exists := getToolApprovalRequest(toolCallId)
	if !exists {
		return "", nil
	}

	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-req.doneChan:
	}

	req.mu.Lock()
	approval := req.approval
	req.mu.Unlock()

	globalApprovalRegistry.mu.Lock()
	delete(globalApprovalRegistry.requests, toolCallId)
	globalApprovalRegistry.mu.Unlock()

	return approval, nil
}
