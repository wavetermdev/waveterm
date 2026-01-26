# Spec 003: Dynamic Theme Loading

**Date:** 2026-01-25
**Status:** Draft
**Dependencies:** Spec 001 (Configurator Embed)

---

## 1. Objective

Implement dynamic loading of the current OMP theme from `$POSH_THEME` into the configurator, parsing the config file and populating the editor state.

## 2. Theme Discovery Flow

```
User opens Appearance Panel
        ↓
OmpConfigurator component mounts
        ↓
Call OmpReadConfigCommand RPC
        ↓
Backend: GetOmpConfigPath()
    ├── Check $POSH_THEME env var
    ├── Check platform-specific defaults
    └── Return path or "not found"
        ↓
Backend: Read & parse config file
    ├── Detect format (JSON/YAML/TOML)
    ├── Parse to OmpConfig struct
    └── Return config + metadata
        ↓
Frontend: Populate editor state
    ├── Set originalConfig
    ├── Clone to editedConfig
    └── Render preview
```

## 3. Config Path Resolution

### 3.1 Path Priority (from `omputil.go`)

1. **$POSH_THEME** environment variable (highest priority)
2. Platform-specific defaults:

**Windows:**
```
%USERPROFILE%\.config\oh-my-posh\config.json
%USERPROFILE%\.config\oh-my-posh\config.yaml
%USERPROFILE%\.config\oh-my-posh\config.toml
%APPDATA%\oh-my-posh\config.json
%LOCALAPPDATA%\Programs\oh-my-posh\themes\custom.omp.json
```

**macOS/Linux:**
```
~/.config/oh-my-posh/config.json
~/.config/oh-my-posh/config.yaml
~/.config/oh-my-posh/config.toml
~/.oh-my-posh/config.json
```

### 3.2 Enhanced Path Resolution

For the configurator, we need to handle more cases:

```go
// pkg/wshutil/omputil.go

// GetOmpConfigPathExtended returns config path with additional info
func GetOmpConfigPathExtended() (*OmpConfigPathInfo, error) {
    info := &OmpConfigPathInfo{}

    // Check $POSH_THEME first
    poshTheme := os.Getenv("POSH_THEME")
    if poshTheme != "" {
        info.Source = "POSH_THEME"
        info.EnvValue = poshTheme

        if _, err := os.Stat(poshTheme); err == nil {
            if err := ValidateOmpConfigPath(poshTheme); err != nil {
                return nil, fmt.Errorf("invalid POSH_THEME path: %w", err)
            }
            info.Path = poshTheme
            info.Exists = true
            return info, nil
        }

        // $POSH_THEME set but file doesn't exist
        info.Path = poshTheme
        info.Exists = false
        info.Error = "File not found"
        return info, nil
    }

    // Try default paths
    info.Source = "default"
    defaultPaths := getDefaultPaths()

    for _, path := range defaultPaths {
        if _, err := os.Stat(path); err == nil {
            info.Path = path
            info.Exists = true
            return info, nil
        }
    }

    // No config found
    info.Error = "No OMP config found"
    return info, nil
}

type OmpConfigPathInfo struct {
    Path     string `json:"path"`
    Source   string `json:"source"`   // "POSH_THEME" or "default"
    EnvValue string `json:"envvalue,omitempty"`
    Exists   bool   `json:"exists"`
    Error    string `json:"error,omitempty"`
}
```

## 4. Config Parsing

### 4.1 JSON Config

OMP JSON configs follow this structure:

```json
{
  "$schema": "https://raw.githubusercontent.com/JanDeDobbeleer/oh-my-posh/main/themes/schema.json",
  "version": 2,
  "final_space": true,
  "console_title_template": "{{ .Shell }} in {{ .Folder }}",
  "palette": {
    "os": "#ACB0BE",
    "close": "p:os",
    "git-bg": "#4e9a06"
  },
  "blocks": [
    {
      "type": "prompt",
      "alignment": "left",
      "segments": [
        {
          "type": "os",
          "style": "diamond",
          "foreground": "#fff",
          "background": "p:os",
          "leading_diamond": "\ue0b6",
          "trailing_diamond": "\ue0b4",
          "template": " {{ if .WSL }}WSL at {{ end }}{{.Icon}} "
        }
      ]
    }
  ]
}
```

### 4.2 Extended OmpConfig Struct

