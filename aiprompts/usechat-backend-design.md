# useChat Compatible Backend Design for Wave Terminal

## Overview

This document outlines how to create a `useChat()` compatible backend API using Go and Server-Sent Events (SSE) to replace the current complex RPC-based AI chat system. The goal is to leverage Vercel AI SDK's `useChat()` hook while maintaining all existing AI provider functionality.

## Current vs Target Architecture

### Current Architecture
```
Frontend (React) → Custom RPC → Go Backend → AI Providers
- 10+ Jotai atoms for state management
- Custom WaveAIStreamRequest/WaveAIPacketType
- Complex configuration merging in frontend
- Custom streaming protocol over WebSocket
```

### Target Architecture
```
Frontend (useChat) → HTTP/SSE → Go Backend → AI Providers
- Single useChat() hook manages all state
- Standard HTTP POST + SSE streaming
- Backend-driven configuration resolution
- Standard AI SDK streaming format
```

## API Design

### 1. Endpoint Structure

**Chat Streaming Endpoint:**
```
POST /api/ai/chat/{blockId}?preset={presetKey}
```

**Conversation Persistence Endpoints:**
```
POST /api/ai/conversations/{blockId}     # Save conversation
GET  /api/ai/conversations/{blockId}     # Load conversation
```

**Why this approach:**
- `blockId`: Identifies the conversation context (existing Wave concept)
- `preset`: URL parameter for AI configuration preset
- **Separate persistence**: Clean separation of streaming vs storage
- **Fast localhost calls**: Frontend can call both endpoints quickly
- **Simple backend**: Each endpoint has single responsibility

### 2. Request Format & Message Flow

**Simplified Approach:**
- Frontend manages **entire conversation state** (like all modern chat apps)
- Frontend sends **complete message history** with each request
- Backend just processes the messages and streams response
- Frontend handles persistence via existing Wave file system

**Standard useChat() Request:**
```json
{
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "content": "Hello world"
    },
    {
      "id": "msg-2",
      "role": "assistant",
      "content": "Hi there!"
    },
    {
      "id": "msg-3",
      "role": "user",
      "content": "How are you?"  // <- NEW message user just typed
    }
  ]
}
```

**Backend Processing:**
1. **Receive complete conversation** from frontend
2. **Resolve AI configuration** (preset, model, etc.)
3. **Send messages directly** to AI provider
4. **Stream response** back to frontend
5. **Frontend calls separate persistence endpoint** when needed

**Optional Extensions:**
```json
{
  "messages": [...],
  "options": {
    "temperature": 0.7,
    "maxTokens": 1000,
    "model": "gpt-4"  // Override preset model
  }
}
```

### 3. Configuration Resolution

**Priority Order (backend resolves):**
1. **Request options** (highest priority)
2. **URL preset parameter** 
3. **Block metadata** (`block.meta["ai:preset"]`)
4. **Global settings** (`settings["ai:preset"]`)
5. **Default preset** (lowest priority)

**Backend Logic:**
```go
func resolveAIConfig(blockId, presetKey string, requestOptions map[string]any) (*WaveAIOptsType, error) {
    // 1. Load block metadata
    block := getBlock(blockId)
    blockPreset := block.Meta["ai:preset"]
    
    // 2. Load global settings
    settings := getGlobalSettings()
    globalPreset := settings["ai:preset"]
    
    // 3. Resolve preset hierarchy
    finalPreset := presetKey
    if finalPreset == "" {
        finalPreset = blockPreset
    }
    if finalPreset == "" {
        finalPreset = globalPreset
    }
    if finalPreset == "" {
        finalPreset = "default"
    }
    
    // 4. Load and merge preset config
    presetConfig := loadPreset(finalPreset)
    
    // 5. Apply request overrides
    return mergeAIConfig(presetConfig, requestOptions), nil
}
```

### 4. Response Format (SSE)

**Key Insight: Minimal Conversion**
Most AI providers (OpenAI, Anthropic) already return SSE streams. Instead of converting to our custom format and back, we can **proxy/transform** their streams directly to useChat format.

**Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: *
```

**useChat Expected Format:**
```
data: {"type":"text","text":"Hello"}

data: {"type":"text","text":" world"}

data: {"type":"text","text":"!"}

