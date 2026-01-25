# AI Providers Research - Wave Terminal

## Overview

This document analyzes the AI providers supported by Wave Terminal based on:
1. Official documentation at https://docs.waveterm.dev/waveai-modes
2. Source code analysis of the `pkg/waveai/` Go backends
3. JSON schema definitions in `schema/waveai.json`
4. Configuration architecture in `aiprompts/aimodesconfig.md`

---

## Provider List Table

| Provider | Type | Requires API Key | Default Model | Base URL | API Type |
|----------|------|------------------|---------------|----------|----------|
| **wave** | Cloud (Wave Proxy) | No (managed) | gpt-5-mini | https://cfapi.waveterm.dev/api/waveai | openai-responses |
| **openai** | Commercial Cloud | Yes | gpt-4o, gpt-5-mini | https://api.openai.com/v1 | Auto-detected* |
| **anthropic** | Commercial Cloud | Yes | claude-3-sonnet-20250229 | https://api.anthropic.com/v1/messages | anthropic |
| **google** | Commercial Cloud | Yes | gemini-3-pro-preview | Google SDK (auto) | google-gemini |
| **openrouter** | Commercial Aggregator | Yes | (varies) | https://openrouter.ai/api/v1 | openai-chat |
| **azure** | Commercial Enterprise | Yes | (deployment-based) | https://{resource}.openai.azure.com/openai/v1 | Auto-detected* |
| **azure-legacy** | Commercial Enterprise | Yes | (deployment-based) | https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions | openai-chat |
| **perplexity** | Commercial Cloud | Yes | sonar-* models | https://api.perplexity.ai/chat/completions | perplexity |
| **ollama** | Self-hosted/Local | No** | llama3.3:70b | http://localhost:11434/v1 | openai-chat |
| **lm-studio** | Self-hosted/Local | No** | (loaded model) | http://localhost:1234/v1 | openai-chat |
| **vllm** | Self-hosted/Local | No** | (deployed model) | http://localhost:8000/v1 | openai-chat |
| **custom** | Any OpenAI-compatible | Depends | (user-specified) | (user-specified) | (user-specified) |

*Auto-detected: gpt-5*, gpt-4.1*, o1*, o3* use `openai-responses`; others use `openai-chat`
**Local providers may need a placeholder token (any non-empty string)

---

## Provider Classification

### Commercial Cloud (API Key Required)

| Provider | Secret Name Convention | Notes |
|----------|------------------------|-------|
| OpenAI | `OPENAI_KEY` | Direct OpenAI API access |
| Anthropic | `ANTHROPIC_KEY` | Claude models (not in docs, but in code) |
| Google | `GOOGLE_AI_KEY` / `GOOGLE_KEY` | Gemini models via Google AI Studio |
| OpenRouter | `OPENROUTER_KEY` | Aggregates many providers |
| Azure | `AZURE_OPENAI_KEY` / `AZURE_KEY` | Enterprise Azure OpenAI |
| Azure-Legacy | `AZURE_KEY` | Older Azure API format |
| Perplexity | `PERPLEXITY_KEY` | Sonar models with search |

### Self-Hosted / Local (No API Key)

| Provider | Port | Notes |
|----------|------|-------|
| Ollama | 11434 | Popular local LLM runner |
| LM Studio | 1234 | Desktop app for local models |
| vLLM | 8000 | High-performance inference server |
| Text Generation WebUI | varies | OpenAI-compatible option |

### Managed (No User Configuration)

| Provider | Notes |
|----------|-------|
| Wave | Wave Terminal's built-in cloud AI |

---

## Provider Configuration Schema

### Common Fields (All Providers)

```typescript
interface BaseAIModeConfig {
    // Display Configuration
    "display:name": string;           // Required - human-readable name
    "display:order"?: number;         // Sort order in mode list
    "display:icon"?: string;          // FontAwesome icon name
    "display:description"?: string;   // Multi-line description

    // AI Behavior
    "ai:model": string;               // Required - model identifier
    "ai:thinkinglevel"?: "low" | "medium" | "high";
    "ai:capabilities"?: ("tools" | "images" | "pdfs")[];

    // Connection
    "ai:apitype": string;             // Required - API protocol type
    "ai:endpoint"?: string;           // Full API endpoint URL
    "ai:apitoken"?: string;           // Direct API key (not recommended)
    "ai:apitokensecretname"?: string; // Reference to encrypted secret
    "ai:apiversion"?: string;         // API version string
}
```

### Provider-Specific Fields

#### OpenAI
```typescript
{
    "ai:provider": "openai",
    "ai:model": "gpt-4o" | "gpt-5-mini" | "gpt-5.1" | "o1-preview" | "o3-mini",
    "ai:apitype": "openai-chat" | "openai-responses", // Auto-detected from model
    "ai:apitokensecretname": "OPENAI_KEY"
}
```