```go
// pkg/wshutil/omputil.go

type OmpConfig struct {
    Schema                 string            `json:"$schema,omitempty"`
    Version                int               `json:"version,omitempty"`
    FinalSpace             bool              `json:"final_space,omitempty"`
    ConsoleTitleTemplate   string            `json:"console_title_template,omitempty"`
    Palette                map[string]string `json:"palette,omitempty"`
    Blocks                 []OmpBlock        `json:"blocks"`
    TransientPrompt        *OmpTransient     `json:"transient_prompt,omitempty"`
    ValidLine              *OmpSegment       `json:"valid_line,omitempty"`
    ErrorLine              *OmpSegment       `json:"error_line,omitempty"`
    SecondaryPrompt        *OmpSecondary     `json:"secondary_prompt,omitempty"`
    DebugPrompt            *OmpDebug         `json:"debug_prompt,omitempty"`
    Tooltips               []OmpTooltip      `json:"tooltips,omitempty"`
    CycleCacheEnabled      bool              `json:"cycle_cache_enabled,omitempty"`
    DisableCursorPositioning bool            `json:"disable_cursor_positioning,omitempty"`
    PatchPwshBleed         bool              `json:"patch_pwsh_bleed,omitempty"`
    UpgradeNotice          bool              `json:"upgrade_notice,omitempty"`
}

type OmpBlock struct {
    Type       string       `json:"type"`                 // "prompt" | "rprompt"
    Alignment  string       `json:"alignment"`            // "left" | "right"
    Segments   []OmpSegment `json:"segments"`
    Newline    bool         `json:"newline,omitempty"`
    Filler     string       `json:"filler,omitempty"`
    Overflow   string       `json:"overflow,omitempty"`   // "hidden" | "break"
}

type OmpSegment struct {
    Type                      string                 `json:"type"`
    Style                     string                 `json:"style"`                       // "plain" | "diamond" | "powerline" | "accordion"
    Foreground                string                 `json:"foreground,omitempty"`
    Background                string                 `json:"background,omitempty"`
    Template                  string                 `json:"template,omitempty"`
    Templates                 []string               `json:"templates,omitempty"`
    Properties                map[string]interface{} `json:"properties,omitempty"`
    LeadingDiamond            string                 `json:"leading_diamond,omitempty"`
    TrailingDiamond           string                 `json:"trailing_diamond,omitempty"`
    LeadingPowerlineSymbol    string                 `json:"leading_powerline_symbol,omitempty"`
    TrailingPowerlineSymbol   string                 `json:"trailing_powerline_symbol,omitempty"`
    InvertPowerline           bool                   `json:"invert_powerline,omitempty"`
    PowerlineSymbol           string                 `json:"powerline_symbol,omitempty"`
    Interactive               bool                   `json:"interactive,omitempty"`
    ForegroundTemplates       []string               `json:"foreground_templates,omitempty"`
    BackgroundTemplates       []string               `json:"background_templates,omitempty"`
    Alias                     string                 `json:"alias,omitempty"`
    MaxWidth                  int                    `json:"max_width,omitempty"`
    MinWidth                  int                    `json:"min_width,omitempty"`
    Cache                     *OmpCache              `json:"cache,omitempty"`
}

type OmpTooltip struct {
    Type       string                 `json:"type"`
    Tips       []string               `json:"tips"`
    Style      string                 `json:"style,omitempty"`
    Foreground string                 `json:"foreground,omitempty"`
    Background string                 `json:"background,omitempty"`
    Template   string                 `json:"template,omitempty"`
    Properties map[string]interface{} `json:"properties,omitempty"`
}

type OmpTransient struct {
    Foreground       string `json:"foreground,omitempty"`
    Background       string `json:"background,omitempty"`
    Template         string `json:"template,omitempty"`
    Filler           string `json:"filler,omitempty"`
    NewLine          bool   `json:"newline,omitempty"`
}

type OmpSecondary struct {
    Foreground string `json:"foreground,omitempty"`
    Background string `json:"background,omitempty"`
    Template   string `json:"template,omitempty"`
}

type OmpDebug struct {
    Foreground string `json:"foreground,omitempty"`
    Background string `json:"background,omitempty"`
    Template   string `json:"template,omitempty"`
}

type OmpCache struct {
    Duration string `json:"duration,omitempty"`  // e.g., "1h", "24h"
    Strategy string `json:"strategy,omitempty"`  // "folder", "session"
}
```

