# Wave AI Modes Configuration - Visual Editor Architecture

## Overview

Wave Terminal's AI modes configuration system allows users to define custom AI assistants with different providers, models, and capabilities. The configuration is stored in `~/.waveterm/config/waveai.json` and provides a flexible way to configure multiple AI modes that appear in the Wave AI panel.

**Key Design Decisions:**
- Visual editor works on **valid JSON only** - if JSON is invalid, fall back to JSON editor
- Default modes (`waveai@quick`, `waveai@balanced`, `waveai@deep`) are **read-only** in visual editor
- Edits modify the **in-memory JSON directly** - changes saved via existing save button
- Mode keys are **auto-generated** from provider + model or random ID (last 4-6 chars)
- Secrets use **fixed naming convention** per provider (e.g., `OPENAI_KEY`, `OPENROUTER_KEY`)
- Quick **inline secret editor** instead of complex secret management

## Current System Architecture

### Data Structure

**Location:** `pkg/wconfig/settingsconfig.go:264-284`

```go
type AIModeConfigType struct {
    // Display Configuration
    DisplayName        string   `json:"display:name"`         // Required
    DisplayOrder       float64  `json:"display:order,omitempty"`
    DisplayIcon        string   `json:"display:icon,omitempty"`
    DisplayShortDesc   string   `json:"display:shortdesc,omitempty"`
    DisplayDescription string   `json:"display:description,omitempty"`
    
    // Provider & Model
    Provider           string   `json:"ai:provider,omitempty"`     // wave, google, openrouter, openai, azure, azure-legacy, custom
    APIType            string   `json:"ai:apitype"`                // Required: anthropic-messages, openai-responses, openai-chat
    Model              string   `json:"ai:model"`                  // Required
    
    // AI Behavior
    ThinkingLevel      string   `json:"ai:thinkinglevel,omitempty"` // low, medium, high
    Capabilities       []string `json:"ai:capabilities,omitempty"`  // pdfs, images, tools
    
    // Connection Details
    Endpoint           string   `json:"ai:endpoint,omitempty"`
    APIVersion         string   `json:"ai:apiversion,omitempty"`
    APIToken           string   `json:"ai:apitoken,omitempty"`
    APITokenSecretName string   `json:"ai:apitokensecretname,omitempty"`
    
    // Azure-Specific
    AzureResourceName  string   `json:"ai:azureresourcename,omitempty"`
    AzureDeployment    string   `json:"ai:azuredeployment,omitempty"`
    
    // Wave AI Specific
    WaveAICloud        bool     `json:"waveai:cloud,omitempty"`
    WaveAIPremium      bool     `json:"waveai:premium,omitempty"`
}
```

**Storage:** `FullConfigType.WaveAIModes` - `map[string]AIModeConfigType`

Keys follow pattern: `provider@modename` (e.g., `waveai@quick`, `openai@gpt4`)

### Provider Types & Defaults

**Defined in:** `pkg/aiusechat/uctypes/uctypes.go:27-35`

1. **wave** - Wave AI Cloud service
   - Auto-sets: `waveai:cloud = true`, endpoint from env or default
   - Default endpoint: `https://cfapi.waveterm.dev/api/waveai`
   - Used for Wave's hosted AI modes

2. **openai** - OpenAI API
   - Auto-sets: endpoint `https://api.openai.com/v1`
   - Auto-detects API type based on model:
     - Legacy models (gpt-4o, gpt-3.5): `openai-chat`
     - New models (gpt-5*, gpt-4.1*, o1*, o3*): `openai-responses`

3. **openrouter** - OpenRouter service
   - Auto-sets: endpoint `https://openrouter.ai/api/v1`, API type `openai-chat`

4. **google** - Google AI (Gemini, etc.)
   - No auto-defaults currently

5. **azure** - Azure OpenAI (new unified API)
   - Auto-sets: API version `v1`, endpoint from resource name
   - Endpoint pattern: `https://{resource}.openai.azure.com/openai/v1/{responses|chat/completions}`
   - Auto-detects API type based on model

6. **azure-legacy** - Azure OpenAI (legacy chat completions)
   - Auto-sets: API version `2025-04-01-preview`, API type `openai-chat`
   - Endpoint pattern: `https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version={version}`
   - Requires `AzureResourceName` and `AzureDeployment`

