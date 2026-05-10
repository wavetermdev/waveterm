// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"log"
	"os"
	"regexp"
	"sort"
	"strings"

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
	NanoGPTChatEndpoint            = "https://nano-gpt.com/api/v1/chat/completions"
	GroqChatEndpoint               = "https://api.groq.com/openai/v1/chat/completions"
	AzureLegacyEndpointTemplate    = "https://%s.openai.azure.com/openai/deployments/%s/chat/completions?api-version=%s"
	AzureResponsesEndpointTemplate = "https://%s.openai.azure.com/openai/v1/responses"
	AzureChatEndpointTemplate      = "https://%s.openai.azure.com/openai/v1/chat/completions"
	GoogleGeminiEndpointTemplate   = "https://generativelanguage.googleapis.com/v1beta/models/%s:streamGenerateContent"

	AzureLegacyDefaultAPIVersion = "2025-04-01-preview"

	OpenAIAPITokenSecretName      = "OPENAI_KEY"
	OpenRouterAPITokenSecretName  = "OPENROUTER_KEY"
	NanoGPTAPITokenSecretName     = "NANOGPT_KEY"
	GroqAPITokenSecretName        = "GROQ_KEY"
	AzureOpenAIAPITokenSecretName = "AZURE_OPENAI_KEY"
	GoogleAIAPITokenSecretName    = "GOOGLE_AI_KEY"
)

func resolveAIMode(requestedMode string) (string, *wconfig.AIModeConfigType, error) {
	config, err := getAIModeConfig(requestedMode)
	if err != nil {
		return "", nil, err
	}
	return requestedMode, config, nil
}

func resolveAIModel(requestedModel string) (string, *wconfig.AIModelConfigType, error) {
	if requestedModel != "" {
		if config, err := getAIModelConfig(requestedModel); err == nil {
			return requestedModel, config, nil
		}
	}
	// Fall back to the first model in display:order.
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	resolved := ComputeResolvedAIModelConfigs(fullConfig)
	fallbackName, fallbackCfg := pickFallbackModel(resolved)
	if fallbackName == "" {
		return "", nil, fmt.Errorf("no AI models configured (add one to ~/.config/waveterm/waveai.json or waveaimodels.json)")
	}
	return fallbackName, &fallbackCfg, nil
}

// pickFallbackModel returns the first model sorted by display:order then key.
func pickFallbackModel(resolved map[string]wconfig.AIModelConfigType) (string, wconfig.AIModelConfigType) {
	type entry struct {
		name string
		cfg  wconfig.AIModelConfigType
	}
	entries := make([]entry, 0, len(resolved))
	for name, cfg := range resolved {
		entries = append(entries, entry{name, cfg})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].cfg.DisplayOrder != entries[j].cfg.DisplayOrder {
			return entries[i].cfg.DisplayOrder < entries[j].cfg.DisplayOrder
		}
		return entries[i].name < entries[j].name
	})
	if len(entries) == 0 {
		return "", wconfig.AIModelConfigType{}
	}
	return entries[0].name, entries[0].cfg
}

// modelToModeConfig copies provider-specific fields from a model config into a
// throwaway mode config so that we can reuse applyProviderDefaults without
// duplicating the per-provider defaulting logic.
func modelToModeConfig(m *wconfig.AIModelConfigType) wconfig.AIModeConfigType {
	return wconfig.AIModeConfigType{
		Provider:           m.Provider,
		APIType:            m.APIType,
		Model:              m.Model,
		ThinkingLevel:      m.ThinkingLevel,
		Verbosity:          m.Verbosity,
		Endpoint:           m.Endpoint,
		ProxyURL:           m.ProxyURL,
		AzureAPIVersion:    m.AzureAPIVersion,
		APIToken:           m.APIToken,
		APITokenSecretName: m.APITokenSecretName,
		AzureResourceName:  m.AzureResourceName,
		AzureDeployment:    m.AzureDeployment,
		Capabilities:       m.Capabilities,
		WaveAICloud:        m.WaveAICloud,
	}
}

