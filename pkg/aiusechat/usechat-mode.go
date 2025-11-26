// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"sort"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func getAIModeConfigs() map[string]uctypes.AIModeConfig {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	configs := make(map[string]uctypes.AIModeConfig)

	for mode, cfg := range fullConfig.WaveAIModes {
		configs[mode] = uctypes.AIModeConfig{
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

func resolveAIMode(requestedMode string, premium bool) (string, *wconfig.AIModeConfigType, error) {
	mode := requestedMode
	if mode == "" {
		mode = uctypes.AIModeBalanced
	}

	config, err := getAIModeConfig(mode)
	if err != nil {
		return "", nil, err
	}

	if config.WaveAICloud && !premium {
		mode = uctypes.AIModeQuick
		config, err = getAIModeConfig(mode)
		if err != nil {
			return "", nil, err
		}
	}

	return mode, config, nil
}

func getAIModeConfig(aiMode string) (*wconfig.AIModeConfigType, error) {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	config, ok := fullConfig.WaveAIModes[aiMode]
	if !ok {
		return nil, fmt.Errorf("invalid AI mode: %s", aiMode)
	}

	return &config, nil
}

func WaveAIGetModes() ([]uctypes.AIModeConfig, error) {
	configs := getAIModeConfigs()
	modes := make([]uctypes.AIModeConfig, 0, len(configs))
	for _, config := range configs {
		modes = append(modes, config)
	}
	sort.Slice(modes, func(i, j int) bool {
		return modes[i].DisplayOrder < modes[j].DisplayOrder
	})
	return modes, nil
}