data: {"type":"finish","finish_reason":"stop","usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}

data: [DONE]
```

**Provider Stream Transformation:**
- **OpenAI**: Already SSE → direct proxy (no conversion needed)
- **Anthropic**: Already SSE → direct proxy (minimal field mapping)
- **Google**: Already streaming → direct proxy
- **Perplexity**: OpenAI-compatible → direct proxy
- **Wave Cloud**: WebSocket → **requires conversion** (only one needing transformation)

**Error Format:**
```
data: {"type":"error","error":"API key invalid"}

data: [DONE]
```

## Implementation Plan

### Phase 1: HTTP Handler

```go
// Simplified approach: Direct provider streaming with minimal transformation
func (s *WshServer) HandleAIChat(w http.ResponseWriter, r *http.Request) {
    // 1. Parse URL parameters
    blockId := mux.Vars(r)["blockId"]
    presetKey := r.URL.Query().Get("preset")
    
    // 2. Parse request body
    var req struct {
        Messages []struct {
            Role    string `json:"role"`
            Content string `json:"content"`
        } `json:"messages"`
        Options map[string]any `json:"options,omitempty"`
    }
    json.NewDecoder(r.Body).Decode(&req)
    
    // 3. Resolve configuration
    aiOpts, err := resolveAIConfig(blockId, presetKey, req.Options)
    if err != nil {
        http.Error(w, err.Error(), 400)
        return
    }
    
    // 4. Set SSE headers
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")
    
    // 5. Route to provider and stream directly
    switch aiOpts.APIType {
    case "openai", "perplexity":
        // Direct proxy - these are already SSE compatible
        streamDirectSSE(w, r.Context(), aiOpts, req.Messages)
    case "anthropic":
        // Direct proxy with minimal field mapping
        streamAnthropicSSE(w, r.Context(), aiOpts, req.Messages)
    case "google":
        // Direct proxy
        streamGoogleSSE(w, r.Context(), aiOpts, req.Messages)
    default:
        // Wave Cloud - only one requiring conversion (WebSocket → SSE)
        if isCloudAIRequest(aiOpts) {
            streamWaveCloudToUseChat(w, r.Context(), aiOpts, req.Messages)
        } else {
            http.Error(w, "Unsupported provider", 400)
        }
    }
}

// Example: Direct OpenAI streaming (minimal conversion)
func streamOpenAIToUseChat(w http.ResponseWriter, ctx context.Context, opts *WaveAIOptsType, messages []Message) {
    client := openai.NewClient(opts.APIToken)
    
    stream, err := client.CreateChatCompletionStream(ctx, openai.ChatCompletionRequest{
        Model:    opts.Model,
        Messages: convertToOpenAIMessages(messages),
        Stream:   true,
    })
    if err != nil {
        fmt.Fprintf(w, "data: {\"type\":\"error\",\"error\":%q}\n\n", err.Error())
        fmt.Fprintf(w, "data: [DONE]\n\n")
        return
    }
    defer stream.Close()
    
    for {
        response, err := stream.Recv()
        if errors.Is(err, io.EOF) {
            fmt.Fprintf(w, "data: [DONE]\n\n")
            return
        }
        if err != nil {
            fmt.Fprintf(w, "data: {\"type\":\"error\",\"error\":%q}\n\n", err.Error())
            fmt.Fprintf(w, "data: [DONE]\n\n")
            return
        }
        
        // Direct transformation: OpenAI format → useChat format
        for _, choice := range response.Choices {
            if choice.Delta.Content != "" {
                fmt.Fprintf(w, "data: {\"type\":\"text\",\"text\":%q}\n\n", choice.Delta.Content)
            }
            if choice.FinishReason != "" {
                fmt.Fprintf(w, "data: {\"type\":\"finish\",\"finish_reason\":%q}\n\n", choice.FinishReason)
            }
        }
        
        w.(http.Flusher).Flush()
    }
}

// Wave Cloud conversion (only provider needing transformation)
func streamWaveCloudToUseChat(w http.ResponseWriter, ctx context.Context, opts *WaveAIOptsType, messages []Message) {
    // Use existing Wave Cloud WebSocket logic
    waveReq := wshrpc.WaveAIStreamRequest{
        Opts:   opts,
        Prompt: convertMessagesToPrompt(messages),
    }
    
    stream := waveai.RunAICommand(ctx, waveReq) // Returns WebSocket stream
    
    // Convert Wave Cloud packets to useChat SSE format
    for packet := range stream {
        if packet.Error != nil {
            fmt.Fprintf(w, "data: {\"type\":\"error\",\"error\":%q}\n\n", packet.Error.Error())
            break
        }
        
        resp := packet.Response
        if resp.Text != "" {
            fmt.Fprintf(w, "data: {\"type\":\"text\",\"text\":%q}\n\n", resp.Text)
        }
        if resp.FinishReason != "" {
            usage := ""
            if resp.Usage != nil {
                usage = fmt.Sprintf(",\"usage\":{\"prompt_tokens\":%d,\"completion_tokens\":%d,\"total_tokens\":%d}",
                    resp.Usage.PromptTokens, resp.Usage.CompletionTokens, resp.Usage.TotalTokens)
            }
            fmt.Fprintf(w, "data: {\"type\":\"finish\",\"finish_reason\":%q%s}\n\n", resp.FinishReason, usage)
        }
        
        w.(http.Flusher).Flush()
    }
    
    fmt.Fprintf(w, "data: [DONE]\n\n")
}
```

### Phase 2: Frontend Integration

```typescript
import { useChat } from '@ai-sdk/react';

function WaveAI({ blockId }: { blockId: string }) {
    // Get current preset from block metadata or settings
    const preset = useAtomValue(currentPresetAtom);
    
    const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
        api: `/api/ai/chat/${blockId}?preset=${preset}`,
        initialMessages: [], // Load from existing aidata file
        onFinish: (message) => {
            // Save conversation to aidata file
            saveConversation(blockId, messages);
        }
    });
    
    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto">
                {messages.map(message => (
                    <div key={message.id} className={`message ${message.role}`}>
                        <Markdown text={message.content} />
                    </div>
                ))}
                {isLoading && <TypingIndicator />}
                {error && <div className="error">{error.message}</div>}
            </div>
            
            <form onSubmit={handleSubmit} className="border-t p-4">
                <input
                    value={input}
                    onChange={handleInputChange}
                    placeholder="Type a message..."
                    className="w-full p-2 border rounded"
                />
            </form>
        </div>
    );
}
```

### Phase 3: Advanced Features

#### Multi-modal Support
```typescript
// useChat supports multi-modal out of the box
const { messages, append } = useChat({
    api: `/api/ai/chat/${blockId}`,
});