7. **custom** - Custom provider
   - No auto-defaults
   - User must specify all fields manually

### Default Configuration

**Location:** `pkg/wconfig/defaultconfig/waveai.json`

Ships with three Wave AI modes:
- `waveai@quick` - Fast responses (gpt-5-mini, low thinking)
- `waveai@balanced` - Balanced (gpt-5.1, low thinking) [premium]
- `waveai@deep` - Maximum capability (gpt-5.1, medium thinking) [premium]

### Current UI State

**Location:** `frontend/app/view/waveconfig/waveaivisual.tsx`

Currently shows placeholder: "Visual editor coming soon..."

The component receives:
- `model: WaveConfigViewModel` - Access to config file operations
- Existing patterns from `SecretsContent` for list/detail views

## Visual Editor Design Plan

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Wave AI Modes Configuration                            │
│  ┌───────────────┐  ┌──────────────────────────────┐   │
│  │               │  │                              │   │
│  │  Mode List    │  │    Mode Editor/Viewer        │   │
│  │               │  │                              │   │
│  │  [Quick]      │  │  Provider: [wave ▼]         │   │
│  │  [Balanced]   │  │                              │   │
│  │  [Deep]       │  │  Display Configuration       │   │
│  │  [Custom]     │  │  ├─ Name: ...                │   │
│  │               │  │  ├─ Icon: ...                │   │
│  │  [+ Add New]  │  │  └─ Description: ...         │   │
│  │               │  │                              │   │
│  │               │  │  Provider Configuration      │   │
│  │               │  │  (Provider-specific fields)  │   │
│  │               │  │                              │   │
│  │               │  │  [Save] [Delete] [Cancel]    │   │
│  └───────────────┘  └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Component Structure

```typescript
WaveAIVisualContent
├─ ModeList (left panel)
│  ├─ Header with "Add New Mode" button
│  ├─ List of existing modes (sorted by display:order)
│  │  └─ ModeListItem (icon, name, short desc, provider badge)
│  └─ Empty state if no modes
│
└─ ModeEditor (right panel)
   ├─ Provider selector dropdown (when creating/editing)
   ├─ Display section (common to all providers)
   │  ├─ Name input (required)
   │  ├─ Icon picker (optional)
   │  ├─ Display order (optional, number)
   │  ├─ Short description (optional)
   │  └─ Description textarea (optional)
   │
   ├─ Provider Configuration section (dynamic based on provider)
   │  └─ [Provider-specific form fields]
   │
   └─ Action buttons (Save, Delete, Cancel)
```

### Provider-Specific Form Fields

#### 1. Wave Provider (`wave`)
**Read-only/Auto-managed:**
- Endpoint (shows default or env override)
- Cloud flag (always true)
- Secret: Not applicable (managed by Wave)

**User-configurable:**
- Model (required, text input with suggestions: gpt-5-mini, gpt-5.1)
- API Type (required, dropdown: openai-responses, openai-chat)
- Thinking Level (optional, dropdown: low, medium, high)
- Capabilities (optional, checkboxes: tools, images, pdfs)
- Premium flag (checkbox)

#### 2. OpenAI Provider (`openai`)
**Auto-managed:**
- Endpoint (shows: api.openai.com/v1)
- API Type (auto-detected from model, editable)
- Secret Name: Fixed as `OPENAI_KEY`

**User-configurable:**
- Model (required, text input with suggestions: gpt-4o, gpt-5-mini, gpt-5.1, o1-preview)
- API Key (via secret modal - see Secret Management below)
- Thinking Level (optional)
- Capabilities (optional)

#### 3. OpenRouter Provider (`openrouter`)
**Auto-managed:**
- Endpoint (shows: openrouter.ai/api/v1)
- API Type (always openai-chat)
- Secret Name: Fixed as `OPENROUTER_KEY`

**User-configurable:**
- Model (required, text input - OpenRouter model format)
- API Key (via secret modal)
- Thinking Level (optional)
- Capabilities (optional)

#### 4. Azure Provider (`azure`)
**Auto-managed:**
- API Version (always v1)
- Endpoint (computed from resource name)
- API Type (auto-detected from model)
- Secret Name: Fixed as `AZURE_KEY`

