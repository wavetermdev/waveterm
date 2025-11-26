// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"sort"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func getThinkingModeConfigs() map[string]uctypes.AIThinkingModeConfig {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	configs := make(map[string]uctypes.AIThinkingModeConfig)

	for mode, cfg := range fullConfig.WaveAIModes {
		configs[mode] = uctypes.AIThinkingModeConfig{
			Mode:               mode,
			DisplayName:        cfg.DisplayName,
			DisplayOrder:       cfg.DisplayOrder,
			DisplayIcon:        cfg.DisplayIcon,
			APIType:            cfg.APIType,
			Model:              cfg.Model,
			ThinkingLevel:      cfg.ThinkingLevel,
			BaseURL:            cfg.BaseURL,
			WaveAICloud:        cfg.WaveAICloud,
			APIVersion:         cfg.APIVersion,
			APIToken:           cfg.APIToken,
			APITokenSecretName: cfg.APITokenSecretName,
			Premium:            cfg.WaveAIPremium,
			Description:        cfg.DisplayDescription,
			Capabilities:       cfg.Capabilities,
		}
	}

	return configs
}

func resolveThinkingMode(requestedMode string, premium bool) (string, *wconfig.AIThinkingModeConfigType, error) {
	mode := requestedMode
	if mode == "" {
		mode = uctypes.ThinkingModeBalanced
	}

	config, err := getThinkingModeConfig(mode)
	if err != nil {
		return "", nil, err
	}

	if config.WaveAICloud && !premium {
		mode = uctypes.ThinkingModeQuick
		config, err = getThinkingModeConfig(mode)
		if err != nil {
			return "", nil, err
		}
	}

	return mode, config, nil
}

func getThinkingModeConfig(thinkingMode string) (*wconfig.AIThinkingModeConfigType, error) {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	config, ok := fullConfig.WaveAIModes[thinkingMode]
	if !ok {
		return nil, fmt.Errorf("invalid thinking mode: %s", thinkingMode)
	}

	return &config, nil
}

func WaveAIGetModes() ([]uctypes.AIThinkingModeConfig, error) {
	configs := getThinkingModeConfigs()
	modes := make([]uctypes.AIThinkingModeConfig, 0, len(configs))
	for _, config := range configs {
		modes = append(modes, config)
	}
	sort.Slice(modes, func(i, j int) bool {
		return modes[i].DisplayOrder < modes[j].DisplayOrder
	})
	return modes, nil
}
