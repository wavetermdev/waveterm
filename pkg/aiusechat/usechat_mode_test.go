// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"encoding/json"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestDefaultQuickModeUsesReplacementModel(t *testing.T) {
	defaults, errs := wconfig.ReadDefaultsConfigFile("waveai.json")
	if len(errs) > 0 {
		t.Fatalf("failed to read shipped modes: %v", errs)
	}
	data, err := json.Marshal(defaults)
	if err != nil {
		t.Fatal(err)
	}
	var modes map[string]wconfig.AIModeConfigType
	if err := json.Unmarshal(data, &modes); err != nil {
		t.Fatal(err)
	}
	quick := modes[uctypes.AIModeQuick]
	applyProviderDefaults(&quick)
	if quick.Model != uctypes.DefaultOpenAIModel || quick.APIType != uctypes.APIType_OpenAIResponses {
		t.Fatalf("Quick mode must use %s through Responses, got %+v", uctypes.DefaultOpenAIModel, quick)
	}
	if quick.ThinkingLevel != uctypes.ThinkingLevelLow || !quick.WaveAICloud {
		t.Errorf("Quick mode must retain low reasoning on the cloud proxy, got %+v", quick)
	}
}

func TestApplyProviderDefaultsGroq(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_Groq,
	}
	applyProviderDefaults(&config)
	if config.APIType != uctypes.APIType_OpenAIChat {
		t.Fatalf("expected API type %q, got %q", uctypes.APIType_OpenAIChat, config.APIType)
	}
	if config.Endpoint != GroqChatEndpoint {
		t.Fatalf("expected endpoint %q, got %q", GroqChatEndpoint, config.Endpoint)
	}
	if config.APITokenSecretName != GroqAPITokenSecretName {
		t.Fatalf("expected API token secret name %q, got %q", GroqAPITokenSecretName, config.APITokenSecretName)
	}
}

func TestApplyProviderDefaultsKeepsProxyURL(t *testing.T) {
	config := wconfig.AIModeConfigType{
		Provider: uctypes.AIProvider_OpenAI,
		Model:    "gpt-5-mini",
		ProxyURL: "http://localhost:8080",
	}
	applyProviderDefaults(&config)
	if config.ProxyURL != "http://localhost:8080" {
		t.Fatalf("expected proxy URL to be preserved, got %q", config.ProxyURL)
	}
}
