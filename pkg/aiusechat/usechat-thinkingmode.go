// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

var thinkingModeConfigs = map[string]uctypes.AIThinkingModeConfig{
	uctypes.ThinkingModeQuick: {
		Mode:          uctypes.ThinkingModeQuick,
		DisplayName:   "Quick",
		APIType:       APIType_OpenAI,
		Model:         uctypes.DefaultOpenAIModel,
		ThinkingLevel: uctypes.ThinkingLevelLow,
		WaveAICloud:   true,
		Premium:       false,
		Icon:          "bolt",
		Description:   "Fastest responses (gpt-5-mini)",
		Capabilities:  []string{uctypes.AICapabilityTools, uctypes.AICapabilityImages, uctypes.AICapabilityPdfs},
	},
	uctypes.ThinkingModeBalanced: {
		Mode:          uctypes.ThinkingModeBalanced,
		DisplayName:   "Balanced",
		APIType:       APIType_OpenAI,
		Model:         uctypes.PremiumOpenAIModel,
		ThinkingLevel: uctypes.ThinkingLevelLow,
		WaveAICloud:   true,
		Premium:       true,
		Icon:          "sparkles",
		Description:   "Good mix of speed and accuracy\n(gpt-5.1 with minimal thinking)",
		Capabilities:  []string{uctypes.AICapabilityTools, uctypes.AICapabilityImages, uctypes.AICapabilityPdfs},
	},
	uctypes.ThinkingModeDeep: {
		Mode:          uctypes.ThinkingModeDeep,
		DisplayName:   "Deep",
		APIType:       APIType_OpenAI,
		Model:         uctypes.PremiumOpenAIModel,
		ThinkingLevel: uctypes.ThinkingLevelMedium,
		WaveAICloud:   true,
		Premium:       true,
		Icon:          "lightbulb",
		Description:   "Slower but most capable\n(gpt-5.1 with full reasoning)",
		Capabilities:  []string{uctypes.AICapabilityTools, uctypes.AICapabilityImages, uctypes.AICapabilityPdfs},
	},
	"openrouter:mistral": {
		Mode:               "openrouter:mistral",
		DisplayName:        "Mistral (OpenRouter)",
		APIType:            APIType_OpenAIComp,
		BaseURL:            "https://openrouter.ai/api/v1/chat/completions",
		Model:              "mistralai/mistral-small-3.2-24b-instruct",
		ThinkingLevel:      uctypes.ThinkingLevelLow,
		APITokenSecretName: "OPENROUTER_KEY",
		Premium:            false,
		Icon:               "bolt",
		Description:        "Fast and capable via OpenRouter\n(Mistral Small 3.2)",
		Capabilities:       []string{uctypes.AICapabilityTools},
	},
}

func getThinkingModeConfig(thinkingMode string) (*uctypes.AIThinkingModeConfig, error) {
	config, ok := thinkingModeConfigs[thinkingMode]
	if !ok {
		return nil, fmt.Errorf("invalid thinking mode: %s", thinkingMode)
	}

	configCopy := config
	return &configCopy, nil
}

func WaveAIGetModes() ([]uctypes.AIThinkingModeConfig, error) {
	modes := make([]uctypes.AIThinkingModeConfig, 0, len(thinkingModeConfigs))
	for _, config := range thinkingModeConfigs {
		modes = append(modes, config)
	}
	return modes, nil
}
