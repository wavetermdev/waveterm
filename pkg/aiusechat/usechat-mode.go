// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"log"
	"os"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/aiutil"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

const (
	OpenAIResponsesEndpoint      = "https://api.openai.com/v1/responses"
	OpenAIChatEndpoint           = "https://api.openai.com/v1/chat/completions"
	OpenRouterChatEndpoint       = "https://openrouter.ai/api/v1/chat/completions"
	NanoGPTChatEndpoint          = "https://nano-gpt.com/api/v1/chat/completions"
	GroqChatEndpoint             = "https://api.groq.com/openai/v1/chat/completions"
	GoogleGeminiEndpointTemplate = "https://generativelanguage.googleapis.com/v1beta/models/%s:streamGenerateContent"

	OpenAIAPITokenSecretName     = "OPENAI_KEY"
	OpenRouterAPITokenSecretName = "OPENROUTER_KEY"
	NanoGPTAPITokenSecretName    = "NANOGPT_KEY"
	GroqAPITokenSecretName       = "GROQ_KEY"
	GoogleAIAPITokenSecretName   = "GOOGLE_AI_KEY"

	// builtInModePrefix identifies built-in Wave AI modes (e.g. waveai@ask).
	// Only entries with this prefix are exposed as selectable modes; any other
	// entry in waveai.json is ignored by the mode resolver.
	builtInModePrefix = "waveai@"
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
		APIType:            m.APIType,
		Model:              m.Model,
		ThinkingLevel:      m.ThinkingLevel,
		Verbosity:          m.Verbosity,
		Endpoint:           m.Endpoint,
		ProxyURL:           m.ProxyURL,
		APIToken:           m.APIToken,
		APITokenSecretName: m.APITokenSecretName,
		Capabilities:       m.Capabilities,
	}
}

// applyModelProviderDefaults reuses the mode-side provider defaulting logic
// for an AIModelConfigType, then copies any newly-populated fields back.
func applyModelProviderDefaults(model *wconfig.AIModelConfigType) {
	tmp := modelToModeConfig(model)
	applyProviderDefaults(model.Provider, &tmp)
	model.APIType = tmp.APIType
	model.Endpoint = tmp.Endpoint
	model.ProxyURL = tmp.ProxyURL
	model.APIToken = tmp.APIToken
	model.APITokenSecretName = tmp.APITokenSecretName
	model.Capabilities = tmp.Capabilities
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

func applyProviderDefaults(provider string, config *wconfig.AIModeConfigType) {
	if provider == uctypes.AIProvider_Wave {
		if config.Endpoint == "" {
			config.Endpoint = uctypes.DefaultAIEndpoint
			if os.Getenv(uctypes.WaveAIEndpointEnvName) != "" {
				config.Endpoint = os.Getenv(uctypes.WaveAIEndpointEnvName)
			}
		}
	}
	if provider == uctypes.AIProvider_OpenAI {
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
	if provider == uctypes.AIProvider_OpenRouter {
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
	if provider == uctypes.AIProvider_NanoGPT {
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
	if provider == uctypes.AIProvider_Groq {
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
	if provider == uctypes.AIProvider_AzureLegacy {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
	}
	if provider == uctypes.AIProvider_Azure {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
	}
	if provider == uctypes.AIProvider_Google {
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

func getOpenAIAPIType(model string) string {
	if isLegacyOpenAIModel(model) {
		return uctypes.APIType_OpenAIChat
	}
	// All newer OpenAI models support openai-responses API:
	// gpt-5*, gpt-4.1*, o1*, o3*, and any future models
	return uctypes.APIType_OpenAIResponses
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

func getAIModeConfig(aiMode string) (*wconfig.AIModeConfigType, error) {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	config, ok := fullConfig.WaveAIModes[aiMode]
	if !ok {
		return nil, fmt.Errorf("invalid AI mode: %s", aiMode)
	}

	applyProviderDefaults("", &config)
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
		if !strings.HasPrefix(modeName, builtInModePrefix) {
			continue
		}
		resolved := modeConfig
		applyProviderDefaults("", &resolved)
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
