// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

const (
	InitialApprovalTimeout = 10 * time.Second
	KeepAliveExtension     = 10 * time.Second
)

type ApprovalRequest struct {
	approval string
	done     bool
	doneChan chan struct{}
	timer    *time.Timer
	mu       sync.Mutex
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

func getToolApprovalRequest(toolCallId string) (*ApprovalRequest, bool) {
	globalApprovalRegistry.mu.Lock()
	defer globalApprovalRegistry.mu.Unlock()
	req, exists := globalApprovalRegistry.requests[toolCallId]
	return req, exists
}

func RegisterToolApproval(toolCallId string) {
	req := &ApprovalRequest{
		doneChan: make(chan struct{}),
	}

	req.timer = time.AfterFunc(InitialApprovalTimeout, func() {
		UpdateToolApproval(toolCallId, uctypes.ApprovalTimeout, false)
	})

	registerToolApprovalRequest(toolCallId, req)
}

func UpdateToolApproval(toolCallId string, approval string, keepAlive bool) error {
	req, exists := getToolApprovalRequest(toolCallId)
	if !exists {
		return nil
	}

	req.mu.Lock()
	defer req.mu.Unlock()

	if req.done {
		return nil
	}

	if keepAlive && approval == "" {
		req.timer.Reset(KeepAliveExtension)
		return nil
	}

	req.approval = approval
	req.done = true

	if req.timer != nil {
		req.timer.Stop()
	}

	close(req.doneChan)
	return nil
}
func CurrentToolApprovalStatus(toolCallId string) string {
	req, exists := getToolApprovalRequest(toolCallId)
	if !exists {
		return ""
	}

	req.mu.Lock()
	defer req.mu.Unlock()
	return req.approval
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