## 5. Frontend State Management

### 5.1 Config Store (Jotai)

```typescript
// frontend/app/element/settings/omp-configurator/omp-config-atoms.ts

import { atom } from "jotai";

export interface OmpConfigState {
    // Loading state
    loading: boolean;
    error: string | null;

    // Path info
    configPath: string | null;
    configSource: "POSH_THEME" | "default" | null;
    configExists: boolean;
    configFormat: "json" | "yaml" | "toml" | null;

    // Config data
    originalConfig: OmpConfig | null;
    editedConfig: OmpConfig | null;

    // Edit tracking
    hasChanges: boolean;

    // Selection state
    selectedBlockIndex: number;
    selectedSegmentIndex: number;
}

// Base atom
export const ompConfigStateAtom = atom<OmpConfigState>({
    loading: true,
    error: null,
    configPath: null,
    configSource: null,
    configExists: false,
    configFormat: null,
    originalConfig: null,
    editedConfig: null,
    hasChanges: false,
    selectedBlockIndex: 0,
    selectedSegmentIndex: 0,
});

// Derived atoms
export const ompIsLoadingAtom = atom((get) => get(ompConfigStateAtom).loading);
export const ompErrorAtom = atom((get) => get(ompConfigStateAtom).error);
export const ompHasConfigAtom = atom((get) => get(ompConfigStateAtom).configExists);
export const ompHasChangesAtom = atom((get) => get(ompConfigStateAtom).hasChanges);

// Selected block/segment
export const ompSelectedBlockAtom = atom((get) => {
    const state = get(ompConfigStateAtom);
    return state.editedConfig?.blocks?.[state.selectedBlockIndex] ?? null;
});

export const ompSelectedSegmentAtom = atom((get) => {
    const state = get(ompConfigStateAtom);
    const block = state.editedConfig?.blocks?.[state.selectedBlockIndex];
    return block?.segments?.[state.selectedSegmentIndex] ?? null;
});
```

### 5.2 Config Actions

```typescript
// frontend/app/element/settings/omp-configurator/omp-config-actions.ts

import { useSetAtom } from "jotai";
import { ompConfigStateAtom, OmpConfigState } from "./omp-config-atoms";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

export function useOmpConfigActions() {
    const setState = useSetAtom(ompConfigStateAtom);

    const loadConfig = async () => {
        setState(prev => ({ ...prev, loading: true, error: null }));

        try {
            const result = await RpcApi.OmpReadConfigCommand(TabRpcClient);

            if (result.error) {
                setState(prev => ({
                    ...prev,
                    loading: false,
                    error: result.error,
                    configPath: result.configpath,
                    configExists: false,
                }));
                return;
            }

            setState(prev => ({
                ...prev,
                loading: false,
                configPath: result.configpath,
                configSource: result.source as "POSH_THEME" | "default",
                configExists: true,
                configFormat: result.format as "json" | "yaml" | "toml",
                originalConfig: result.config,
                editedConfig: structuredClone(result.config),
                hasChanges: false,
            }));
        } catch (err) {
            setState(prev => ({
                ...prev,
                loading: false,
                error: String(err),
            }));
        }
    };

    const updateSegment = (blockIndex: number, segmentIndex: number, updates: Partial<OmpSegment>) => {
        setState(prev => {
            if (!prev.editedConfig) return prev;

            const newConfig = structuredClone(prev.editedConfig);
            const segment = newConfig.blocks[blockIndex]?.segments[segmentIndex];

            if (segment) {
                Object.assign(segment, updates);
            }

            return {
                ...prev,
                editedConfig: newConfig,
                hasChanges: true,
            };
        });
    };

    const updateBlock = (blockIndex: number, updates: Partial<OmpBlock>) => {
        setState(prev => {
            if (!prev.editedConfig) return prev;

            const newConfig = structuredClone(prev.editedConfig);
            const block = newConfig.blocks[blockIndex];

            if (block) {
                Object.assign(block, updates);
            }

            return {
                ...prev,
                editedConfig: newConfig,
                hasChanges: true,
            };
        });
    };

    const selectBlock = (index: number) => {
        setState(prev => ({
            ...prev,
            selectedBlockIndex: index,
            selectedSegmentIndex: 0,
        }));
    };

    const selectSegment = (blockIndex: number, segmentIndex: number) => {
        setState(prev => ({
            ...prev,
            selectedBlockIndex: blockIndex,
            selectedSegmentIndex: segmentIndex,
        }));
    };

    const discardChanges = () => {
        setState(prev => ({
            ...prev,
            editedConfig: structuredClone(prev.originalConfig),
            hasChanges: false,
            selectedBlockIndex: 0,
            selectedSegmentIndex: 0,
        }));
    };

    const saveConfig = async () => {
        // Implementation in spec-004
    };

    return {
        loadConfig,
        updateSegment,
        updateBlock,
        selectBlock,
        selectSegment,
        discardChanges,
        saveConfig,
    };
}
```

