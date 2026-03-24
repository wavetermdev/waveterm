# Wave Terminal Configuration System

This document explains how Wave Terminal's configuration system works and provides step-by-step instructions for adding new configuration values.

## Overview

Wave Terminal uses a hierarchical configuration system with the following components:

1. **Go Struct Definitions** - Type-safe configuration structure in Go
2. **JSON Schema** - Validation schema for configuration files
3. **Default Values** - Built-in default configuration
4. **User Configuration** - User-customizable settings in `~/.config/waveterm/settings.json`
5. **Documentation** - User-facing documentation

## Configuration File Structure

Wave Terminal's configuration system is organized into several key directories and files:

```
waveterm/
├── pkg/wconfig/                          # Go configuration package
│   ├── settingsconfig.go                 # Main settings struct definitions
│   ├── defaultconfig/                    # Default configuration files
│   │   ├── settings.json                 # Default settings values
│   │   ├── termthemes.json              # Default terminal themes
│   │   ├── presets.json                 # Default background presets
│   │   └── widgets.json                 # Default widget configurations
│   └── ...                              # Other config-related Go files
├── schema/                               # JSON Schema definitions
│   ├── settings.json                     # Settings validation schema
│   └── ...                              # Other schema files
├── docs/docs/                           # User documentation
│   └── config.mdx                       # Configuration documentation
└── ~/.config/waveterm/                  # User config directory (runtime)
    ├── settings.json                    # User settings overrides
    ├── termthemes.json                  # User terminal themes
    ├── presets.json                     # User background presets
    ├── widgets.json                     # User widget configurations
    ├── bookmarks.json                   # Web bookmarks
    └── connections.json                 # SSH/remote connections
```

**Key Files:**

- **[`pkg/wconfig/settingsconfig.go`](pkg/wconfig/settingsconfig.go)** - Defines the `SettingsType` struct with all configuration fields
- **[`schema/settings.json`](schema/settings.json)** - JSON Schema for validation and type checking
- **[`pkg/wconfig/defaultconfig/settings.json`](pkg/wconfig/defaultconfig/settings.json)** - Default values for all settings
- **[`docs/docs/config.mdx`](docs/docs/config.mdx)** - User-facing documentation with descriptions and examples

## Configuration Architecture

### Configuration Hierarchy

1. **Built-in Defaults** (`pkg/wconfig/defaultconfig/settings.json`)
2. **User Settings** (`~/.config/waveterm/settings.json`)
3. **Block-level Overrides** (stored in block metadata)

Settings cascade from defaults → user settings → block overrides.

### Block-Level Metadata Override System

Wave Terminal supports block-level configuration overrides through the metadata system. This allows settings to be applied globally, per-connection, or per-block:

1. **Global Settings** (`~/.config/waveterm/settings.json`) - Apply to all blocks by default
2. **Connection Settings** (in connections config) - Apply to all blocks using a specific connection
3. **Block Metadata** - Override settings for individual blocks

**Key Files for Block Overrides:**

- **[`pkg/waveobj/wtypemeta.go`](pkg/waveobj/wtypemeta.go)** - Defines the `MetaTSType` struct for block-level metadata
- Block metadata fields should match the corresponding settings fields for consistency

**Frontend Usage:**

```typescript
// Use getOverrideConfigAtom for hierarchical config resolution
const settingValue = useAtomValue(getOverrideConfigAtom(blockId, "namespace:setting"));

// This automatically resolves in order: block metadata → connection config → global settings → default
```

**Setting Block Metadata:**

```bash
# Set for current block
wsh setmeta namespace:setting=value

# Set for specific block
wsh setmeta --block BLOCK_ID namespace:setting=value
```

## How to Add a New Configuration Value

Follow these steps to add a new configuration setting:

### Step 1: Add to Go Struct Definition

Edit [`pkg/wconfig/settingsconfig.go`](pkg/wconfig/settingsconfig.go) and add your new field to the `SettingsType` struct:

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

- Use namespace prefixes (e.g., `term:`, `window:`, `ai:`, `web:`)
- Use lowercase with colons as separators
- Field names should be descriptive and follow Go naming conventions
- Use `omitempty` tag to exclude empty values from JSON

**Type Guidelines:**

- Use `*int64` and `*float64` for optional numeric values
- Use `*bool` for optional boolean values
- Use `string` for text values
- Use `[]string` for arrays
- Use `float64` for numbers that can be decimals

### Step 1.5: Add to Block Metadata (Optional)

If your setting should support block-level overrides, also add it to [`pkg/waveobj/wtypemeta.go`](pkg/waveobj/wtypemeta.go):

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

### Step 2: Set Default Value (Optional)