// applyModelProviderDefaults reuses the mode-side provider defaulting logic
// for an AIModelConfigType, then copies any newly-populated fields back.
func applyModelProviderDefaults(model *wconfig.AIModelConfigType) {
	tmp := modelToModeConfig(model)
	applyProviderDefaults(&tmp)
	model.Provider = tmp.Provider
	model.APIType = tmp.APIType
	model.Endpoint = tmp.Endpoint
	model.ProxyURL = tmp.ProxyURL
	model.AzureAPIVersion = tmp.AzureAPIVersion
	model.APIToken = tmp.APIToken
	model.APITokenSecretName = tmp.APITokenSecretName
	model.AzureResourceName = tmp.AzureResourceName
	model.AzureDeployment = tmp.AzureDeployment
	model.Capabilities = tmp.Capabilities
	model.WaveAICloud = tmp.WaveAICloud
}

func getAIModelConfig(aiModel string) (*wconfig.AIModelConfigType, error) {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	// Resolved set includes legacy custom waveai.json entries, so user BYOK
	// configurations resolve here too.
	resolved := ComputeResolvedAIModelConfigs(fullConfig)
	config, ok := resolved[aiModel]
	if !ok {
		return nil, fmt.Errorf("invalid AI model: %s", aiModel)
	}
	return &config, nil
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
	if config.Provider == uctypes.AIProvider_NanoGPT {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if config.Endpoint == "" {
			config.Endpoint = NanoGPTChatEndpoint
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = NanoGPTAPITokenSecretName
		}
	}
	if config.Provider == uctypes.AIProvider_Groq {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if config.Endpoint == "" {
			config.Endpoint = GroqChatEndpoint
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = GroqAPITokenSecretName
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
	resolvedModes := ComputeResolvedAIModeConfigs(fullConfig)
	broadcastAIModeConfigs(resolvedModes)
	resolvedModels := ComputeResolvedAIModelConfigs(fullConfig)
	broadcastAIModelConfigs(resolvedModels)
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

func ComputeResolvedAIModelConfigs(fullConfig wconfig.FullConfigType) map[string]wconfig.AIModelConfigType {
	resolvedConfigs := make(map[string]wconfig.AIModelConfigType)
	for modelName, modelConfig := range fullConfig.WaveAIModels {
		resolved := modelConfig
		applyModelProviderDefaults(&resolved)
		resolvedConfigs[modelName] = resolved
	}
	// Backwards-compat: legacy custom entries in waveai.json (where mode and
	// model were the same thing) used a non-wave provider or carried a model.
	// Surface them in the model dropdown so user-configured BYOK providers keep
	// working after the mode/model split. Built-in waveai@... entries are pure
	// modes and intentionally excluded.
	for entryName, modeConfig := range fullConfig.WaveAIModes {
		if strings.HasPrefix(entryName, "waveai@") {
			continue
		}
		if _, exists := resolvedConfigs[entryName]; exists {
			continue
		}
		if modeConfig.Provider == "" && modeConfig.Model == "" && modeConfig.Endpoint == "" {
			continue
		}
		modelConfig := wconfig.AIModelConfigType{
			DisplayName:        modeConfig.DisplayName,
			DisplayOrder:       modeConfig.DisplayOrder,
			DisplayIcon:        modeConfig.DisplayIcon,
			DisplayDescription: modeConfig.DisplayDescription,
			Provider:           modeConfig.Provider,
			APIType:            modeConfig.APIType,
			Model:              modeConfig.Model,
			ThinkingLevel:      modeConfig.ThinkingLevel,
			Verbosity:          modeConfig.Verbosity,
			Endpoint:           modeConfig.Endpoint,
			ProxyURL:           modeConfig.ProxyURL,
			AzureAPIVersion:    modeConfig.AzureAPIVersion,
			APIToken:           modeConfig.APIToken,
			APITokenSecretName: modeConfig.APITokenSecretName,
			AzureResourceName:  modeConfig.AzureResourceName,
			AzureDeployment:    modeConfig.AzureDeployment,
			Capabilities:       modeConfig.Capabilities,
			WaveAICloud:        modeConfig.WaveAICloud,
		}
		applyModelProviderDefaults(&modelConfig)
		resolvedConfigs[entryName] = modelConfig
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

func broadcastAIModelConfigs(configs map[string]wconfig.AIModelConfigType) {
	update := wconfig.AIModelConfigUpdate{
		Configs: configs,
	}

	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_AIModelConfig,
		Data:  update,
	})
}
