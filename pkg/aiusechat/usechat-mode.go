// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"log"
	"os"
	"regexp"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

var AzureResourceNameRegex = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

const (
	OpenAIResponsesEndpoint        = "https://api.openai.com/v1/responses"
	OpenAIChatEndpoint             = "https://api.openai.com/v1/chat/completions"
	OpenRouterChatEndpoint         = "https://openrouter.ai/api/v1/chat/completions"
	AzureLegacyEndpointTemplate    = "https://%s.openai.azure.com/openai/deployments/%s/chat/completions?api-version=%s"
	AzureResponsesEndpointTemplate = "https://%s.openai.azure.com/openai/v1/responses"
	AzureChatEndpointTemplate      = "https://%s.openai.azure.com/openai/v1/chat/completions"
	GoogleGeminiEndpointTemplate   = "https://generativelanguage.googleapis.com/v1beta/models/%s:streamGenerateContent"

	AzureLegacyDefaultAPIVersion = "2025-04-01-preview"

	OpenAIAPITokenSecretName      = "OPENAI_KEY"
	OpenRouterAPITokenSecretName  = "OPENROUTER_KEY"
	AzureOpenAIAPITokenSecretName = "AZURE_OPENAI_KEY"
	GoogleAIAPITokenSecretName    = "GOOGLE_AI_KEY"
)

func resolveAIMode(requestedMode string, premium bool) (string, *wconfig.AIModeConfigType, error) {
	mode := requestedMode
	if mode == "" {
		fullConfig := wconfig.GetWatcher().GetFullConfig()
		mode = fullConfig.Settings.WaveAiDefaultMode
		if mode == "" {
			mode = uctypes.AIModeBalanced
		}
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
		if config.APIType == "" {
			config.APIType = getOpenAIAPIType(config.Model)
		}
		if config.Endpoint == "" {
			switch config.APIType {
			case uctypes.APIType_OpenAIResponses:
				config.Endpoint = OpenAIResponsesEndpoint
			case uctypes.APIType_OpenAIChat:
				config.Endpoint = OpenAIChatEndpoint
			default:
				config.Endpoint = OpenAIChatEndpoint
			}
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = OpenAIAPITokenSecretName
		}
		if len(config.Capabilities) == 0 {
			if isO1Model(config.Model) {
				config.Capabilities = []string{}
			} else {
				config.Capabilities = []string{uctypes.AICapabilityTools, uctypes.AICapabilityImages, uctypes.AICapabilityPdfs}
			}
		}
	}
	if config.Provider == uctypes.AIProvider_OpenRouter {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if config.Endpoint == "" {
			config.Endpoint = OpenRouterChatEndpoint
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = OpenRouterAPITokenSecretName
		}
	}
	if config.Provider == uctypes.AIProvider_AzureLegacy {
		if config.AzureAPIVersion == "" {
			config.AzureAPIVersion = AzureLegacyDefaultAPIVersion
		}
		if config.Endpoint == "" && isValidAzureResourceName(config.AzureResourceName) && config.AzureDeployment != "" {
			config.Endpoint = fmt.Sprintf(AzureLegacyEndpointTemplate,
				config.AzureResourceName, config.AzureDeployment, config.AzureAPIVersion)
		}
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = AzureOpenAIAPITokenSecretName
		}
	}
	if config.Provider == uctypes.AIProvider_Azure {
		if config.AzureAPIVersion == "" {
			config.AzureAPIVersion = "v1" // purely informational for now
		}
		if config.APIType == "" {
			config.APIType = getAzureAPIType(config.Model)
		}
		if config.Endpoint == "" && isValidAzureResourceName(config.AzureResourceName) && isAzureAPIType(config.APIType) {
			switch config.APIType {
			case uctypes.APIType_OpenAIResponses:
				config.Endpoint = fmt.Sprintf(AzureResponsesEndpointTemplate, config.AzureResourceName)
			case uctypes.APIType_OpenAIChat:
				config.Endpoint = fmt.Sprintf(AzureChatEndpointTemplate, config.AzureResourceName)
			}
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = AzureOpenAIAPITokenSecretName
		}
	}
	if config.Provider == uctypes.AIProvider_Google {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_GoogleGemini
		}
		if config.Endpoint == "" && config.Model != "" {
			config.Endpoint = fmt.Sprintf(GoogleGeminiEndpointTemplate, config.Model)
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = GoogleAIAPITokenSecretName
		}
		if len(config.Capabilities) == 0 {
			config.Capabilities = []string{uctypes.AICapabilityTools, uctypes.AICapabilityImages, uctypes.AICapabilityPdfs}
		}
	}
	if config.APIType == "" {
		config.APIType = uctypes.APIType_OpenAIChat
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
	newPrefixes := []string{"gpt-6", "gpt-5", "gpt-4.1", "o1", "o3"}
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

func isO1Model(model string) bool {
	if model == "" {
		return false
	}
	o1Prefixes := []string{"o1", "o1-mini"}
	for _, prefix := range o1Prefixes {
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
	return AzureResourceNameRegex.MatchString(name)
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

func InitAIModeConfigWatcher() {
	watcher := wconfig.GetWatcher()
	watcher.RegisterUpdateHandler(handleConfigUpdate)
	log.Printf("AI mode config watcher initialized\n")
}

func handleConfigUpdate(fullConfig wconfig.FullConfigType) {
	resolvedConfigs := ComputeResolvedAIModeConfigs(fullConfig)
	broadcastAIModeConfigs(resolvedConfigs)
}

func ComputeResolvedAIModeConfigs(fullConfig wconfig.FullConfigType) map[string]wconfig.AIModeConfigType {
	resolvedConfigs := make(map[string]wconfig.AIModeConfigType)
	
	for modeName, modeConfig := range fullConfig.WaveAIModes {
		resolved := modeConfig
		applyProviderDefaults(&resolved)
		resolvedConfigs[modeName] = resolved
	}
	
	return resolvedConfigs
}

func broadcastAIModeConfigs(configs map[string]wconfig.AIModeConfigType) {
	update := wconfig.AIModeConfigUpdate{
		Configs: configs,
	}
	
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_AIModeConfig,
		Data:  update,
	})
}
