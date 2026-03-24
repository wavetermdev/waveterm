# Wave AI Architecture Documentation

## Overview

Wave AI is a chat-based AI assistant feature integrated into Wave Terminal. It provides a conversational interface for interacting with various AI providers (OpenAI, Anthropic, Perplexity, Google, and Wave's cloud proxy) through a unified streaming architecture. The feature is implemented as a block view within Wave Terminal's modular system.

## Architecture Components

### Frontend Architecture (`frontend/app/view/waveai/`)

#### Core Components

**1. WaveAiModel Class**
- **Purpose**: Main view model implementing the `ViewModel` interface
- **Responsibilities**:
  - State management using Jotai atoms
  - Configuration management (presets, AI options)
  - Message handling and persistence
  - RPC communication with backend
  - UI state coordination

**2. AiWshClient Class**
- **Purpose**: Specialized WSH RPC client for AI operations
- **Extends**: `WshClient`
- **Responsibilities**:
  - Handle incoming `aisendmessage` RPC calls
  - Route messages to the model's `sendMessage` method

**3. React Components**
- **WaveAi**: Main container component
- **ChatWindow**: Scrollable message display with auto-scroll behavior
- **ChatItem**: Individual message renderer with role-based styling
- **ChatInput**: Auto-resizing textarea with keyboard navigation

#### State Management (Jotai Atoms)

**Message State**:
```typescript
messagesAtom: PrimitiveAtom<Array<ChatMessageType>>
messagesSplitAtom: SplitAtom<Array<ChatMessageType>>
latestMessageAtom: Atom<ChatMessageType>
addMessageAtom: WritableAtom<unknown, [message: ChatMessageType], void>
updateLastMessageAtom: WritableAtom<unknown, [text: string, isUpdating: boolean], void>
removeLastMessageAtom: WritableAtom<unknown, [], void>
```

**Configuration State**:
```typescript
presetKey: Atom<string>           // Current AI preset selection
presetMap: Atom<{[k: string]: MetaType}>  // Available AI presets
mergedPresets: Atom<MetaType>     // Merged configuration hierarchy
aiOpts: Atom<WaveAIOptsType>      // Final AI options for requests
```

**UI State**:
```typescript
locked: PrimitiveAtom<boolean>    // Prevents input during AI response
viewIcon: Atom<string>            // Header icon
viewName: Atom<string>            // Header title
viewText: Atom<HeaderElem[]>      // Dynamic header elements
endIconButtons: Atom<IconButtonDecl[]>  // Header action buttons
```

#### Configuration Hierarchy

The AI configuration follows a three-tier hierarchy (lowest to highest priority):
1. **Global Settings**: `atoms.settingsAtom["ai:*"]`
2. **Preset Configuration**: `presets[presetKey]["ai:*"]`
3. **Block Metadata**: `block.meta["ai:*"]`

Configuration is merged using `mergeMeta()` utility, allowing fine-grained overrides at each level.

#### Data Flow - Frontend

```
User Input → sendMessage() → 
├── Add user message to UI
├── Create WaveAIStreamRequest
├── Call RpcApi.StreamWaveAiCommand()
├── Add typing indicator
└── Stream response handling:
    ├── Update message incrementally
    ├── Handle errors
    └── Save complete conversation
```

### Backend Architecture (`pkg/waveai/`)

#### Core Interface

**AIBackend Interface**:
```go
type AIBackend interface {
    StreamCompletion(
        ctx context.Context,
        request wshrpc.WaveAIStreamRequest,
    ) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType]
}
```

#### Backend Implementations

**1. OpenAIBackend** (`openaibackend.go`)
- **Providers**: OpenAI, Azure OpenAI, Cloudflare Azure
- **Features**: 
  - Reasoning model support (o1, o3, o4, gpt-5)
  - Proxy support
  - Multiple API types (OpenAI, Azure, AzureAD, CloudflareAzure)
- **Streaming**: Uses `go-openai` library for SSE streaming

**2. AnthropicBackend** (`anthropicbackend.go`)
- **Provider**: Anthropic Claude
- **Features**:
  - Custom SSE parser for Anthropic's event format
  - System message handling
  - Usage token tracking
- **Events**: `message_start`, `content_block_delta`, `message_stop`, etc.

**3. WaveAICloudBackend** (`cloudbackend.go`)
- **Provider**: Wave's cloud proxy service
- **Transport**: WebSocket connection to Wave cloud
- **Features**: 
  - Fallback when no API token/baseURL provided
  - Built-in rate limiting and abuse protection

**4. PerplexityBackend** (`perplexitybackend.go`)
- **Provider**: Perplexity AI
- **Implementation**: Similar to OpenAI backend

**5. GoogleBackend** (`googlebackend.go`)
- **Provider**: Google AI (Gemini)
- **Implementation**: Custom integration for Google's API

#### Backend Routing Logic

```go
func RunAICommand(ctx context.Context, request wshrpc.WaveAIStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
    // Route based on request.Opts.APIType:
    switch request.Opts.APIType {
    case "anthropic":
        backend = AnthropicBackend{}
    case "perplexity":
        backend = PerplexityBackend{}
    case "google":
        backend = GoogleBackend{}
    default:
        if IsCloudAIRequest(request.Opts) {
            backend = WaveAICloudBackend{}
        } else {
            backend = OpenAIBackend{}
        }
    }
    return backend.StreamCompletion(ctx, request)
}
```

### RPC Communication Layer

#### WSH RPC Integration

**Command**: `streamwaveai`
**Type**: Response Stream (one request, multiple responses)

**Request Type** (`WaveAIStreamRequest`):
```go
type WaveAIStreamRequest struct {
    ClientId string                    `json:"clientid,omitempty"`
    Opts     *WaveAIOptsType           `json:"opts"`
    Prompt   []WaveAIPromptMessageType `json:"prompt"`
}
```

**Response Type** (`WaveAIPacketType`):
```go
type WaveAIPacketType struct {
    Type         string           `json:"type"`
    Model        string           `json:"model,omitempty"`
    Created      int64            `json:"created,omitempty"`
    FinishReason string           `json:"finish_reason,omitempty"`
    Usage        *WaveAIUsageType `json:"usage,omitempty"`
    Index        int              `json:"index,omitempty"`
    Text         string           `json:"text,omitempty"`
    Error        string           `json:"error,omitempty"`
}
```

#### Configuration Types

**AI Options** (`WaveAIOptsType`):
```go
type WaveAIOptsType struct {
    Model      string `json:"model"`
    APIType    string `json:"apitype,omitempty"`
    APIToken   string `json:"apitoken"`
    OrgID      string `json:"orgid,omitempty"`
    APIVersion string `json:"apiversion,omitempty"`
    BaseURL    string `json:"baseurl,omitempty"`
    ProxyURL   string `json:"proxyurl,omitempty"`
    MaxTokens  int    `json:"maxtokens,omitempty"`
    MaxChoices int    `json:"maxchoices,omitempty"`
    TimeoutMs  int    `json:"timeoutms,omitempty"`
}
```

### Data Persistence

#### Chat History Storage

**Frontend**:
- **Method**: `fetchWaveFile(blockId, "aidata")`
- **Format**: JSON array of `WaveAIPromptMessageType`
- **Sliding Window**: Last 30 messages (`slidingWindowSize = 30`)

**Backend**:
- **Service**: `BlockService.SaveWaveAiData(blockId, history)`
- **Storage**: Block-associated file storage
- **Persistence**: Automatic save after each complete exchange

#### Message Format

**UI Messages** (`ChatMessageType`):
```typescript
interface ChatMessageType {
    id: string;
    user: string;        // "user" | "assistant" | "error"
    text: string;
    isUpdating?: boolean;
}
```

**Stored Messages** (`WaveAIPromptMessageType`):
```go
type WaveAIPromptMessageType struct {
    Role    string `json:"role"`     // "user" | "assistant" | "system" | "error"
    Content string `json:"content"`
    Name    string `json:"name,omitempty"`
}
```

### Error Handling

#### Frontend Error Handling

1. **Network Errors**: Caught in streaming loop, displayed as error messages
2. **Empty Responses**: Automatically remove typing indicator
3. **Cancellation**: User can cancel via stop button (`model.cancel = true`)
4. **Partial Responses**: Saved even if incomplete due to errors

#### Backend Error Handling

1. **Panic Recovery**: All backends use `panichandler.PanicHandler()`
2. **Context Cancellation**: Proper cleanup on request cancellation
3. **Provider Errors**: Wrapped and forwarded to frontend
4. **Connection Errors**: Detailed error messages for debugging

### UI Features

#### Message Rendering

- **Markdown Support**: Full markdown rendering with syntax highlighting
- **Role-based Styling**: Different colors/layouts for user/assistant/error messages
- **Typing Indicator**: Animated dots during AI response
- **Font Configuration**: Configurable font sizes via presets

#### Input Handling

- **Auto-resize**: Textarea grows/shrinks with content (max 5 lines)
- **Keyboard Navigation**: 
  - Enter to send
  - Cmd+L to clear history
  - Arrow keys for code block selection
- **Code Block Selection**: Navigate through code blocks in responses

#### Scroll Management

- **Auto-scroll**: Automatically scrolls to new messages
- **User Scroll Detection**: Pauses auto-scroll when user manually scrolls
- **Smart Resume**: Resumes auto-scroll when near bottom

### Configuration Management

#### Preset System

**Preset Structure**:
```json
{
  "ai@preset-name": {
    "display:name": "Preset Display Name",
    "display:order": 1,
    "ai:model": "gpt-4",
    "ai:apitype": "openai",
    "ai:apitoken": "sk-...",
    "ai:baseurl": "https://api.openai.com/v1",
    "ai:maxtokens": 4000,
    "ai:fontsize": "14px",
    "ai:fixedfontsize": "12px"
  }
}
```

**Configuration Keys**:
- `ai:model` - AI model name
- `ai:apitype` - Provider type (openai, anthropic, perplexity, google)
- `ai:apitoken` - API authentication token
- `ai:baseurl` - Custom API endpoint
- `ai:proxyurl` - HTTP proxy URL
- `ai:maxtokens` - Maximum response tokens
- `ai:timeoutms` - Request timeout
- `ai:fontsize` - UI font size
- `ai:fixedfontsize` - Code block font size

#### Provider Detection

The UI automatically detects and displays the active provider:

- **Cloud**: Wave's proxy (no token/baseURL)
- **Local**: localhost/127.0.0.1 endpoints
- **Remote**: External API endpoints
- **Provider-specific**: Anthropic, Perplexity with custom icons

### Performance Considerations

#### Frontend Optimizations

- **Jotai Atoms**: Granular reactivity, only re-render affected components
- **Memo Components**: `ChatWindow` and `ChatItem` are memoized
- **Throttled Scrolling**: Scroll events throttled to 100ms
- **Debounced Scroll Detection**: User scroll detection debounced to 300ms

#### Backend Optimizations

- **Streaming**: All responses are streamed for immediate feedback
- **Context Cancellation**: Proper cleanup prevents resource leaks
- **Connection Pooling**: HTTP clients reuse connections
- **Error Recovery**: Graceful degradation on provider failures

### Security Considerations

#### API Token Handling

- **Storage**: Tokens stored in encrypted configuration
- **Transmission**: Tokens only sent to configured endpoints
- **Validation**: Backend validates token format and permissions

#### Request Validation

- **Input Sanitization**: User input validated before sending
- **Rate Limiting**: Cloud backend includes built-in rate limiting
- **Error Filtering**: Sensitive error details filtered from UI

### Extension Points

#### Adding New Providers

1. **Implement AIBackend Interface**: Create new backend struct
2. **Add Provider Detection**: Update `RunAICommand()` routing logic
3. **Add Configuration**: Define provider-specific config keys
4. **Update UI**: Add provider detection in `viewText` atom

#### Custom Message Types

1. **Extend ChatMessageType**: Add new user types
2. **Update ChatItem Rendering**: Handle new message types
3. **Modify Storage**: Update persistence format if needed

This architecture provides a flexible, extensible foundation for AI chat functionality while maintaining clean separation between UI, business logic, and provider integrations.