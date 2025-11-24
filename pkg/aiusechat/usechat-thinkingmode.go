// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

type ThinkingModeConfig struct {
	Mode          string `json:"mode"`
	DisplayName   string `json:"displayname"`
	APIType       string `json:"apitype"`
	Model         string `json:"model"`
	ThinkingLevel string `json:"thinkinglevel"`
	BaseURL       string `json:"baseurl,omitempty"`
	APIVersion    string `json:"apiversion,omitempty"`
	APIToken      string `json:"apitoken,omitempty"`
	Premium       bool   `json:"premium"`
	Icon          string `json:"icon"`
	Description   string `json:"description"`
}

var thinkingModeConfigs = map[string]ThinkingModeConfig{
	uctypes.ThinkingModeQuick: {
		Mode:          uctypes.ThinkingModeQuick,
		DisplayName:   "Quick",
		APIType:       APIType_OpenAI,
		Model:         uctypes.DefaultOpenAIModel,
		ThinkingLevel: uctypes.ThinkingLevelLow,
		Premium:       false,
		Icon:          "fa-bolt",
		Description:   "Fastest responses (gpt-5-mini)",
	},
	uctypes.ThinkingModeBalanced: {
		Mode:          uctypes.ThinkingModeBalanced,
		DisplayName:   "Balanced",
		APIType:       APIType_OpenAI,
		Model:         uctypes.PremiumOpenAIModel,
		ThinkingLevel: uctypes.ThinkingLevelLow,
		Premium:       true,
		Icon:          "fa-sparkles",
		Description:   "Good mix of speed and accuracy\n(gpt-5.1 with minimal thinking)",
	},
	uctypes.ThinkingModeDeep: {
		Mode:          uctypes.ThinkingModeDeep,
		DisplayName:   "Deep",
		APIType:       APIType_OpenAI,
		Model:         uctypes.PremiumOpenAIModel,
		ThinkingLevel: uctypes.ThinkingLevelMedium,
		Premium:       true,
		Icon:          "fa-lightbulb",
		Description:   "Slower but most capable\n(gpt-5.1 with full reasoning)",
	},
}

func getThinkingModeConfig(thinkingMode string) (*ThinkingModeConfig, error) {
	config, ok := thinkingModeConfigs[thinkingMode]
	if !ok {
		return nil, fmt.Errorf("invalid thinking mode: %s", thinkingMode)
	}

	configCopy := config
	return &configCopy, nil
}