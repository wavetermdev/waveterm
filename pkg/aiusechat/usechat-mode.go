// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"os"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

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

func applyProviderDefaults(config *wconfig.AIModeConfigType) {
	if config.Provider == uctypes.AIProvider_Wave {
		config.WaveAICloud = true
		if config.Endpoint == "" {
			config.Endpoint = uctypes.DefaultAIEndpoint
			if os.Getenv(uctypes.WaveAIEndpointEnvName) != "" {
				config.Endpoint = os.Getenv(uctypes.WaveAIEndpointEnvName)
			}
		}
	}
	if config.Provider == uctypes.AIProvider_OpenAI {
		if config.Endpoint == "" {
			config.Endpoint = uctypes.DefaultOpenAIEndpoint
		}
		if config.APIType == "" {
			config.APIType = getOpenAIAPIType(config.Model)
		}
	}
	if config.Provider == uctypes.AIProvider_OpenRouter {
		if config.Endpoint == "" {
			config.Endpoint = uctypes.DefaultOpenRouterEndpoint
		}
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
	}
}

func getOpenAIAPIType(model string) string {
	if isLegacyOpenAIModel(model) {
		return uctypes.APIType_OpenAIChat
	}
	// All newer OpenAI models support openai-responses API:
	// gpt-5*, gpt-4.1*, o1*, o3*, and any future models
	return uctypes.APIType_OpenAIResponses
}

func isLegacyOpenAIModel(model string) bool {
	if model == "" {
		return false
	}
	legacyPrefixes := []string{"gpt-4o", "gpt-3.5", "gpt-oss"}
	for _, prefix := range legacyPrefixes {
		if checkModelPrefix(model, prefix) {
			return true
		}
	}
	return false
}

func checkModelPrefix(model string, prefix string) bool {
	return model == prefix || strings.HasPrefix(model, prefix+"-")
}

func getAIModeConfig(aiMode string) (*wconfig.AIModeConfigType, error) {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	config, ok := fullConfig.WaveAIModes[aiMode]
	if !ok {
		return nil, fmt.Errorf("invalid AI mode: %s", aiMode)
	}

	applyProviderDefaults(&config)
	return &config, nil
}
