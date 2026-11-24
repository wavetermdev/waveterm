// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package uctypes

import "testing"

func TestAreModelsCompatible(t *testing.T) {
	tests := []struct {
		name    string
		apiType string
		model1  string
		model2  string
		want    bool
	}{
		{"premium to default fallback", APIType_OpenAIResponses, PremiumOpenAIModel, DefaultOpenAIModel, true},
		{"default to premium", APIType_OpenAIResponses, DefaultOpenAIModel, PremiumOpenAIModel, true},
		{"previous default chat continues with new default", APIType_OpenAIResponses, "gpt-5-mini", DefaultOpenAIModel, true},
		{"new default chat continues with previous default", APIType_OpenAIResponses, DefaultOpenAIModel, "gpt-5-mini", true},
		{"quick and balanced modes still share a chat", APIType_OpenAIResponses, "gpt-5-mini", PremiumOpenAIModel, true},
		{"gpt-5 family member", APIType_OpenAIResponses, "gpt-5.2", DefaultOpenAIModel, true},
		{"same model", APIType_OpenAIResponses, DefaultOpenAIModel, DefaultOpenAIModel, true},
		{"same model on any api type", APIType_AnthropicMessages, DefaultAnthropicModel, DefaultAnthropicModel, true},
		{"default and unrelated model", APIType_OpenAIResponses, DefaultOpenAIModel, "gpt-4o", false},
		{"premium and unrelated model", APIType_OpenAIResponses, PremiumOpenAIModel, DefaultAnthropicModel, false},
		{"default and empty model", APIType_OpenAIResponses, DefaultOpenAIModel, "", false},
		{"openai-chat api does not share models", APIType_OpenAIChat, PremiumOpenAIModel, DefaultOpenAIModel, false},
		{"anthropic api does not share models", APIType_AnthropicMessages, DefaultAnthropicModel, DefaultOpenAIModel, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := AreModelsCompatible(tt.apiType, tt.model1, tt.model2); got != tt.want {
				t.Errorf("AreModelsCompatible(%q, %q, %q) = %v, want %v", tt.apiType, tt.model1, tt.model2, got, tt.want)
			}
		})
	}
}
