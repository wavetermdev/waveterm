// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package userinput

import (
	"encoding/json"
	"testing"
	"time"
)

func TestHasActiveAuthPromptForConn(t *testing.T) {
	id, ch := MainUserInputHandler.registerChannel("user@stalehost:22", true)
	defer MainUserInputHandler.unregisterChannel(id)
	_ = ch

	if !HasActiveAuthPromptForConn("user@stalehost:22") {
		t.Fatal("expected active auth prompt for registered conn")
	}
	if HasActiveAuthPromptForConn("user@other:22") {
		t.Fatal("expected no active auth prompt for other conn")
	}
	if HasActiveAuthPromptForConn("") {
		t.Fatal("empty connName must be false")
	}

	MainUserInputHandler.unregisterChannel(id)
	if HasActiveAuthPromptForConn("user@stalehost:22") {
		t.Fatal("expected false after unregister")
	}
}

func TestUserInputRequestPromptType(t *testing.T) {
	t.Parallel()

	t.Run("prompttype omitted when empty", func(t *testing.T) {
		t.Parallel()
		req := &UserInputRequest{
			RequestId:    "test-id",
			QueryText:    "Enter password:",
			ResponseType: "text",
			Title:        "Password Authentication",
		}
		data, err := json.Marshal(req)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}
		var parsed map[string]interface{}
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Fatalf("unmarshal error: %v", err)
		}
		if _, exists := parsed["prompttype"]; exists {
			t.Error("expected prompttype to be omitted when empty")
		}
	})

	t.Run("prompttype included when set", func(t *testing.T) {
		t.Parallel()
		req := &UserInputRequest{
			RequestId:    "test-id",
			QueryText:    "Enter password:",
			ResponseType: "text",
			Title:        "Password Authentication",
			PromptType:   "password",
		}
		data, err := json.Marshal(req)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}
		var parsed map[string]interface{}
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Fatalf("unmarshal error: %v", err)
		}
		pt, exists := parsed["prompttype"]
		if !exists {
			t.Error("expected prompttype to be present")
		}
		if pt != "password" {
			t.Errorf("expected 'password', got %v", pt)
		}
	})

	t.Run("prompttype roundtrip", func(t *testing.T) {
		t.Parallel()
		original := &UserInputRequest{
			RequestId:    "test-id",
			QueryText:    "Question?",
			ResponseType: "confirm",
			Title:        "Confirm",
			PromptType:   "passphrase",
		}
		data, err := json.Marshal(original)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}
		var decoded UserInputRequest
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("unmarshal error: %v", err)
		}
		if decoded.PromptType != "passphrase" {
			t.Errorf("expected 'passphrase', got %q", decoded.PromptType)
		}
	})
}

func TestUserInputRequestConnName(t *testing.T) {
	t.Parallel()

	t.Run("connname omitted when empty", func(t *testing.T) {
		t.Parallel()
		req := &UserInputRequest{
			RequestId:    "test-id",
			QueryText:    "Enter password:",
			ResponseType: "text",
			Title:        "Password Authentication",
		}
		data, err := json.Marshal(req)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}
		var parsed map[string]interface{}
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Fatalf("unmarshal error: %v", err)
		}
		if _, exists := parsed["connname"]; exists {
			t.Error("expected connname to be omitted when empty")
		}
	})

	t.Run("connname included when set", func(t *testing.T) {
		t.Parallel()
		req := &UserInputRequest{
			RequestId:    "test-id",
			QueryText:    "Enter password:",
			ResponseType: "text",
			Title:        "Password Authentication",
			ConnName:     "user@host:22",
		}
		data, err := json.Marshal(req)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}
		var parsed map[string]interface{}
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Fatalf("unmarshal error: %v", err)
		}
		cn, exists := parsed["connname"]
		if !exists {
			t.Error("expected connname to be present")
		}
		if cn != "user@host:22" {
			t.Errorf("expected 'user@host:22', got %v", cn)
		}
	})
}

func TestCancelAllAuthPromptsForConn(t *testing.T) {
	// Clean handler maps for isolation
	MainUserInputHandler.Lock.Lock()
	MainUserInputHandler.Channels = make(map[string]chan *UserInputResponse)
	MainUserInputHandler.AuthRequestConns = make(map[string]string)
	MainUserInputHandler.Lock.Unlock()

	id1, ch1 := MainUserInputHandler.registerChannel("user@host", true)
	id2, ch2 := MainUserInputHandler.registerChannel("user@host", true)
	id3, ch3 := MainUserInputHandler.registerChannel("other@host", true)
	defer MainUserInputHandler.unregisterChannel(id1)
	defer MainUserInputHandler.unregisterChannel(id2)
	defer MainUserInputHandler.unregisterChannel(id3)

	n := CancelAllAuthPromptsForConn("user@host")
	if n != 2 {
		t.Fatalf("expected 2 canceled prompts, got %d", n)
	}

	// Both channels for user@host should have cancel responses
	for i, ch := range []chan *UserInputResponse{ch1, ch2} {
		select {
		case resp := <-ch:
			if resp.ErrorMsg == "" {
				t.Fatalf("channel %d: expected ErrorMsg on cancel", i)
			}
			if resp.ConnName != "user@host" {
				t.Fatalf("channel %d: expected ConnName user@host, got %q", i, resp.ConnName)
			}
		default:
			t.Fatalf("channel %d: expected cancel response", i)
		}
	}
	// other@host should still be waiting
	select {
	case <-ch3:
		t.Fatal("expected other@host prompt to remain open")
	default:
	}
}

func TestPromptWaitDuration(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		timeoutMs int
		want      time.Duration
	}{
		{name: "zero uses 60s default", timeoutMs: 0, want: 60 * time.Second},
		{name: "negative uses 60s default", timeoutMs: -1, want: 60 * time.Second},
		{name: "positive honored", timeoutMs: 120000, want: 120 * time.Second},
		{name: "one millisecond honored", timeoutMs: 1, want: time.Millisecond},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := promptWaitDuration(tt.timeoutMs)
			if got != tt.want {
				t.Errorf("promptWaitDuration(%d) = %s, want %s", tt.timeoutMs, got, tt.want)
			}
		})
	}
}

func TestResponseOnPromptTimeout(t *testing.T) {
	t.Parallel()
	t.Run("default option returns text and no error", func(t *testing.T) {
		t.Parallel()
		resp, err := responseOnPromptTimeout("req-1", "no")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp == nil {
			t.Fatal("expected response")
		}
		if resp.Text != "no" {
			t.Errorf("Text = %q, want %q", resp.Text, "no")
		}
		if resp.RequestId != "req-1" {
			t.Errorf("RequestId = %q, want req-1", resp.RequestId)
		}
		if resp.ErrorMsg != "" {
			t.Errorf("ErrorMsg = %q, want empty", resp.ErrorMsg)
		}
	})
	t.Run("no default is timeout error", func(t *testing.T) {
		t.Parallel()
		resp, err := responseOnPromptTimeout("req-2", "")
		if err == nil {
			t.Fatal("expected timeout error")
		}
		if resp != nil {
			t.Errorf("expected nil response, got %+v", resp)
		}
		if err.Error() != "timed out waiting for user input" {
			t.Errorf("error = %q, want timed out waiting for user input", err.Error())
		}
	})
}