**User-configurable:**
- Azure Resource Name (required, validated format)
- Model (required)
- API Key (via secret modal)
- Thinking Level (optional)
- Capabilities (optional)

#### 5. Azure Legacy Provider (`azure-legacy`)
**Auto-managed:**
- API Version (default: 2025-04-01-preview, editable)
- API Type (always openai-chat)
- Endpoint (computed from resource + deployment + version)
- Secret Name: Fixed as `AZURE_KEY`

**User-configurable:**
- Azure Resource Name (required, validated)
- Azure Deployment (required)
- Model (required)
- API Key (via secret modal)
- Thinking Level (optional)
- Capabilities (optional)

#### 6. Google Provider (`google`)
**Auto-managed:**
- Secret Name: Fixed as `GOOGLE_KEY`

**User-configurable:**
- Model (required)
- API Type (required dropdown)
- Endpoint (required)
- API Key (via secret modal)
- API Version (optional)
- Thinking Level (optional)
- Capabilities (optional)

#### 7. Custom Provider (`custom`)
**User must specify everything:**
- Model (required)
- API Type (required dropdown)
- Endpoint (required)
- Secret Name (required text input - user defines their own secret name)
- API Key (via secret modal using custom secret name)
- API Version (optional)
- Thinking Level (optional)
- Capabilities (optional)
- Azure Resource Name (optional)
- Azure Deployment (optional)

### Data Flow

```
Load JSON → Parse → Render Visual Editor
              ↓
      User Edits Mode → Update fileContentAtom (JSON string)
              ↓
      Click Save → Existing save logic validates & writes
```

**Simplified Operations:**
1. **Load:** Parse `fileContentAtom` JSON string into mode objects for display
2. **Edit Mode:** Update parsed object → stringify → set `fileContentAtom` → marks as edited
3. **Add Mode:**
   - Generate unique key from provider/model or random ID
   - Add new mode to parsed object → stringify → set `fileContentAtom`
4. **Delete Mode:** Remove key from parsed object → stringify → set `fileContentAtom`
5. **Save:** Existing `model.saveFile()` handles validation and write

**Mode Key Generation:**
```typescript
function generateModeKey(provider: string, model: string): string {
    // Try semantic key first: provider@model-sanitized
    const sanitized = model.toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    const semanticKey = `${provider}@${sanitized}`;
    
    // Check for collision, if exists append random suffix
    if (existingModes[semanticKey]) {
        const randomId = crypto.randomUUID().slice(-6);
        return `${provider}@${sanitized}-${randomId}`;
    }
    return semanticKey;
}
// Examples: openai@gpt-4o, openrouter@claude-3-5-sonnet, azure@custom-fb4a2c
```

**Secret Naming Convention:**
```typescript
// Fixed secret names per provider (except custom)
const SECRET_NAMES = {
    openai: "OPENAI_KEY",
    openrouter: "OPENROUTER_KEY",
    azure: "AZURE_KEY",
    "azure-legacy": "AZURE_KEY",
    google: "GOOGLE_KEY",
    // custom provider: user specifies their own secret name
} as const;

function getSecretName(provider: string, customSecretName?: string): string {
    if (provider === "custom") {
        return customSecretName || "CUSTOM_API_KEY";
    }
    return SECRET_NAMES[provider];
}
```

### Secret Management UI

**Secret Status Indicator:**
Display next to API Key field for providers that need one:
- ✅ Green check icon: Secret exists and is set
- ⚠️ Warning icon (yellow/orange): Secret not set or empty
- Click icon to open secret modal

**Secret Modal:**
```
┌─────────────────────────────────────┐
│  Set API Key for OpenAI             │
│                                     │
│  Secret Name: OPENAI_KEY            │
│  [read-only for non-custom]         │
│                                     │
│  API Key:                           │
│  [********************]  [Show/Hide]│
│                                     │
│  [Cancel]              [Save]       │
└─────────────────────────────────────┘
```

**Modal Behavior:**
1. **Open Modal:** Click status icon or "Set API Key" button
2. **Show Secret Name:**
   - Non-custom providers: Read-only, shows fixed name
   - Custom provider: Editable text input (user specifies)
