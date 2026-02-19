// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package githubcopilot implements the GitHub Copilot AI backend for Wave Terminal.
//
// GitHub Copilot exposes an OpenAI Chat Completions-compatible API, but requires
// a 2-step authentication flow:
//
//  1. The user provides a GitHub token (PAT, OAuth, or Copilot CLI token).
//  2. That token is exchanged for a short-lived Copilot API token via
//     https://api.github.com/copilot_internal/v2/token
//
// The Copilot API token is then used as a Bearer token against the Copilot API
// endpoint (derived from the `proxy-ep` field embedded in the token itself).
//
// This backend wraps the openaichat backend, intercepting requests to perform
// the token exchange and inject the correct endpoint + auth headers.
package githubcopilot

import (
	"context"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/openaichat"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

// RunChatStep executes a chat step against the GitHub Copilot API.
// It exchanges the GitHub token for a Copilot API token, then delegates
// to the openaichat backend with the adjusted config.
func RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.WaveChatOpts,
	cont *uctypes.WaveContinueResponse,
) (*uctypes.WaveStopReason, []*openaichat.StoredChatMessage, *uctypes.RateLimitInfo, error) {
	// The config.APIToken holds the GitHub token (PAT/OAuth).
	// Exchange it for a Copilot API token.
	githubToken := chatOpts.Config.APIToken
	if githubToken == "" {
		return nil, nil, nil, fmt.Errorf("github-copilot: GitHub token is required (set GITHUB_COPILOT_TOKEN secret)")
	}

	copilotToken, err := GetCopilotToken(githubToken)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("github-copilot: token exchange failed: %w", err)
	}

	// Build a modified chatOpts that uses the Copilot token and endpoint.
	modifiedOpts := chatOpts
	modifiedOpts.Config.APIToken = copilotToken.Token
	modifiedOpts.Config.Endpoint = copilotToken.BaseURL + "/chat/completions"

	// Keep the provider as github-copilot so the openaichat backend
	// can add the required Copilot-specific headers.
	modifiedOpts.Config.Provider = uctypes.AIProvider_GitHubCopilot

	return openaichat.RunChatStep(ctx, sseHandler, modifiedOpts, cont)
}

// UpdateToolUseData delegates to openaichat.
func UpdateToolUseData(chatId string, toolCallId string, toolUseData uctypes.UIMessageDataToolUse) error {
	return openaichat.UpdateToolUseData(chatId, toolCallId, toolUseData)
}

// RemoveToolUseCall delegates to openaichat.
func RemoveToolUseCall(chatId string, toolCallId string) error {
	return openaichat.RemoveToolUseCall(chatId, toolCallId)
}

// ConvertToolResultsToNativeChatMessage delegates to openaichat.
func ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	return openaichat.ConvertToolResultsToNativeChatMessage(toolResults)
}

// ConvertAIMessageToStoredChatMessage delegates to openaichat.
func ConvertAIMessageToStoredChatMessage(message uctypes.AIMessage) (*openaichat.StoredChatMessage, error) {
	return openaichat.ConvertAIMessageToStoredChatMessage(message)
}

// GetFunctionCallInputByToolCallId delegates to openaichat.
func GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	return openaichat.GetFunctionCallInputByToolCallId(aiChat, toolCallId)
}

// ConvertAIChatToUIChat delegates to openaichat.
func ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	return openaichat.ConvertAIChatToUIChat(aiChat)
}

// GetDefaultCopilotModels returns the list of model IDs commonly available
// through GitHub Copilot. The availability depends on the user's Copilot plan.
func GetDefaultCopilotModels() []string {
	return []string{
		"gpt-4o",
		"gpt-4.1",
		"gpt-4.1-mini",
		"gpt-4.1-nano",
		"o3-mini",
		"claude-3.5-sonnet",
		"claude-3.7-sonnet",
		"gemini-2.0-flash-001",
	}
}

// DefaultCopilotModel returns the recommended default model for GitHub Copilot.
func DefaultCopilotModel() string {
	return "gpt-4o"
}

// IsCopilotModel returns true if the model string looks like a Copilot-available model.
func IsCopilotModel(model string) bool {
	m := strings.ToLower(model)
	for _, dm := range GetDefaultCopilotModels() {
		if m == strings.ToLower(dm) {
			return true
		}
	}
	return false
}
