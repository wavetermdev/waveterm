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

### Step 2: Add to JSON Schema

Edit [`schema/settings.json`](schema/settings.json) and add your field to the `properties` section:

```json
{
  "$defs": {
    "SettingsType": {
      "properties": {
        // ... existing properties ...

        "mynew:setting": {
          "type": "string"
        },
        "mynew:boolsetting": {
          "type": "boolean"
        },
        "mynew:numbersetting": {
          "type": "number"
        },
        "mynew:intsetting": {
          "type": "integer"
        },
        "mynew:arraysetting": {
          "items": {
            "type": "string"
          },
          "type": "array"
        }
      }
    }
  }
}
```

**Schema Type Mapping:**

- Go `string` → JSON Schema `"string"`
- Go `bool` → JSON Schema `"boolean"`
- Go `float64` → JSON Schema `"number"`
- Go `int64` → JSON Schema `"integer"`
- Go `[]string` → JSON Schema `"array"` with `"items": {"type": "string"}`

### Step 3: Set Default Value (Optional)

If your setting should have a default value, add it to [`pkg/wconfig/defaultconfig/settings.json`](pkg/wconfig/defaultconfig/settings.json):

```json
{
  "ai:preset": "ai@global",
  "ai:model": "gpt-4o-mini",
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

### Step 4: Update Documentation

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

### Step 5: Regenerate Schema and TypeScript Types

Run the build tasks to regenerate schema and TypeScript types:

```bash
task build:schema
task generate
```

Or run them individually:
```bash
# Regenerate JSON schema
task build:schema

# Regenerate TypeScript types
go run cmd/generatets/main-generatets.go
```

This will update the schema files and [`frontend/types/gotypes.d.ts`](frontend/types/gotypes.d.ts) with your new settings.

### Step 6: Use in Frontend Code

Access your new setting in React components:

```typescript
import { useSettingsKeyAtom } from "@/app/store/global";

// In a React component
const MyComponent = () => {
    // Read global setting with fallback
    const mySetting = useSettingsKeyAtom("mynew:setting") ?? "fallback value";

    // For block-specific overrides
    const myBlockSetting = useOverrideConfigAtom(blockId, "mynew:setting") ?? "fallback";

    return <div>Setting value: {mySetting}</div>;
};
```

### Step 7: Use in Backend Code

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

Let's walk through adding a new terminal setting `term:bellsound`:

### 1. Go Struct (settingsconfig.go)

```go
type SettingsType struct {
    // ... existing fields ...
    TermBellSound string `json:"term:bellsound,omitempty"`
}
```

### 2. JSON Schema (schema/settings.json)

```json
{
  "properties": {
    "term:bellsound": {
      "type": "string"
    }
  }
}
```

### 3. Default Value (defaultconfig/settings.json)

```json
{
  "term:bellsound": "default"
}
```

### 4. Documentation (docs/config.mdx)

```markdown
| term:bellsound | string | Sound to play for terminal bell ("default", "none", or custom sound file path) |
```

### 5. Frontend Usage

```typescript
const bellSound = useOverrideConfigAtom(blockId, "term:bellsound") ?? "default";
```

## Testing Your Configuration

1. **Build and run** Wave Terminal with your changes
2. **Test default behavior** - Ensure the default value works
3. **Test user override** - Add your setting to `~/.config/waveterm/settings.json`
4. **Test block override** - Set block-specific metadata
5. **Verify schema validation** - Ensure invalid values are rejected

## Common Pitfalls