3. **API Key Input:**
   - Masked password field
   - Show/Hide toggle button
   - Load existing value if secret already exists
4. **Save:**
   - Validates not empty
   - Calls RPC to set secret
   - Updates status icon
5. **Cancel:** Close without changes

**Integration with Mode Editor:**
- Check secret existence on mode load/select
- Update icon based on RPC `GetSecretsCommand` result
- "Save" button for mode only saves JSON config
- Secret is set immediately via modal (separate from JSON save)

### Key Features

#### 1. Mode List
- Display modes sorted by `display:order` (ascending)
- Show icon, name, short description
- Badge showing provider type
- Highlight Wave AI premium modes
- Click to edit

#### 2. Add New Mode Flow
1. Click "Add New Mode"
2. Enter mode key (validated: alphanumeric, @, -, ., _)
3. Select provider from dropdown
4. Form dynamically updates to show provider-specific fields
5. Fill required fields (marked with *)
6. Save → validates → adds to config → refreshes list

#### 3. Edit Mode Flow
1. Click mode from list
2. Load mode data into form
3. Provider is fixed (show read-only or with warning about changing)
4. Edit fields
5. Save → validates → updates config → refreshes list

**Raw JSON Editor Option:**
- "Edit Raw JSON" button in mode editor (available for all modes)
- Opens modal with Monaco editor showing just this mode's JSON
- Validates JSON structure before allowing save
- Useful for:
  - Modes without a provider field (edge cases)
  - Advanced users who want precise control
  - Copying/modifying complex configurations
- Validation checks:
  - Valid JSON syntax
  - Required fields present (`display:name`, `ai:apitype`, `ai:model`)
  - Enum values valid
  - Custom error messages for each validation failure

#### 4. Delete Mode Flow
1. Click mode from list
2. Delete button in editor
3. Confirm dialog
4. Remove from config → save → refresh list

#### 5. Secret Integration
- For API Token fields, provide two options:
  - Direct input (text field, masked)
  - Secret reference (dropdown of existing secrets + link to secrets page)
- When secret is selected, store name in `ai:apitokensecretname`
- When direct token, store in `ai:apitoken`

#### 6. Validation
- **Mode Key:** Must match pattern `^[a-zA-Z0-9_@.-]+$`
- **Required Fields:** `display:name`, `ai:apitype`, `ai:model`
- **Azure Resource Name:** Must match `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` (1-63 chars)
- **Provider:** Must be one of the valid enum values
- **API Type:** Must be valid enum value
- **Thinking Level:** Must be low/medium/high if present
- **Capabilities:** Must be from valid enum (pdfs, images, tools)

#### 7. Smart Defaults
When provider changes or model changes:
- Show info about what will be auto-configured
- Display computed endpoint (read-only with info icon)
- Display auto-detected API type (editable with warning)
- Pre-fill common values based on provider

### UI Components Needed

#### New Components
```typescript
// Main container
WaveAIVisualContent

// Left panel
ModeList
├─ ModeListItem (icon, name, provider badge, premium badge, drag handle)
└─ AddModeButton

// Right panel - viewer
ModeViewer
├─ ModeHeader (name, icon, actions)
├─ DisplaySection (read-only view of display fields)
├─ ProviderSection (read-only view of provider config)
└─ EditButton

// Right panel - editor
ModeEditor
├─ ProviderSelector (dropdown, only for new modes)
├─ DisplayFieldsForm
├─ ProviderFieldsForm (dynamic based on provider)
│   ├─ WaveProviderForm
│   ├─ OpenAIProviderForm
│   ├─ OpenRouterProviderForm
│   ├─ AzureProviderForm
│   ├─ AzureLegacyProviderForm
│   ├─ GoogleProviderForm
│   └─ CustomProviderForm
└─ ActionButtons (Edit Raw JSON, Delete, Cancel)

// Modals
RawJSONModal
├─ Title ("Edit Raw JSON: {mode name}")
├─ MonacoEditor (JSON, single mode object)
├─ ValidationErrors (inline display)
└─ Actions (Cancel, Save)

// Shared components
SecretSelector (dropdown + link to secrets)
InfoTooltip (explains auto-configured fields)
ProviderBadge (visual indicator)
IconPicker (select from available icons)
DragHandle (for reordering modes in list)
```

