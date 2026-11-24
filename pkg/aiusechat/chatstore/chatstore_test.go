// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatstore

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

type testMessage struct {
	id   string
	role string
}

func (m *testMessage) GetMessageId() string       { return m.id }
func (m *testMessage) GetUsage() *uctypes.AIUsage { return nil }
func (m *testMessage) GetRole() string            { return m.role }

func makeTestOpts(model string) *uctypes.AIOptsType {
	return &uctypes.AIOptsType{
		APIType: uctypes.APIType_OpenAIResponses,
		Model:   model,
	}
}

func TestPostMessageContinuesChatWithDefaultModel(t *testing.T) {
	tests := []struct {
		name        string
		chatModel   string
		postedModel string
	}{
		{"premium chat continues with default", uctypes.PremiumOpenAIModel, uctypes.DefaultOpenAIModel},
		{"previous default chat continues with default", "gpt-5-mini", uctypes.DefaultOpenAIModel},
		{"default chat continues with premium", uctypes.DefaultOpenAIModel, uctypes.PremiumOpenAIModel},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cs := &ChatStore{chats: make(map[string]*uctypes.AIChat)}
			if err := cs.PostMessage("chat1", makeTestOpts(tt.chatModel), &testMessage{id: "m1", role: "user"}); err != nil {
				t.Fatalf("first PostMessage failed: %v", err)
			}
			if err := cs.PostMessage("chat1", makeTestOpts(tt.postedModel), &testMessage{id: "m2", role: "user"}); err != nil {
				t.Fatalf("PostMessage with model %q on a %q chat failed: %v", tt.postedModel, tt.chatModel, err)
			}
			chat := cs.Get("chat1")
			if chat == nil || len(chat.NativeMessages) != 2 {
				t.Fatalf("expected 2 messages in chat, got %+v", chat)
			}
		})
	}
}

func TestPostMessageRejectsUnrelatedModel(t *testing.T) {
	cs := &ChatStore{chats: make(map[string]*uctypes.AIChat)}
	if err := cs.PostMessage("chat1", makeTestOpts(uctypes.DefaultOpenAIModel), &testMessage{id: "m1", role: "user"}); err != nil {
		t.Fatalf("first PostMessage failed: %v", err)
	}
	err := cs.PostMessage("chat1", makeTestOpts("gpt-4o"), &testMessage{id: "m2", role: "user"})
	if err == nil || !strings.Contains(err.Error(), "model mismatch") {
		t.Fatalf("expected a model mismatch error, got %v", err)
	}
}