## 6. Palette Resolution

OMP configs can use palette references like `p:os` for colors.

```typescript
// frontend/app/element/settings/omp-configurator/palette-utils.ts

/**
 * Resolve a color value, which may be:
 * - A direct hex color: "#ff0000"
 * - A palette reference: "p:colorname"
 * - A transparent value: "transparent" or ""
 * - A named color: "red", "blue", etc.
 */
export function resolveColor(
    color: string | undefined,
    palette: Record<string, string> | undefined
): string {
    if (!color) return "";

    color = color.trim();

    // Transparent
    if (color === "" || color.toLowerCase() === "transparent") {
        return "transparent";
    }

    // Palette reference
    if (color.startsWith("p:")) {
        const paletteName = color.slice(2);
        const resolved = palette?.[paletteName];

        // Resolve recursively (palette can reference other palette entries)
        if (resolved) {
            return resolveColor(resolved, palette);
        }

        // Unresolved palette reference
        return color;
    }

    // Direct hex color
    if (color.startsWith("#")) {
        return color;
    }

    // Named colors - OMP supports CSS named colors
    const namedColors: Record<string, string> = {
        red: "#ff0000",
        green: "#00ff00",
        blue: "#0000ff",
        yellow: "#ffff00",
        cyan: "#00ffff",
        magenta: "#ff00ff",
        white: "#ffffff",
        black: "#000000",
        // ... add more as needed
    };

    return namedColors[color.toLowerCase()] || color;
}

/**
 * Check if a color value is a palette reference
 */
export function isPaletteReference(color: string): boolean {
    return color?.startsWith("p:") ?? false;
}

/**
 * Extract palette name from a reference
 */
export function getPaletteName(color: string): string | null {
    if (!isPaletteReference(color)) return null;
    return color.slice(2);
}
```

## 7. Error Handling

### 7.1 No Config Found

```tsx
const OmpNoConfig = () => (
    <div className="omp-no-config">
        <i className="fa fa-solid fa-terminal" />
        <div className="no-config-title">No Oh-My-Posh Configuration Found</div>
        <div className="no-config-message">
            To use the theme configurator, you need to set up Oh-My-Posh first.
            The configurator will load your theme from the $POSH_THEME environment variable.
        </div>
        <div className="no-config-actions">
            <a
                href="https://ohmyposh.dev/docs/installation/customize"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
            >
                <i className="fa fa-solid fa-external-link" />
                Setup Guide
            </a>
            <button className="btn-secondary" onClick={() => window.location.reload()}>
                <i className="fa fa-solid fa-rotate" />
                Refresh
            </button>
        </div>
    </div>
);
```

### 7.2 Config Parse Error

```tsx
const OmpParseError = ({ error, rawContent }: { error: string; rawContent?: string }) => (
    <div className="omp-error">
        <i className="fa fa-solid fa-circle-exclamation" />
        <div className="error-title">Failed to Parse Configuration</div>
        <div className="error-message">
            {error}
        </div>
        {rawContent && (
            <details className="raw-content">
                <summary>View Raw Content</summary>
                <pre>{rawContent}</pre>
            </details>
        )}
        <div className="error-action">
            <button className="btn-secondary" onClick={handleRetry}>
                <i className="fa fa-solid fa-rotate" />
                Retry
            </button>
        </div>
    </div>
);
```

### 7.3 YAML/TOML Config (Future)

For MVP, show a message that YAML/TOML editing is not yet supported:

```tsx
const OmpNonJsonConfig = ({ format, path }: { format: string; path: string }) => (
    <div className="omp-warning">
        <i className="fa fa-solid fa-info-circle" />
        <div className="warning-title">{format.toUpperCase()} Configuration Detected</div>
        <div className="warning-message">
            The visual configurator currently supports JSON configurations only.
            Your config at <code>{path}</code> is in {format.toUpperCase()} format.
        </div>
        <div className="warning-tip">
            <strong>Tip:</strong> You can convert your config to JSON using:
            <code>oh-my-posh config export --format json</code>
        </div>
    </div>
);
```

