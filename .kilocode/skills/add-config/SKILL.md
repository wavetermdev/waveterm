---
name: add-config
description: Guide for adding new configuration settings to Wave Terminal — define config schema, register defaults, add validation, and wire up frontend access. Use when adding a new setting to the configuration system, implementing a new config key, or adding user-customizable settings.
---

# Adding a New Configuration Setting to Wave Terminal

Settings cascade: defaults → user settings → connection config → block overrides.

Key files: `pkg/wconfig/settingsconfig.go` (Go structs), `pkg/wconfig/defaultconfig/settings.json` (defaults), `pkg/waveobj/wtypemeta.go` (block overrides), `docs/docs/config.mdx` (docs).

## Step-by-Step Guide

### Step 1: Add to Go Struct Definition

Edit `pkg/wconfig/settingsconfig.go` and add your new field to the `SettingsType` struct:

```go
type SettingsType struct {
    // ... existing fields ...

    // Add your new field with appropriate JSON tag
    MyNewSetting string `json:"mynew:setting,omitempty"`

    // For different types:
    MyBoolSetting   bool    `json:"mynew:boolsetting,omitempty"`
    MyNumberSetting float64 `json:"mynew:numbersetting,omitempty"`
    MyIntSetting    *int64  `json:"mynew:intsetting,omitempty"`    // Use pointer for optional ints
    MyArraySetting  []string `json:"mynew:arraysetting,omitempty"`
}
```

**Naming Conventions:**

- Use namespace prefixes (e.g., `term:`, `window:`, `ai:`, `web:`, `app:`)
- Use lowercase with colons as separators
- Field names should be descriptive and follow Go naming conventions
- Use `omitempty` tag to exclude empty values from JSON

**Type Guidelines:** Use `*int64`/`*float64` for optional numerics, `*bool` only if unset differs from false, `string` for text, `[]string` for arrays.

**Namespaces:** `app:*`, `term:*`, `window:*`, `ai:*`, `web:*`, `editor:*`, `conn:*`

### Step 1.5: Add to Block Metadata (Optional)

If your setting should support block-level overrides, also add it to `pkg/waveobj/wtypemeta.go`:

```go
type MetaTSType struct {
    // ... existing fields ...

    // Add your new field with matching JSON tag and type
    MyNewSetting *string `json:"mynew:setting,omitempty"`  // Use pointer for optional values

    // For different types:
    MyBoolSetting   *bool    `json:"mynew:boolsetting,omitempty"`
    MyNumberSetting *float64 `json:"mynew:numbersetting,omitempty"`
    MyIntSetting    *int     `json:"mynew:intsetting,omitempty"`
    MyArraySetting  []string `json:"mynew:arraysetting,omitempty"`
}
```

**Block Metadata Guidelines:**

- Use pointer types (`*string`, `*bool`, `*int`, `*float64`) for optional overrides
- JSON tags should exactly match the corresponding settings field
- This enables the hierarchical config system: block metadata → connection config → global settings
- Only add settings here that make sense to override per-block or per-connection

### Step 2: Set Default Value (Optional)

If your setting should have a default value, add it to `pkg/wconfig/defaultconfig/settings.json`:

```json
{
  "ai:preset": "ai@global",
  "ai:model": "gpt-5-mini",
  // ... existing defaults ...

  "mynew:setting": "default value",
  "mynew:boolsetting": true,
  "mynew:numbersetting": 42.5,
  "mynew:intsetting": 100
}
```

**Default Value Guidelines:**

- Only add defaults for settings that should have non-zero/non-empty initial values
- Ensure defaults make sense for typical user experience
- Keep defaults conservative and safe
- Boolean settings often don't need defaults if `false` is the correct default

### Step 3: Update Documentation

Add your new setting to the configuration table in `docs/docs/config.mdx`:

```markdown
| Key Name            | Type     | Function                                  |
| ------------------- | -------- | ----------------------------------------- |
| mynew:setting       | string   | Description of what this setting controls |
| mynew:boolsetting   | bool     | Enable/disable some feature               |
| mynew:numbersetting | float    | Numeric setting for some parameter        |
| mynew:intsetting    | int      | Integer setting for some configuration    |
| mynew:arraysetting  | string[] | Array of strings for multiple values      |
```

**Documentation Guidelines:**

- Provide clear, concise descriptions
- For new settings in upcoming releases, add `<VersionBadge version="v0.14" />`
- Update the default configuration example if you added defaults
- Explain what values are valid and what they do

### Step 4: Regenerate Schema and TypeScript Types

```bash
task generate
```

This regenerates the JSON schema from Go structs, TypeScript types in `frontend/types/gotypes.d.ts`, and RPC client APIs. Do not edit `schema/settings.json` manually — it is auto-generated.

### Step 5: Use in Frontend Code

Access your new setting in React components:

```typescript
import { getOverrideConfigAtom, getSettingsKeyAtom, useAtomValue } from "@/store/global";

// In a React component
const MyComponent = ({ blockId }: { blockId: string }) => {
    // Use override config atom for hierarchical resolution
    // This automatically checks: block metadata → connection config → global settings → default
    const mySettingAtom = getOverrideConfigAtom(blockId, "mynew:setting");
    const mySetting = useAtomValue(mySettingAtom) ?? "fallback value";

    // For global-only settings (no block overrides)
    const globalOnlySetting = useAtomValue(getSettingsKeyAtom("mynew:globalsetting")) ?? "fallback";

    return <div>Setting value: {mySetting}</div>;
};
```

**Frontend Configuration Patterns:**