**Drag & Drop for Reordering:**
```typescript
// Reordering updates display:order automatically
function handleModeReorder(draggedKey: string, targetKey: string) {
    const modes = parseAIModes(fileContent);
    const modesList = Object.entries(modes)
        .sort((a, b) => (a[1]["display:order"] || 0) - (b[1]["display:order"] || 0));
    
    // Find indices
    const draggedIndex = modesList.findIndex(([k]) => k === draggedKey);
    const targetIndex = modesList.findIndex(([k]) => k === targetKey);
    
    // Recalculate display:order for all modes
    const newOrder = [...modesList];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, modesList[draggedIndex]);
    
    // Assign new order values (0, 10, 20, 30...)
    newOrder.forEach(([key, mode], index) => {
        modes[key] = { ...mode, "display:order": index * 10 };
    });
    
    updateFileContent(JSON.stringify(modes, null, 2));
}
```

### Model Extensions (Minimal)

**No new atoms needed!** Visual editor uses existing `fileContentAtom`:

```typescript
// Use existing atoms from WaveConfigViewModel:
// - fileContentAtom (contains JSON string)
// - hasEditedAtom (tracks if modified)
// - errorMessageAtom (for errors)

// Visual editor parses fileContentAtom on render:
function parseAIModes(jsonString: string): Record<string, AIModeConfigType> | null {
    try {
        return JSON.parse(jsonString);
    } catch {
        return null; // Show "invalid JSON" error
    }
}

// Updates modify fileContentAtom:
function updateMode(key: string, mode: AIModeConfigType) {
    const modes = parseAIModes(globalStore.get(model.fileContentAtom));
    if (!modes) return;
    
    modes[key] = mode;
    const newJson = JSON.stringify(modes, null, 2);
    globalStore.set(model.fileContentAtom, newJson);
    globalStore.set(model.hasEditedAtom, true);
}

// Secrets use existing model methods:
// - model.refreshSecrets() - already exists
// - RpcApi.GetSecretsCommand() - check if secret exists
// - RpcApi.SetSecretsCommand() - set secret value
```

**Component State (useState):**
```typescript
// In WaveAIVisualContent component:
const [selectedModeKey, setSelectedModeKey] = useState<string | null>(null);
const [isAddingMode, setIsAddingMode] = useState(false);
const [showSecretModal, setShowSecretModal] = useState(false);
const [secretModalProvider, setSecretModalProvider] = useState<string>("");
```

### Implementation Phases

#### Phase 1: Foundation & List View
- Parse `fileContentAtom` JSON into modes on render
- Display mode list (left panel, ~300px)
  - Built-in modes with 🔒 icon at top
  - Custom modes below
  - Sort by `display:order`
- Select mode → show in right panel (empty state initially)
- Handle invalid JSON → show error, switch to JSON tab

#### Phase 2: Built-in Mode Viewer
- Click built-in mode → show read-only details
- Display all fields (display, provider, config)
- "Built-in Mode" badge/banner
- No edit/delete buttons

#### Phase 3: Custom Mode Editor (Basic)
- Click custom mode → load into editor form
- Display fields (name, icon, order, description)
- Provider field (read-only, badge)
- Model field (text input)
- Save → update `fileContentAtom` JSON
- Cancel → revert to previous selection

#### Phase 4: Provider-Specific Fields
- Dynamic form based on provider type
- OpenAI: model, thinking level, capabilities
- Azure: resource name, model, thinking, capabilities
- Azure Legacy: resource name, deployment, model
- OpenRouter: model
- Google: model, API type, endpoint
- Custom: everything manual
- Info tooltips for auto-configured fields

#### Phase 5: Secret Integration
- Check secret existence on mode select
- Display status icon (✅ / ⚠️)
- Click icon → open secret modal
- Secret modal: fixed name (or custom input), password field
- Save secret → immediate RPC call
- Update status icon after save

#### Phase 6: Add New Mode
- "Add New Mode" button
- Provider dropdown selector
- Auto-generate mode key from provider + model
- Form with provider-specific fields
- Add to modes → update JSON → mark edited
- Select newly created mode

