// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gemini

import (
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

const (
	GeminiDefaultMaxTokens = 8192
)

// GeminiChatMessage represents a stored chat message for Gemini backend
type GeminiChatMessage struct {
	MessageId string               `json:"messageid"`
	Role      string               `json:"role"` // "user", "model"
	Parts     []GeminiMessagePart  `json:"parts"`
	Usage     *GeminiUsageMetadata `json:"usage,omitempty"`
}

func (m *GeminiChatMessage) GetMessageId() string {
	return m.MessageId
}

func (m *GeminiChatMessage) GetRole() string {
	return m.Role
}

func (m *GeminiChatMessage) GetUsage() *uctypes.AIUsage {
	if m.Usage == nil {
		return nil
	}
	return &uctypes.AIUsage{
		APIType:      uctypes.APIType_GoogleGemini,
		Model:        m.Usage.Model,
		InputTokens:  m.Usage.PromptTokenCount,
		OutputTokens: m.Usage.CandidatesTokenCount,
	}
}

// GeminiMessagePart represents different types of content in a message
type GeminiMessagePart struct {
	// Text part
	Text string `json:"text,omitempty"`

	// Inline data (images, PDFs, etc.)
	InlineData *GeminiInlineData `json:"inlineData,omitempty"`

	// File data (for uploaded files)
	FileData *GeminiFileData `json:"fileData,omitempty"`

	// Function call (assistant calling a tool)
	FunctionCall *GeminiFunctionCall `json:"functionCall,omitempty"`

	// Function response (result of tool execution)
	FunctionResponse *GeminiFunctionResponse `json:"functionResponse,omitempty"`

	// Thought signature (for thinking models - applies to text and function calls)
	ThoughtSignature string `json:"thoughtSignature,omitempty"`

	// Internal fields (not sent to API)
	PreviewUrl  string                        `json:"previewurl,omitempty"`  // internal field
	FileName    string                        `json:"filename,omitempty"`    // internal field
	ToolUseData *uctypes.UIMessageDataToolUse `json:"toolusedata,omitempty"` // internal field
}

// Clean removes internal fields before sending to API
func (p *GeminiMessagePart) Clean() *GeminiMessagePart {
	if p == nil {
		return nil
	}
	cleaned := *p
	cleaned.PreviewUrl = ""
	cleaned.FileName = ""
	cleaned.ToolUseData = nil
	return &cleaned
}

// GeminiInlineData represents inline binary data
type GeminiInlineData struct {
	MimeType    string `json:"mimeType"`
	Data        string `json:"data"` // base64 encoded
	DisplayName string `json:"displayName,omitempty"` // for multimodal function responses
}

// GeminiFileData represents uploaded file reference
type GeminiFileData struct {
	MimeType    string `json:"mimeType"`
	FileUri     string `json:"fileUri"` // gs:// URI from file upload
	DisplayName string `json:"displayName,omitempty"` // for multimodal function responses
}

// GeminiFunctionCall represents a function call from the model
type GeminiFunctionCall struct {
	Name string         `json:"name"`
	Args map[string]any `json:"args,omitempty"`
}

// GeminiFunctionResponse represents a function execution result
type GeminiFunctionResponse struct {
	Name     string              `json:"name"`
	Response map[string]any      `json:"response"`
	Parts    []GeminiMessagePart `json:"parts,omitempty"` // nested parts for multimodal content (Gemini 3 Pro and later)
}

// GeminiUsageMetadata represents token usage
type GeminiUsageMetadata struct {
	Model                   string `json:"model,omitempty"` // internal field
	PromptTokenCount        int    `json:"promptTokenCount"`
	CachedContentTokenCount int    `json:"cachedContentTokenCount,omitempty"`
	CandidatesTokenCount    int    `json:"candidatesTokenCount"`
	TotalTokenCount         int    `json:"totalTokenCount"`
}

// GeminiThinkingConfig represents thinking configuration for Gemini 3+ models
type GeminiThinkingConfig struct {
	ThinkingLevel string `json:"thinkingLevel,omitempty"` // "low" or "high"
}

// GeminiGenerationConfig represents generation parameters
type GeminiGenerationConfig struct {
	Temperature     float32               `json:"temperature,omitempty"`
	TopP            float32               `json:"topP,omitempty"`
	TopK            int32                 `json:"topK,omitempty"`
	CandidateCount  int32                 `json:"candidateCount,omitempty"`
	MaxOutputTokens int32                 `json:"maxOutputTokens,omitempty"`
	StopSequences   []string              `json:"stopSequences,omitempty"`
	ThinkingConfig  *GeminiThinkingConfig `json:"thinkingConfig,omitempty"` // for Gemini 3+ models
}

// GeminiTool represents a function tool definition
type GeminiTool struct {
	FunctionDeclarations []GeminiFunctionDeclaration `json:"functionDeclarations,omitempty"`
	GoogleSearch         *GeminiGoogleSearch         `json:"googleSearch,omitempty"`
}

// GeminiGoogleSearch represents Google Search configuration (empty for default)
type GeminiGoogleSearch struct{}

// GeminiFunctionDeclaration represents a function schema
type GeminiFunctionDeclaration struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

// GeminiToolConfig represents tool choice configuration
type GeminiToolConfig struct {
	FunctionCallingConfig *GeminiFunctionCallingConfig `json:"functionCallingConfig,omitempty"`
}

// GeminiFunctionCallingConfig represents function calling configuration
type GeminiFunctionCallingConfig struct {
	Mode string `json:"mode,omitempty"` // "AUTO", "ANY", "NONE"
}

// GeminiContent represents a content message for the API
type GeminiContent struct {
	Role  string              `json:"role,omitempty"`
	Parts []GeminiMessagePart `json:"parts"`
}

// Clean removes internal fields from all parts
func (c *GeminiContent) Clean() *GeminiContent {
	if c == nil {
		return nil
	}
	cleaned := &GeminiContent{
		Role:  c.Role,
		Parts: make([]GeminiMessagePart, len(c.Parts)),
	}
	for i, part := range c.Parts {
		cleaned.Parts[i] = *part.Clean()
	}
	return cleaned
}

// GeminiRequest represents a request to the Gemini API
type GeminiRequest struct {
	Contents          []GeminiContent         `json:"contents"`
	SystemInstruction *GeminiContent          `json:"systemInstruction,omitempty"`
	GenerationConfig  *GeminiGenerationConfig `json:"generationConfig,omitempty"`
	Tools             []GeminiTool            `json:"tools,omitempty"`
	ToolConfig        *GeminiToolConfig       `json:"toolConfig,omitempty"`
}

// GeminiStreamResponse represents a streaming response chunk
type GeminiStreamResponse struct {
	Candidates        []GeminiCandidate        `json:"candidates,omitempty"`
	PromptFeedback    *GeminiPromptFeedback    `json:"promptFeedback,omitempty"`
	UsageMetadata     *GeminiUsageMetadata     `json:"usageMetadata,omitempty"`
	GroundingMetadata *GeminiGroundingMetadata `json:"groundingMetadata,omitempty"`
}

// GeminiCandidate represents a candidate response
type GeminiCandidate struct {
	Content           *GeminiContent           `json:"content,omitempty"`
	FinishReason      string                   `json:"finishReason,omitempty"`
	Index             int                      `json:"index,omitempty"`
	SafetyRatings     []GeminiSafetyRating     `json:"safetyRatings,omitempty"`
	GroundingMetadata *GeminiGroundingMetadata `json:"groundingMetadata,omitempty"`
}

// GeminiSafetyRating represents a safety rating
type GeminiSafetyRating struct {
	Category    string `json:"category"`
	Probability string `json:"probability"`
}

// GeminiPromptFeedback represents feedback about the prompt
type GeminiPromptFeedback struct {
	BlockReason   string               `json:"blockReason,omitempty"`
	SafetyRatings []GeminiSafetyRating `json:"safetyRatings,omitempty"`
}

// GeminiErrorResponse represents an error response
type GeminiErrorResponse struct {
	Error *GeminiError `json:"error,omitempty"`
}

// GeminiError represents an error
type GeminiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Status  string `json:"status,omitempty"`
}

// GeminiGroundingMetadata represents grounding metadata with web search results
type GeminiGroundingMetadata struct {
	WebSearchQueries []string `json:"webSearchQueries,omitempty"`
}