```typescript
// 1. Settings with block-level overrides (recommended for most view/display settings)
const termFontSize = useAtomValue(getOverrideConfigAtom(blockId, "term:fontsize")) ?? 12;

// 2. Global-only settings (app-wide settings that don't vary by block)
const appGlobalHotkey = useAtomValue(getSettingsKeyAtom("app:globalhotkey")) ?? "";

// 3. Connection-specific settings
const connStatus = useAtomValue(getConnStatusAtom(connectionName));
```

**When to use each pattern:**

- Use `getOverrideConfigAtom()` for settings that can vary by block or connection (most UI/display settings)
- Use `getSettingsKeyAtom()` for app-level settings that are always global
- Always provide a fallback value with `??` operator

### Step 6: Use in Backend Code

Access settings in Go code:

```go
// Get the full config
fullConfig := wconfig.GetWatcher().GetFullConfig()

// Access your setting
myValue := fullConfig.Settings.MyNewSetting

// For optional values (pointers)
if fullConfig.Settings.MyIntSetting != nil {
    intValue := *fullConfig.Settings.MyIntSetting
    // Use intValue
}
```

## Complete Examples

### Example 1: Simple Boolean Setting (No Block Override)

**Use case:** Add a setting to hide the AI button globally

#### 1. Go Struct (`pkg/wconfig/settingsconfig.go`)

```go
type SettingsType struct {
    // ... existing fields ...
    AppHideAiButton bool `json:"app:hideaibutton,omitempty"`
}
```

#### 2. Default Value (`pkg/wconfig/defaultconfig/settings.json`)

```json
{
  "app:hideaibutton": false
}
```

#### 3. Documentation (`docs/docs/config.mdx`)

```markdown
| app:hideaibutton <VersionBadge version="v0.14" /> | bool | Hide the AI button in the tab bar (defaults to false) |
```

#### 4. Generate Types

```bash
task generate
```

#### 5. Frontend Usage

```typescript
import { getSettingsKeyAtom } from "@/store/global";

const TabBar = () => {
    const hideAiButton = useAtomValue(getSettingsKeyAtom("app:hideaibutton"));

    if (hideAiButton) {
        return null; // Don't render AI button
    }

    return <button>AI</button>;
};
```

#### 6. Usage Examples

```bash
# Set in settings file
wsh setconfig app:hideaibutton=true

# Or edit ~/.config/waveterm/settings.json
{
  "app:hideaibutton": true
}
```

### Example 2: Terminal Setting with Block Override

**Use case:** Add a terminal bell sound setting that can be overridden per block

#### 1. Go Struct (`pkg/wconfig/settingsconfig.go`)

```go
type SettingsType struct {
    // ... existing fields ...
    TermBellSound string `json:"term:bellsound,omitempty"`
}
```

#### 2. Block Metadata (`pkg/waveobj/wtypemeta.go`)

```go
type MetaTSType struct {
    // ... existing fields ...
    TermBellSound *string `json:"term:bellsound,omitempty"`  // Pointer for optional override
}
```

#### 3. Default Value (`pkg/wconfig/defaultconfig/settings.json`)

```json
{
  "term:bellsound": "default"
}
```

#### 4. Documentation (`docs/docs/config.mdx`)

```markdown
| term:bellsound <VersionBadge version="v0.14" /> | string | Sound to play for terminal bell ("default", "none", or custom sound file path) |
```

#### 5. Generate Types

```bash
task generate
```

#### 6. Frontend Usage

```typescript
import { getOverrideConfigAtom } from "@/store/global";

const TerminalView = ({ blockId }: { blockId: string }) => {
    // Use override config for hierarchical resolution
    const bellSoundAtom = getOverrideConfigAtom(blockId, "term:bellsound");
    const bellSound = useAtomValue(bellSoundAtom) ?? "default";

    const playBellSound = () => {
        if (bellSound === "none") return;
        // Play the bell sound
    };

    return <div>Terminal with bell: {bellSound}</div>;
};
```

#### 7. Usage Examples

```bash
# Set globally in settings file
wsh setconfig term:bellsound="custom.wav"

# Set for current block only
wsh setmeta term:bellsound="none"

# Set for specific block
wsh setmeta --block BLOCK_ID term:bellsound="beep"

# Or edit ~/.config/waveterm/settings.json
{
  "term:bellsound": "custom.wav"
}
```

## Configuration Patterns

### Clear/Reset Pattern

Each namespace can have a "clear" field for resetting all settings in that namespace:

```go
AppClear  bool `json:"app:*,omitempty"`
TermClear bool `json:"term:*,omitempty"`
```

### Optional vs Required Settings

- Use pointer types (`*bool`, `*int64`, `*float64`) for truly optional settings
- Use regular types for settings that should always have a value
- Provide sensible defaults for important settings

### Block-Level Overrides via RPC

Settings can be overridden at the block level using metadata:

```typescript
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS } from "@/store/global";

// Set block-specific override
await RpcApi.SetMetaCommand(TabRpcClient, {
  oref: WOS.makeORef("block", blockId),
  meta: { "mynew:setting": "block-specific value" },
});
```

## Quick Reference

When adding a new configuration setting:

- [ ] Add field to `SettingsType` in `pkg/wconfig/settingsconfig.go`
- [ ] Add field to `MetaTSType` in `pkg/waveobj/wtypemeta.go` (if block override needed)
- [ ] Add default to `pkg/wconfig/defaultconfig/settings.json` (if needed)
- [ ] Document in `docs/docs/config.mdx`
- [ ] Run `task generate` to update TypeScript types
- [ ] Use appropriate atom (`getOverrideConfigAtom` or `getSettingsKeyAtom`) in frontend

## Related Documentation

- **User Documentation**: `docs/docs/config.mdx` - User-facing configuration docs
- **Type Definitions**: `pkg/wconfig/settingsconfig.go` - Go struct definitions
- **Metadata Types**: `pkg/waveobj/wtypemeta.go` - Block metadata definitions