#### Phase 7: Delete Mode
- Delete button for custom modes only
- Simple confirmation dialog
- Remove from modes → update JSON → deselect

#### Phase 8: Raw JSON Editor
- "Edit Raw JSON" button in mode editor (all modes)
- Modal with Monaco editor for single mode
- JSON validation before save:
  - Syntax check with error highlighting
  - Required fields check (`display:name`, `ai:apitype`, `ai:model`)
  - Enum validation (provider, apitype, thinkinglevel, capabilities)
  - Display specific error messages per validation failure
- Parse validated JSON and update mode in main JSON
- Useful for edge cases (modes without provider) and power users

#### Phase 9: Drag & Drop Reordering
- Add drag handle icon to custom mode list items
- Implement drag & drop functionality:
  - Visual feedback during drag (opacity, cursor)
  - Drop target highlighting
  - Smooth reordering animation
- On drop:
  - Recalculate `display:order` for all affected modes
  - Use spacing (0, 10, 20, 30...) for easy manual adjustment
  - Update JSON with new order values
  - Built-in modes always stay at top (negative order values)

#### Phase 10: Polish & UX Refinements
- Field validation with inline error messages
- Empty state when no mode selected
- Icon picker dropdown (Font Awesome icons)
- Capabilities checkboxes with descriptions
- Thinking level dropdown with explanations
- Help tooltips throughout
- Keyboard shortcuts (e.g., Ctrl/Cmd+E for raw JSON)
- Loading states for secret checks
- Smooth transitions and animations

#### Phase 8: Raw JSON Editor
- "Edit Raw JSON" button in mode editor
- Modal with Monaco editor for single mode
- JSON validation before save:
  - Syntax check
  - Required fields check
  - Enum validation
  - Display specific error messages
- Parse and update mode in main JSON

#### Phase 9: Drag & Drop Reordering
- Make mode list items draggable (custom modes only)
- Visual feedback during drag (drag handle icon)
- Drop target highlighting
- On drop:
  - Calculate new `display:order` values
  - Maintain spacing between modes
  - Update all affected modes in JSON
  - Preserve built-in modes at top

#### Phase 10: Polish & UX Refinements
- Field validation (required, format)
- Error messages inline
- Empty state when no mode selected
- Icon picker dropdown
- Capabilities checkboxes
- Thinking level dropdown
- Help tooltips throughout
- Keyboard shortcuts (e.g., Cmd+E for raw JSON)

### Technical Considerations

1. **JSON Sync:** Parse/stringify from `fileContentAtom` on every read/write
2. **Validation:** Validate on blur or before updating JSON
3. **Built-in Detection:** Check if key starts with `waveai@` → read-only
4. **Type Safety:** Use `AIModeConfigType` from gotypes.d.ts
5. **State Management:**
   - Model atoms for shared state (`fileContentAtom`, `hasEditedAtom`)
   - Component useState for UI state (selected mode, modals)
6. **Error Handling:**
   - Invalid JSON → show message, disable visual editor
   - Parse errors → gracefully handle, don't crash
7. **Performance:**
   - Parse JSON on mount and when `fileContentAtom` changes externally
   - Debounce frequent updates if needed
8. **Secret Checks:**
   - Load secret existence on mode select
   - Cache results to avoid repeated RPC calls

### Testing Strategy

1. **Unit Tests:** Validation functions, key generation
2. **Integration Tests:** Form submission, backend sync
3. **E2E Tests:** Full add/edit/delete flows
4. **Provider Tests:** Each provider form with various inputs
5. **Edge Cases:** Empty config, invalid JSON, malformed data

### Documentation Needs

1. **In-app help:** Tooltips and info bubbles explaining fields
2. **Provider guides:** What each provider needs, where to get API keys
3. **Examples:** Show example configurations for common setups
4. **Troubleshooting:** Common errors and solutions

## Next Steps

1. Create detailed mockups/wireframes
2. Implement Phase 1 (basic list view)
3. Add RPC methods if needed for secrets integration
4. Iterate on provider forms
5. Polish and ship

This design provides a user-friendly way to configure AI modes without directly editing JSON, while still maintaining the power and flexibility of the underlying system.