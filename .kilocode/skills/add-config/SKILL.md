---
name: add-config
description: Guide for adding new configuration settings to Wave Terminal. Use when adding a new setting to the configuration system, implementing a new config key, or adding user-customizable settings.
---

# Adding a New Configuration Setting to Wave Terminal

This guide explains how to add a new configuration setting to Wave Terminal's hierarchical configuration system.

## Configuration System Overview

Wave Terminal uses a hierarchical configuration system with:

1. **Go Struct Definitions** - Type-safe configuration structure in [`pkg/wconfig/settingsconfig.go`](../../../pkg/wconfig/settingsconfig.go)
2. **JSON Schema** - Auto-generated validation schema in [`schema/settings.json`](../../../schema/settings.json)
3. **Default Values** - Built-in defaults in [`pkg/wconfig/defaultconfig/settings.json`](../../../pkg/wconfig/defaultconfig/settings.json)
4. **User Configuration** - User overrides in `~/.config/waveterm/settings.json`
5. **Block Metadata** - Block-level overrides in [`pkg/waveobj/wtypemeta.go`](../../../pkg/waveobj/wtypemeta.go)
6. **Documentation** - User-facing docs in [`docs/docs/config.mdx`](../../../docs/docs/config.mdx)

Settings cascade from defaults → user settings → connection config → block overrides.

## Step-by-Step Guide

### Step 1: Add to Go Struct Definition

Edit [`pkg/wconfig/settingsconfig.go`](../../../pkg/wconfig/settingsconfig.go) and add your new field to the `SettingsType` struct:

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

**Type Guidelines:**

- Use `*int64` and `*float64` for optional numeric values
- Use `*bool` for optional boolean values (or `bool` if default is false)
- Use `string` for text values
- Use `[]string` for arrays
- Use `float64` for numbers that can be decimals

**Namespace Organization:**

- `app:*` - Application-level settings
- `term:*` - Terminal-specific settings
- `window:*` - Window and UI settings
- `ai:*` - AI-related settings
- `web:*` - Web browser settings
- `editor:*` - Code editor settings
- `conn:*` - Connection settings

### Step 1.5: Add to Block Metadata (Optional)

If your setting should support block-level overrides, also add it to [`pkg/waveobj/wtypemeta.go`](../../../pkg/waveobj/wtypemeta.go):

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

If your setting should have a default value, add it to [`pkg/wconfig/defaultconfig/settings.json`](../../../pkg/wconfig/defaultconfig/settings.json):

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

Add your new setting to the configuration table in [`docs/docs/config.mdx`](../../../docs/docs/config.mdx):

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

Run the generate task to automatically regenerate the JSON schema and TypeScript types:

```bash
task generate
```

**What this does:**

- Runs `task build:schema` (automatically generates JSON schema from Go structs)
- Generates TypeScript type definitions in [`frontend/types/gotypes.d.ts`](../../../frontend/types/gotypes.d.ts)
- Generates RPC client APIs
- Generates metadata constants

**Important:** The JSON schema in [`schema/settings.json`](../../../schema/settings.json) is **automatically generated** from the Go struct definitions - you don't need to edit it manually.

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

#### 1. Go Struct ([`pkg/wconfig/settingsconfig.go`](../../../pkg/wconfig/settingsconfig.go))

```go
type SettingsType struct {
    // ... existing fields ...
    AppHideAiButton bool `json:"app:hideaibutton,omitempty"`
}
```

#### 2. Default Value ([`pkg/wconfig/defaultconfig/settings.json`](../../../pkg/wconfig/defaultconfig/settings.json))

```json
{
  "app:hideaibutton": false
}
```

#### 3. Documentation ([`docs/docs/config.mdx`](../../../docs/docs/config.mdx))

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

#### 1. Go Struct ([`pkg/wconfig/settingsconfig.go`](../../../pkg/wconfig/settingsconfig.go))

```go
type SettingsType struct {
    // ... existing fields ...
    TermBellSound string `json:"term:bellsound,omitempty"`
}
```

#### 2. Block Metadata ([`pkg/waveobj/wtypemeta.go`](../../../pkg/waveobj/wtypemeta.go))

