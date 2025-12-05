// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package gemini implements the Google Gemini backend for WaveTerm's AI chat system.
//
// This package provides a complete implementation of the UseChatBackend interface
// for Google's Gemini API, including:
//   - Streaming chat responses via Server-Sent Events (SSE)
//   - Function calling (tool use) support
//   - Multi-modal input support (text, images, PDFs)
//   - Proper message conversion and state management
//
// # API Type
//
// The Gemini backend uses the API type constant:
//   uctypes.APIType_GoogleGemini = "google-gemini"
//
// # Supported Features
//
// - Text messages
// - Image uploads (JPEG, PNG, etc.) - inline base64 encoding
// - PDF document uploads - inline base64 encoding
// - Text file attachments
// - Directory listings
// - Function/tool calling with structured arguments
// - Streaming responses with real-time token delivery
//
// # Usage
//
// The backend is automatically registered and can be obtained via:
//
//   backend, err := aiusechat.GetBackendByAPIType(uctypes.APIType_GoogleGemini)
//
// To use the Gemini API, you need:
//   1. A Google AI API key
//   2. Configure the chat with APIType_GoogleGemini
//   3. Set the Model (e.g., "gemini-2.0-flash-exp")
//   4. Provide the API key in the Config.APIToken field
//
// # Configuration Example
//
//   chatOpts := uctypes.WaveChatOpts{
//       ChatId:   "my-chat-id",
//       ClientId: "my-client-id",
//       Config: uctypes.AIOptsType{
//           APIType:      uctypes.APIType_GoogleGemini,
//           Model:        "gemini-2.0-flash-exp",
//           APIToken:     "your-google-api-key",
//           MaxTokens:    8192,
//           Capabilities: []string{
//               uctypes.AICapabilityTools,
//               uctypes.AICapabilityImages,
//               uctypes.AICapabilityPdfs,
//           },
//       },
//       Tools:        []uctypes.ToolDefinition{...},
//       SystemPrompt: []string{"You are a helpful assistant."},
//   }
//
// # Message Format
//
// The Gemini backend uses the GeminiChatMessage type internally, which stores:
//   - MessageId: Unique identifier for idempotency
//   - Role: "user" or "model" (model is Gemini's term for assistant)
//   - Parts: Array of message parts (text, inline data, function calls/responses)
//   - Usage: Token usage metadata
//
// # Function Calling
//
// Function calling is supported via Gemini's native function calling feature:
//   - Tools are converted to Gemini's FunctionDeclaration format
//   - Function calls are streamed with real-time argument updates
//   - Function responses are sent back as user messages with FunctionResponse parts
//
// # API Endpoint
//
// By default, the backend uses:
//   https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent
//
// You can override this by setting Config.BaseURL.
//
// # Error Handling
//
// The backend properly handles:
//   - Content blocking/safety filters
//   - Token limit errors
//   - Network errors
//   - Malformed responses
//   - Context cancellation
//
// All errors are properly propagated through the SSE stream.
//
// # Limitations
//
// - File uploads must be provided as base64-encoded inline data
// - Images and PDFs use inline data, not file upload URIs
// - Multi-turn conversations require proper role alternation (user/model)
// - Some advanced Gemini features like caching are not yet implemented
package gemini
