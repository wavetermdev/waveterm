// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"os"
	"regexp"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
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
	if config.Provider == uctypes.AIProvider_AzureLegacy {
		if config.APIVersion == "" {
			config.APIVersion = "2025-04-01-preview"
		}
		if config.Endpoint == "" && isValidAzureResourceName(config.AzureResourceName) && config.AzureDeployment != "" {
			config.Endpoint = fmt.Sprintf("https://%s.openai.azure.com/openai/deployments/%s/chat/completions?api-version=%s",
				config.AzureResourceName, config.AzureDeployment, config.APIVersion)
		}
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
	}
	if config.Provider == uctypes.AIProvider_Azure {
		if config.APIVersion == "" {
			config.APIVersion = "v1" // purely informational for now
		}
		if config.APIType == "" {
			config.APIType = getAzureAPIType(config.Model)
		}
		if config.Endpoint == "" && isValidAzureResourceName(config.AzureResourceName) && isAzureAPIType(config.APIType) {
			base := fmt.Sprintf("https://%s.openai.azure.com/openai/v1", config.AzureResourceName)
			switch config.APIType {
			case uctypes.APIType_OpenAIResponses:
				config.Endpoint = base + "/responses"
			case uctypes.APIType_OpenAIChat:
				config.Endpoint = base + "/chat/completions"
			}
		}
	}
}

func isAzureAPIType(apiType string) bool {
	return apiType == uctypes.APIType_OpenAIChat || apiType == uctypes.APIType_OpenAIResponses
}

func getOpenAIAPIType(model string) string {
	if isLegacyOpenAIModel(model) {
		return uctypes.APIType_OpenAIChat
	}
	// All newer OpenAI models support openai-responses API:
	// gpt-5*, gpt-4.1*, o1*, o3*, and any future models
	return uctypes.APIType_OpenAIResponses
}

func getAzureAPIType(model string) string {
	if isNewOpenAIModel(model) {
		return uctypes.APIType_OpenAIResponses
	}
	return uctypes.APIType_OpenAIChat
}

func isNewOpenAIModel(model string) bool {
	if model == "" {
		return false
	}
	newPrefixes := []string{"gpt-6", "gpt-5", "gpt-4.1", "gpt-6", "o1", "o3"}
	for _, prefix := range newPrefixes {
		if aiutil.CheckModelPrefix(model, prefix) {
			return true
		}
	}
	if aiutil.CheckModelSubPrefix(model, "gpt-5.") || aiutil.CheckModelSubPrefix(model, "gpt-6.") {
		return true
	}
	return false
}

func isLegacyOpenAIModel(model string) bool {
	if model == "" {
		return false
	}
	legacyPrefixes := []string{"gpt-4o", "gpt-3.5", "gpt-oss"}
	for _, prefix := range legacyPrefixes {
		if aiutil.CheckModelPrefix(model, prefix) {
			return true
		}
	}
	return false
}

func isValidAzureResourceName(name string) bool {
	if name == "" || len(name) > 63 {
		return false
	}
	matched, _ := regexp.MatchString(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, name)
	return matched
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