```go
type MetaTSType struct {
    // ... existing fields ...
    TermBellSound *string `json:"term:bellsound,omitempty"`  // Pointer for optional override
}
```

#### 3. Default Value ([`pkg/wconfig/defaultconfig/settings.json`](../../../pkg/wconfig/defaultconfig/settings.json))

```json
{
  "term:bellsound": "default"
}
```

#### 4. Documentation ([`docs/docs/config.mdx`](../../../docs/docs/config.mdx))

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

## Common Pitfalls

### 1. Forgetting to Run `task generate`

**Problem:** TypeScript types not updated, schema out of sync

**Solution:** Always run `task generate` after modifying Go structs

### 2. Type Mismatch Between Settings and Metadata

**Problem:** Settings uses `string`, metadata uses `*int`

**Solution:** Ensure types match (except metadata uses pointers for optionals)

### 3. Not Providing Fallback Values

**Problem:** Component breaks if setting is undefined

**Solution:** Always use `??` operator with fallback:
```typescript
const value = useAtomValue(getSettingsKeyAtom("key")) ?? "default";
```

### 4. Using Wrong Config Atom

**Problem:** Using `getSettingsKeyAtom()` for settings that need block overrides

**Solution:** Use `getOverrideConfigAtom()` for any setting in `MetaTSType`

## Best Practices

### Naming

- **Use descriptive names**: `term:fontsize` not `term:fs`
- **Follow namespace conventions**: Group related settings with common prefix
- **Use consistent casing**: Always lowercase with colons

### Types

- **Use `bool`** for simple on/off settings (no pointer if false is default)
- **Use `*bool`** only if you need to distinguish unset from false
- **Use `*int64`/`*float64`** for optional numeric values
- **Use `string`** for text, paths, or enum-like values
- **Use `[]string`** for lists

### Defaults

- **Provide sensible defaults** for settings users will commonly change
- **Omit defaults** for advanced/optional settings
- **Keep defaults safe** - don't enable experimental features by default
- **Document defaults** clearly in config.mdx

### Block Overrides

- **Enable for view/display settings**: Font sizes, colors, themes, etc.
- **Don't enable for app-wide settings**: Global hotkeys, window behavior, etc.
- **Consider the use case**: Would a user want different values per block or connection?

### Documentation

- **Be specific**: Explain what the setting does and what values are valid
- **Provide examples**: Show common use cases
- **Add version badges**: Mark new settings with `<VersionBadge version="v0.x" />`
- **Keep it current**: Update docs when behavior changes

## Quick Reference

When adding a new configuration setting:

- [ ] Add field to `SettingsType` in [`pkg/wconfig/settingsconfig.go`](../../../pkg/wconfig/settingsconfig.go)
- [ ] Add field to `MetaTSType` in [`pkg/waveobj/wtypemeta.go`](../../../pkg/waveobj/wtypemeta.go) (if block override needed)
- [ ] Add default to [`pkg/wconfig/defaultconfig/settings.json`](../../../pkg/wconfig/defaultconfig/settings.json) (if needed)
- [ ] Document in [`docs/docs/config.mdx`](../../../docs/docs/config.mdx)
- [ ] Run `task generate` to update TypeScript types
- [ ] Use appropriate atom (`getOverrideConfigAtom` or `getSettingsKeyAtom`) in frontend

## Related Documentation

- **Configuration System Overview**: [`aiprompts/config-system.md`](../../../aiprompts/config-system.md) - Comprehensive documentation
- **Quick Adding Guide**: [`aiplans/new-config.md`](../../../aiplans/new-config.md) - Quick reference for adding settings
- **User Documentation**: [`docs/docs/config.mdx`](../../../docs/docs/config.mdx) - User-facing configuration docs
- **Type Definitions**: [`pkg/wconfig/settingsconfig.go`](../../../pkg/wconfig/settingsconfig.go) - Go struct definitions
- **Metadata Types**: [`pkg/waveobj/wtypemeta.go`](../../../pkg/waveobj/wtypemeta.go) - Block metadata definitions