If your setting should have a default value, add it to [`pkg/wconfig/defaultconfig/settings.json`](pkg/wconfig/defaultconfig/settings.json):

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
- Ensure defaults make sense for the typical user experience
- Keep defaults conservative and safe

### Step 3: Update Documentation

Add your new setting to the configuration table in [`docs/docs/config.mdx`](docs/docs/config.mdx):

```markdown
| Key Name            | Type     | Function                                  |
| ------------------- | -------- | ----------------------------------------- |
| mynew:setting       | string   | Description of what this setting controls |
| mynew:boolsetting   | bool     | Enable/disable some feature               |
| mynew:numbersetting | float    | Numeric setting for some parameter        |
| mynew:intsetting    | int      | Integer setting for some configuration    |
| mynew:arraysetting  | string[] | Array of strings for multiple values      |
```

Also update the default configuration example in the same file if you added defaults.

### Step 4: Regenerate Schema and TypeScript Types

Run the generate task to automatically regenerate the JSON schema and TypeScript types:

```bash
task generate
```

**What this does:**
- Runs `task build:schema` (automatically generates JSON schema from Go structs)
- Generates TypeScript type definitions in [`frontend/types/gotypes.d.ts`](frontend/types/gotypes.d.ts)
- Generates RPC client APIs
- Generates metadata constants

**Note:** The JSON schema in [`schema/settings.json`](schema/settings.json) is **automatically generated** from the Go struct definitions - you don't need to edit it manually.

### Step 5: Use in Frontend Code

Access your new setting in React components:

```typescript
import { getOverrideConfigAtom, useAtomValue } from "@/store/global";

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
// 1. Settings with block-level overrides (recommended)
const termFontSize = useAtomValue(getOverrideConfigAtom(blockId, "term:fontsize")) ?? 12;

// 2. Global-only settings
const appGlobalHotkey = useAtomValue(getSettingsKeyAtom("app:globalhotkey")) ?? "";

// 3. Connection-specific settings
const connStatus = useAtomValue(getConnStatusAtom(connectionName));
```

### Step 6: Use in Backend Code

Access settings in Go code:

```go
// Get the full config
fullConfig := wconfig.GetWatcher().GetFullConfig()

// Access your setting
myValue := fullConfig.Settings.MyNewSetting
```

## Configuration Patterns

### Namespace Organization

Settings are organized by namespace using colon separators:

- `app:*` - Application-level settings
- `term:*` - Terminal-specific settings
- `window:*` - Window and UI settings
- `ai:*` - AI-related settings
- `web:*` - Web browser settings
- `editor:*` - Code editor settings
- `conn:*` - Connection settings

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

### Block-Level Overrides

Settings can be overridden at the block level using metadata:

```typescript
// Set block-specific override
await RpcApi.SetMetaCommand(TabRpcClient, {
  oref: WOS.makeORef("block", blockId),
  meta: { "mynew:setting": "block-specific value" },
});
```

## Example: Adding a New Terminal Setting

Here's a complete example adding a new terminal setting `term:bellsound` with block-level override support:

### 1. Go Struct (settingsconfig.go)

```go
type SettingsType struct {
    // ... existing fields ...
    TermBellSound string `json:"term:bellsound,omitempty"`
}
```

### 2. Block Metadata (wtypemeta.go)

```go
type MetaTSType struct {
    // ... existing fields ...
    TermBellSound *string `json:"term:bellsound,omitempty"`  // Pointer for optional override
}
```

### 3. Default Value (defaultconfig/settings.json - optional)

```json
{
  "term:bellsound": "default"
}
```

### 4. Documentation (docs/config.mdx)

```markdown
| term:bellsound | string | Sound to play for terminal bell ("default", "none", or custom sound file path) |
```

### 5. Regenerate Types

```bash
task generate
```

### 6. Frontend Usage

```typescript
// Use override config for hierarchical resolution
const bellSoundAtom = getOverrideConfigAtom(blockId, "term:bellsound");
const bellSound = useAtomValue(bellSoundAtom) ?? "default";
```

### 7. Usage Examples

```bash
# Set globally
wsh setconfig term:bellsound="custom.wav"

# Set for current block only
wsh setmeta term:bellsound="none"

# Set for specific block
wsh setmeta --block BLOCK_ID term:bellsound="beep"
```

## Testing Your Configuration

1. **Build and run** Wave Terminal with your changes
2. **Test default behavior** - Ensure the default value works
3. **Test user override** - Add your setting to `~/.config/waveterm/settings.json`
4. **Test block override** - Set block-specific metadata
5. **Verify schema validation** - Ensure invalid values are rejected

## Common Pitfalls