// Send image + text
await append({
    role: 'user',
    content: [
        { type: 'text', text: 'What do you see in this image?' },
        { type: 'image', image: imageFile }
    ]
});
```

#### Thinking Models
```go
// Backend detects thinking models and formats appropriately
if isThinkingModel(aiOpts.Model) {
    // Send thinking content separately
    fmt.Fprintf(w, "data: {\"type\":\"thinking\",\"text\":%q}\n\n", thinkingText)
    fmt.Fprintf(w, "data: {\"type\":\"text\",\"text\":%q}\n\n", responseText)
}
```

#### Context Injection
```typescript
// Add system messages or context via useChat options
const { messages, append } = useChat({
    api: `/api/ai/chat/${blockId}`,
    initialMessages: [
        {
            role: 'system',
            content: 'You are a helpful terminal assistant...'
        }
    ]
});
```

## Migration Strategy

### 1. Parallel Implementation
- Keep existing RPC system running
- Add new HTTP/SSE endpoint alongside
- Feature flag to switch between systems

### 2. Gradual Migration
- Start with new blocks using useChat
- Migrate existing conversations on first interaction
- Remove RPC system once stable

### 3. Backward Compatibility
- Existing aidata files work unchanged
- Same provider backends (OpenAI, Anthropic, etc.)
- Same configuration system

## Benefits

### Complexity Reduction
- **Frontend**: ~900 lines → ~100 lines (90% reduction)
- **State Management**: 10+ atoms → 1 useChat hook
- **Configuration**: Frontend merging → Backend resolution
- **Streaming**: Custom protocol → Standard SSE

### Modern Features
- **Multi-modal**: Images, files, audio support
- **Thinking Models**: Built-in reasoning trace support
- **Conversation Management**: Edit, retry, branch conversations
- **Error Handling**: Automatic retry and error boundaries
- **Performance**: Optimized streaming and batching

### Developer Experience
- **Type Safety**: Full TypeScript support
- **Testing**: Standard HTTP endpoints easier to test
- **Debugging**: Standard browser dev tools work
- **Documentation**: Leverage AI SDK docs and community

## Configuration Examples

### URL-based Configuration
```
POST /api/ai/chat/block-123?preset=claude-coding
POST /api/ai/chat/block-456?preset=gpt4-creative
```

### Header-based Overrides
```
POST /api/ai/chat/block-123
X-AI-Model: gpt-4-turbo
X-AI-Temperature: 0.8
```

### Request Body Options
```json
{
  "messages": [...],
  "options": {
    "model": "claude-3-sonnet",
    "temperature": 0.7,
    "maxTokens": 2000
  }
}
```

This design maintains all existing functionality while dramatically simplifying the implementation and adding modern AI chat capabilities.