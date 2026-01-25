# TODO-003: AI Modes Pre-fill with Providers

## Title
Pre-fill AI providers with incomplete status indicators

## Current State
- `frontend/app/view/waveconfig/waveaivisual.tsx` has visual editor for AI modes
- Default Wave Cloud modes exist in `pkg/wconfig/defaultconfig/waveai.json`
- User can manually create custom AI modes
- No pre-filled provider templates exist
- No visual indicator for incomplete configurations (missing API key)

## What Needs to Be Implemented

### 1. Pre-fill Provider Templates

Create default provider templates in `presets/aimodes.json` (or similar):

**Commercial Providers (Require API Key):**
| Provider | Display Name | Default Model | Secret Name |
|----------|--------------|---------------|-------------|
| openai | OpenAI GPT-4o | gpt-4o | OPENAI_KEY |
| openai | OpenAI GPT-4o Mini | gpt-4o-mini | OPENAI_KEY |
| anthropic | Anthropic Claude 3.5 Sonnet | claude-3-5-sonnet-20241022 | ANTHROPIC_KEY |
| anthropic | Anthropic Claude 3.5 Haiku | claude-3-5-haiku-20241022 | ANTHROPIC_KEY |
| google | Google Gemini Pro | gemini-1.5-pro-latest | GOOGLE_KEY |
| google | Google Gemini Flash | gemini-1.5-flash-latest | GOOGLE_KEY |
| openrouter | OpenRouter (Claude) | anthropic/claude-3.5-sonnet | OPENROUTER_KEY |
| perplexity | Perplexity Sonar | sonar-medium-online | PERPLEXITY_KEY |
| azure | Azure OpenAI | (user deployment) | AZURE_KEY |

**Local/Self-Hosted (No API Key Required):**
| Provider | Display Name | Default Model | Endpoint |
|----------|--------------|---------------|----------|
| ollama | Ollama (Local) | llama3.2:3b | http://localhost:11434/v1 |
| lm-studio | LM Studio (Local) | (loaded model) | http://localhost:1234/v1 |

### 2. Provider Status Indicators

Add visual status badge to each provider in the list:

**Status Types:**
- ✅ **Ready** - API key exists in secrets, configuration complete
- ⚠️ **Incomplete** - API key required but not set
- 🔧 **Local** - No API key needed (self-hosted)
- ❓ **Unknown** - Cannot verify status

**UI Design:**
```
+------------------------------------------+
| AI Modes                                 |
+------------------------------------------+
| WAVE CLOUD                               |
|   Quick (gpt-5-mini)              ✅     |
|   Balanced (gpt-5.1)              ✅     |
|   Deep (gpt-5.1)                  ✅     |
+------------------------------------------+
| COMMERCIAL                               |
|   OpenAI GPT-4o                   ⚠️     |
|   Anthropic Claude 3.5 Sonnet     ⚠️     |
|   Google Gemini Pro               ⚠️     |
+------------------------------------------+
| LOCAL                                    |
|   Ollama (llama3.2)               🔧     |
+------------------------------------------+
```

### 3. Tooltip/Popover on Status Badge

On hover or click, show status details:

**Incomplete Status:**
```
+----------------------------------+
| ⚠️ API Key Required              |
|                                  |
| This provider needs an API key   |
| to function.                     |
|                                  |
| Secret Name: OPENAI_KEY          |
|                                  |
| [Set API Key in Secrets]         |
+----------------------------------+
```

**Ready Status:**
```
+----------------------------------+
| ✅ Ready to use                  |
|                                  |
| API key is configured.           |
+----------------------------------+
```

**Local Status:**
```
+----------------------------------+
| 🔧 Local Provider                |
|                                  |
| No API key required.             |
| Make sure the local server       |
| is running at:                   |
| http://localhost:11434           |
+----------------------------------+
```

### 4. Secret Existence Check

Add RPC call or use existing secrets check to verify if a secret exists:

```typescript
// Option A: New RPC command
const secretExists = await RpcApi.CheckSecretExistsCommand(TabRpcClient, {
    secretName: "OPENAI_KEY"
});

// Option B: Use existing GetSecretsCommand and check list
const secrets = await RpcApi.GetSecretsCommand(TabRpcClient, {});
const hasKey = secrets.includes("OPENAI_KEY");
```

### 5. Quick Link to Secrets Page

When clicking on incomplete provider's status badge:
- Show option to navigate to Secrets tab
- Or show inline secret input dialog

### 6. Pre-filled Provider Config Structure

```json
{
    "openai@gpt-4o": {
        "display:name": "OpenAI GPT-4o",
        "display:order": 10,
        "display:icon": "brain",
        "display:description": "OpenAI's most capable model. Requires OPENAI_KEY secret.",
        "ai:provider": "openai",
        "ai:apitype": "openai-chat",
        "ai:model": "gpt-4o",
        "ai:apitokensecretname": "OPENAI_KEY",
        "ai:capabilities": ["tools", "images", "pdfs"]
    },
    "ollama@llama3": {
        "display:name": "Ollama Llama 3.2",
        "display:order": 100,
        "display:icon": "server",
        "display:description": "Local Ollama server. No API key required.",
        "ai:provider": "custom",
        "ai:apitype": "openai-chat",
        "ai:model": "llama3.2:3b",
        "ai:endpoint": "http://localhost:11434/v1/chat/completions",
        "ai:apitoken": "ollama",
        "ai:capabilities": ["tools"]
    }
}
```

### 7. Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `pkg/wconfig/defaultconfig/presets/aimodes.json` | CREATE | Pre-filled provider templates |
| `frontend/app/view/waveconfig/waveaivisual.tsx` | MODIFY | Add status indicators and grouping |
| `frontend/app/view/waveconfig/waveai-visual.scss` | MODIFY | Style status badges and tooltips |
| `pkg/wshrpc/wshrpctypes.go` | MODIFY | Add CheckSecretExistsCommand (if new) |
| `pkg/wshrpc/wshserver/wshserver.go` | MODIFY | Implement secret check (if new) |

## Dependencies
- May need secrets check RPC command (could use existing GetSecretsCommand)

## Acceptance Criteria
- [ ] Pre-filled provider templates appear in AI modes list
- [ ] Providers grouped by category (Wave Cloud, Commercial, Local)
- [ ] Status badge shows for each provider (✅/⚠️/🔧)
- [ ] Tooltip explains status on hover/click
- [ ] Incomplete providers have clear path to add API key
- [ ] Local providers marked as not needing API key
- [ ] Status updates when secrets are added
- [ ] Pre-filled templates are read-only (user creates copy to customize)

## Testing
- Test with no secrets configured (all commercial show ⚠️)
- Test after adding OPENAI_KEY (that provider shows ✅)
- Test local providers show 🔧 regardless of secrets
- Test tooltip content is accurate
- Test navigation to Secrets tab works