## 8. Segment Type Metadata

Import segment metadata from ohmyposh-configurator for rich editing:

```typescript
// frontend/app/element/settings/omp-configurator/segment-metadata.ts

export interface SegmentMetadata {
    type: string;
    displayName: string;
    description: string;
    icon: string;  // FontAwesome class
    category: "system" | "languages" | "cloud" | "cli";
    properties: PropertyMetadata[];
}

export interface PropertyMetadata {
    name: string;
    type: "string" | "boolean" | "number" | "color" | "template" | "select";
    defaultValue?: any;
    description?: string;
    options?: string[];  // For select type
}

// Core segment types (subset for MVP)
export const SEGMENT_METADATA: SegmentMetadata[] = [
    {
        type: "os",
        displayName: "OS",
        description: "Current operating system",
        icon: "fa-solid fa-desktop",
        category: "system",
        properties: [
            { name: "windows_icon", type: "string", defaultValue: "\uf871" },
            { name: "macos_icon", type: "string", defaultValue: "\uf179" },
            { name: "linux_icon", type: "string", defaultValue: "\uf17c" },
        ],
    },
    {
        type: "path",
        displayName: "Path",
        description: "Current directory path",
        icon: "fa-solid fa-folder",
        category: "system",
        properties: [
            { name: "style", type: "select", options: ["full", "folder", "short", "letter", "unique"] },
            { name: "max_depth", type: "number", defaultValue: 3 },
            { name: "home_icon", type: "string", defaultValue: "~" },
        ],
    },
    {
        type: "git",
        displayName: "Git",
        description: "Git repository status",
        icon: "fa-brands fa-git-alt",
        category: "cli",
        properties: [
            { name: "branch_icon", type: "string", defaultValue: "\ue0a0" },
            { name: "fetch_status", type: "boolean", defaultValue: false },
            { name: "fetch_upstream_icon", type: "boolean", defaultValue: false },
        ],
    },
    {
        type: "session",
        displayName: "Session",
        description: "User and host information",
        icon: "fa-solid fa-user",
        category: "system",
        properties: [
            { name: "user_info_separator", type: "string", defaultValue: "@" },
            { name: "display_host", type: "boolean", defaultValue: true },
            { name: "display_user", type: "boolean", defaultValue: true },
        ],
    },
    {
        type: "time",
        displayName: "Time",
        description: "Current time",
        icon: "fa-solid fa-clock",
        category: "system",
        properties: [
            { name: "time_format", type: "string", defaultValue: "15:04:05" },
        ],
    },
    // ... more segments to be added
];

export function getSegmentMetadata(type: string): SegmentMetadata | undefined {
    return SEGMENT_METADATA.find(s => s.type === type);
}

export function getSegmentIcon(type: string): string {
    return getSegmentMetadata(type)?.icon ?? "fa-solid fa-puzzle-piece";
}

export function getSegmentDisplayName(type: string): string {
    return getSegmentMetadata(type)?.displayName ?? type;
}
```

## 9. Build Checklist

- [ ] Implement `OmpReadConfigCommand` RPC (backend)
- [ ] Add extended config types to `wshrpctypes.go`
- [ ] Create `omp-config-atoms.ts` with Jotai state
- [ ] Create `omp-config-actions.ts` with action hooks
- [ ] Create `palette-utils.ts` for color resolution
- [ ] Create `segment-metadata.ts` with type info
- [ ] Implement config loading in OmpConfigurator
- [ ] Add error states for missing/invalid config
- [ ] Add YAML/TOML detection with informative message
- [ ] Test with various OMP configs (simple, complex, with palette)

## 10. Testing Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| Valid JSON config | Load and display in editor |
| Valid YAML config | Show YAML not supported message |
| Valid TOML config | Show TOML not supported message |
| Config with palette | Resolve palette colors in preview |
| Missing $POSH_THEME | Show setup instructions |
| $POSH_THEME points to missing file | Show file not found error |
| Config with syntax error | Show parse error with raw content |
| Config with unknown segment types | Display segment with generic icon |
| Very large config (100+ segments) | Render without performance issues |