#### Anthropic (Code-Supported, Not in Docs)
```typescript
{
    "ai:provider": "custom", // Must use custom since not in provider enum
    "ai:apitype": "anthropic",
    "ai:model": "claude-3-opus-20250229" | "claude-3-sonnet-20250229" | "claude-3-haiku-20240307",
    "ai:endpoint": "https://api.anthropic.com/v1/messages",
    "ai:apitokensecretname": "ANTHROPIC_KEY",
    "ai:apiversion": "2023-06-01" // anthropic-version header
}
```

#### Google (Gemini)
```typescript
{
    "ai:provider": "google",
    "ai:apitype": "google-gemini",
    "ai:model": "gemini-3-pro-preview" | "gemini-2.0-flash",
    "ai:apitokensecretname": "GOOGLE_KEY"
}
```

#### OpenRouter
```typescript
{
    "ai:provider": "openrouter",
    "ai:apitype": "openai-chat",
    "ai:model": "qwen/qwen-2.5-coder-32b-instruct" | "anthropic/claude-3.5-sonnet",
    "ai:apitokensecretname": "OPENROUTER_KEY",
    "ai:capabilities": ["tools", "images", "pdfs"] // Must specify manually
}
```

#### Azure
```typescript
{
    "ai:provider": "azure",
    "ai:azureresourcename": "my-resource-name", // Required
    "ai:model": "gpt-4o",
    "ai:apitype": "openai-chat" | "openai-responses", // Auto-detected
    "ai:apitokensecretname": "AZURE_KEY",
    "ai:capabilities": ["tools", "images", "pdfs"] // Must specify manually
}
```

#### Azure-Legacy
```typescript
{
    "ai:provider": "azure-legacy",
    "ai:azureresourcename": "my-resource-name", // Required
    "ai:azuredeployment": "my-deployment",       // Required
    "ai:azureapiversion": "2025-04-01-preview", // Optional, has default
    "ai:model": "gpt-4o",
    "ai:apitype": "openai-chat",
    "ai:apitokensecretname": "AZURE_KEY"
}
```

#### Ollama (Local)
```typescript
{
    "ai:provider": "custom",
    "ai:apitype": "openai-chat",
    "ai:model": "llama3.3:70b" | "codellama:34b" | "mistral:latest",
    "ai:endpoint": "http://localhost:11434/v1/chat/completions",
    "ai:apitoken": "ollama" // Placeholder required
}
```

#### LM Studio (Local)
```typescript
{
    "ai:provider": "custom",
    "ai:apitype": "openai-chat",
    "ai:model": "qwen/qwen-2.5-coder-32b-instruct",
    "ai:endpoint": "http://localhost:1234/v1/chat/completions",
    "ai:apitoken": "lm-studio" // Placeholder required
}
```

#### Custom Provider
```typescript
{
    "ai:provider": "custom",
    "ai:apitype": "openai-chat" | "openai-responses" | "google-gemini",
    "ai:model": "string",              // User-specified
    "ai:endpoint": "string",           // User-specified, required
    "ai:apitokensecretname"?: "string" // User-defined secret name
}
```

---

## Pre-fill Strategy for GUI Settings

### 1. Providers to Pre-fill

For a good user experience, pre-fill entries for the most common providers:

| Pre-fill Entry | Status | Notes |
|----------------|--------|-------|
| OpenAI | Yes | Most common, clear setup |
| Anthropic (Claude) | Yes | Popular, supported in code |
| Google (Gemini) | Yes | Growing popularity |
| OpenRouter | Yes | Access to many models |
| Ollama | Yes | Most popular local option |
| Azure | Optional | Enterprise users can add |
| Azure-Legacy | No | Deprecated pattern |
| LM Studio | Optional | Desktop app users |
| vLLM | No | Advanced users can add |
| Perplexity | Optional | Niche use case |

### 2. Pre-fill Configuration

```json
{
    "openai@gpt-4o": {
        "display:name": "OpenAI GPT-4o",
        "display:order": 10,
        "display:icon": "brain",
        "ai:provider": "openai",
        "ai:apitype": "openai-chat",
        "ai:model": "gpt-4o",
        "ai:apitokensecretname": "OPENAI_KEY",
        "ai:capabilities": ["tools", "images", "pdfs"]
    },
    "anthropic@claude-3-sonnet": {
        "display:name": "Anthropic Claude 3 Sonnet",
        "display:order": 20,
        "display:icon": "comments",
        "ai:provider": "custom",
        "ai:apitype": "anthropic",
        "ai:model": "claude-3-sonnet-20250229",
        "ai:endpoint": "https://api.anthropic.com/v1/messages",
        "ai:apitokensecretname": "ANTHROPIC_KEY",
        "ai:apiversion": "2023-06-01",
        "ai:capabilities": ["tools", "images", "pdfs"]
    },
    "google@gemini-pro": {
        "display:name": "Google Gemini Pro",
        "display:order": 30,
        "display:icon": "gem",
        "ai:provider": "google",
        "ai:apitype": "google-gemini",
        "ai:model": "gemini-2.0-flash",
        "ai:apitokensecretname": "GOOGLE_KEY",
        "ai:capabilities": ["tools", "images", "pdfs"]
    },
    "openrouter@claude-sonnet": {
        "display:name": "OpenRouter (Claude 3.5 Sonnet)",
        "display:order": 40,
        "display:icon": "route",
        "ai:provider": "openrouter",
        "ai:apitype": "openai-chat",
        "ai:model": "anthropic/claude-3.5-sonnet",
        "ai:apitokensecretname": "OPENROUTER_KEY",
        "ai:capabilities": ["tools", "images"]
    },
    "ollama@llama3": {
        "display:name": "Ollama (Llama 3)",
        "display:order": 50,
        "display:icon": "server",
        "ai:provider": "custom",
        "ai:apitype": "openai-chat",
        "ai:model": "llama3.3:70b",
        "ai:endpoint": "http://localhost:11434/v1/chat/completions",
        "ai:apitoken": "ollama",
        "ai:capabilities": ["tools"]
    }
}
```

