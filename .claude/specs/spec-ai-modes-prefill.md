# Spec: AI Modes Pre-fill with Providers (TODO-003)

## Objective

Add pre-filled provider templates to the Wave AI Modes configuration UI with visual status indicators showing whether required API keys are configured.

## Context

- `frontend/app/view/waveconfig/waveaivisual.tsx` - Visual editor exists with Wave Cloud and Custom modes
- `pkg/wconfig/defaultconfig/waveai.json` - Only contains Wave Cloud modes
- No pre-filled commercial provider templates exist
- No status indicators for API key configuration

## Provider Templates

### Wave Cloud (Managed - Always Ready)
| Key | Display Name | Model |
|-----|--------------|-------|
| `waveai@quick` | Quick | gpt-5-mini |
| `waveai@balanced` | Balanced | gpt-5.1 |
| `waveai@deep` | Deep | gpt-5.1 |

### Commercial Providers (Require API Key)
| Key | Display Name | Provider | Model | Secret Name |
|-----|--------------|----------|-------|-------------|
| `provider@openai-gpt4o` | OpenAI GPT-4o | openai | gpt-4o | OPENAI_KEY |
| `provider@anthropic-sonnet` | Anthropic Claude Sonnet | custom | claude-3-5-sonnet-20241022 | ANTHROPIC_KEY |
| `provider@google-gemini` | Google Gemini Flash | google | gemini-2.0-flash | GOOGLE_AI_KEY |
| `provider@openrouter-claude` | OpenRouter (Claude 3.5) | openrouter | anthropic/claude-3.5-sonnet | OPENROUTER_KEY |

### Local Providers (No API Key Required)
| Key | Display Name | Endpoint |
|-----|--------------|----------|
| `provider@ollama` | Ollama (Local) | http://localhost:11434/v1/chat/completions |
| `provider@lmstudio` | LM Studio (Local) | http://localhost:1234/v1/chat/completions |

## Status Indicator Design

### Status Types

| Status | Icon | Color | Meaning |
|--------|------|-------|---------|
| Ready | `fa-check-circle` | Green | API key configured |
| Incomplete | `fa-exclamation-triangle` | Amber | API key required but not set |
| Local | `fa-server` | Blue | No API key needed |
| Wave Cloud | `fa-cloud` | Accent | Managed by Wave |

### Tooltip Content

**Incomplete Status:**
```
⚠️ API Key Required

This provider needs an API key to function.
Secret Name: OPENAI_KEY

[Set API Key in Secrets]
```

**Local Status:**
```
🔧 Local Provider

No API key required.
Make sure the local server is running at:
http://localhost:11434
```

## User Experience Flow

### Flow: Incomplete Provider - Adding API Key
1. User sees amber warning badge on "OpenAI GPT-4o"
2. User hovers: tooltip shows "API Key Required - Set OPENAI_KEY in Secrets"
3. User clicks badge or "Set API Key" link
4. User is navigated to Secrets tab
5. After adding key, user returns to AI Modes
6. Status automatically updates to green checkmark

### Flow: Using a Pre-filled Template
1. User clicks on "Anthropic Claude Sonnet" (pre-filled template)
2. Editor shows read-only view with "Template" badge
3. User clicks "Duplicate & Edit" button
4. New mode created as "Anthropic Claude Sonnet (Copy)"
5. User can now customize the duplicated mode

## State Management

### New Jotai Atoms

```typescript
// List of secret names from the secrets store
const secretNamesAtom = atom<string[]>([]);

// Computed status for each mode
const modeStatusMapAtom = atom<Record<string, ModeStatus>>((get) => {
    const secretNames = get(secretNamesAtom);
    const allModes = get(allModesAtom);
    return computeModeStatuses(allModes, new Set(secretNames));
});
```

### Status Computation Logic

```typescript
type ModeStatus = "ready" | "incomplete" | "local" | "cloud";

function computeModeStatus(
    modeKey: string,
    mode: AIModeConfigType,
    secretNames: Set<string>
): ModeStatus {
    // Wave Cloud modes are always ready
    if (modeKey.startsWith("waveai@")) {
        return "cloud";
    }

    // Check if it's a local provider
    const endpoint = mode["ai:endpoint"] || "";
    if (isLocalEndpoint(endpoint)) {
        return "local";
    }

    // Check if API key is required
    const secretName = mode["ai:apitokensecretname"];
    if (secretName) {
        return secretNames.has(secretName) ? "ready" : "incomplete";
    }

    return "ready";
}

function isLocalEndpoint(endpoint: string): boolean {
    if (!endpoint) return false;
    try {
        const url = new URL(endpoint);
        return url.hostname === "localhost" ||
               url.hostname === "127.0.0.1" ||
               url.hostname === "::1" ||
               url.hostname.endsWith(".local") ||
               url.hostname.startsWith("192.168.") ||
               url.hostname.startsWith("10.");
    } catch {
        return false;
    }
}
```

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `pkg/wconfig/defaultconfig/presets/aimodes.json` | CREATE | Pre-filled provider templates |
| `frontend/app/view/waveconfig/provider-status-badge.tsx` | CREATE | Status badge component |
| `frontend/app/view/waveconfig/waveaivisual.tsx` | MODIFY | Add secrets loading, status computation, grouping |
| `frontend/app/view/waveconfig/waveai-visual.scss` | MODIFY | Status badge styles |
| `frontend/app/view/waveconfig/waveconfig-model.ts` | MODIFY | Add `navigateToSecrets` method |

## Accessibility

- Status badge has `aria-label` describing status
- Example: `aria-label="Status: API key required for OPENAI_KEY"`
- Tooltip readable by screen readers via `role="tooltip"`
- Badges are keyboard-navigable (Tab, Enter/Space)

## Acceptance Criteria

- [ ] Pre-filled provider templates appear in AI modes sidebar
- [ ] Providers are grouped: Wave Cloud, Commercial, Local
- [ ] Each provider displays a status badge (checkmark/warning/server/cloud)
- [ ] Hovering over status badge shows tooltip with details
- [ ] Incomplete providers have "Set API Key in Secrets" link in tooltip
- [ ] Clicking link navigates to Secrets tab
- [ ] Status automatically updates when secrets are added/removed
- [ ] Pre-filled templates are read-only with "Template" badge
- [ ] "Duplicate & Edit" button creates editable copy of template
- [ ] Local providers show server icon and "No API key required" message
- [ ] Accessibility: all status indicators have proper aria-labels
- [ ] Error handling: graceful degradation if secrets API fails