### 3. Marking Incomplete Providers

For providers that require API keys but don't have them set:

**Visual Indicators:**
- Warning icon (yellow/orange triangle) next to provider name
- "API Key Required" badge
- Tooltip explaining: "Set your API key to use this provider"
- Greyed out or disabled "Test Connection" button

**Validation Logic:**
```typescript
function isProviderComplete(mode: AIModeConfig): boolean {
    const needsApiKey = !isLocalProvider(mode);
    if (!needsApiKey) return true;

    // Check if secret exists
    const secretName = mode["ai:apitokensecretname"];
    if (!secretName) return false;

    // Check if secret is set (via RPC call)
    const secrets = await RpcApi.GetSecretsCommand(...);
    return secrets.includes(secretName);
}

function isLocalProvider(mode: AIModeConfig): boolean {
    const endpoint = mode["ai:endpoint"] || "";
    return endpoint.includes("localhost") ||
           endpoint.includes("127.0.0.1") ||
           endpoint.includes("192.168.") ||
           endpoint.includes("10.");
}
```

### 4. Default Values by Provider

| Provider | Default Model | Default Max Tokens | Default Capabilities |
|----------|---------------|-------------------|---------------------|
| wave | gpt-5-mini | 4000 | tools, images, pdfs |
| openai | gpt-4o | 4096 | tools, images, pdfs |
| anthropic | claude-3-sonnet-20250229 | 4096 | tools, images, pdfs |
| google | gemini-2.0-flash | 8192 | tools, images, pdfs |
| openrouter | (varies) | 4096 | (varies by model) |
| azure | (deployment) | 4096 | tools, images, pdfs |
| ollama | llama3.3:70b | 4096 | tools |
| custom | - | 4096 | (none by default) |

---

## API Type Mapping

| API Type | Providers | Protocol |
|----------|-----------|----------|
| `openai-chat` | OpenAI, OpenRouter, Azure, Ollama, LM Studio, vLLM | OpenAI Chat Completions |
| `openai-responses` | OpenAI (gpt-5*, o1*, o3*), Azure (new models) | OpenAI Responses API |
| `google-gemini` | Google | Google Generative AI |
| `anthropic` | Anthropic | Anthropic Messages API |
| `perplexity` | Perplexity | Perplexity Chat API |

---

## Secret Name Conventions

| Provider | Secret Name | Environment Variable Alternative |
|----------|-------------|----------------------------------|
| OpenAI | `OPENAI_KEY` | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_KEY` | `ANTHROPIC_API_KEY` |
| Google | `GOOGLE_KEY` | `GOOGLE_AI_KEY`, `GOOGLE_API_KEY` |
| OpenRouter | `OPENROUTER_KEY` | `OPENROUTER_API_KEY` |
| Azure | `AZURE_KEY` | `AZURE_OPENAI_KEY` |
| Perplexity | `PERPLEXITY_KEY` | `PERPLEXITY_API_KEY` |
| Custom | User-defined | User-defined |

---

## Implementation Notes

### Anthropic Provider Gap

**Issue:** Anthropic is fully supported in Go code (`pkg/waveai/anthropicbackend.go`) but is NOT listed in the official provider enum in `schema/waveai.json`.

**Current Workaround:** Use `"ai:provider": "custom"` with `"ai:apitype": "anthropic"`

**Recommendation:** Consider adding `"anthropic"` to the provider enum for better UX:
```json
"ai:provider": {
    "type": "string",
    "enum": ["wave", "google", "openrouter", "openai", "azure", "azure-legacy", "anthropic", "custom"]
}
```

### Perplexity Provider Gap

**Issue:** Perplexity backend exists in Go code but isn't documented or in the schema.

**Recommendation:** Either add to schema or document as a custom provider option.

### Local Provider Detection

The codebase has logic to detect local URLs (`isLocalURL()` in `waveai.go`):
- localhost, 127.0.0.1, 0.0.0.0
- 192.168.x.x (private network)
- 10.x.x.x (private network)
- 172.16-31.x.x (private network)

This is used for telemetry purposes but could also be used to auto-detect "no API key required" status.

---

## References

- Documentation: https://docs.waveterm.dev/waveai-modes
- Go Backends: `pkg/waveai/*.go`
- Schema: `schema/waveai.json`
- Architecture: `aiprompts/aimodesconfig.md`
- Default Config: `pkg/wconfig/defaultconfig/waveai.json`
