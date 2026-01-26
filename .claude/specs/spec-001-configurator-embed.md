# Spec 001: Embedding the OMP Configurator Component

**Date:** 2026-01-25
**Status:** Draft
**Dependencies:** Discovery report complete

---

## 1. Objective

Embed the OMP Theme Configurator into Wave Terminal's Appearance Panel as a new collapsible section within the existing "Oh-My-Posh Integration" area.

## 2. Current State

The Appearance Panel (`appearance-content.tsx`) currently has:
```
- UI Theme (CollapsibleSection)
- Terminal Color Scheme (CollapsibleSection)
- Oh-My-Posh Integration (CollapsibleSection)
    - PreviewBackgroundToggle
    - OmpThemeControl (theme grid)
    - OmpHighContrast (transparency warning)
    - OmpPaletteExport (export terminal colors)
- Tab Backgrounds (CollapsibleSection)
```

## 3. Target State

```
- Oh-My-Posh Integration (CollapsibleSection)
    - PreviewBackgroundToggle
    - OmpThemeControl (theme grid - select base theme)
    - OmpHighContrast (transparency warning)
    - OmpPaletteExport (export terminal colors)
    - Section Divider
    - OmpConfigurator (NEW - edit current theme)
        - Config Preview Panel
        - Block/Segment Editor
        - [Save] [Cancel] buttons
        - Advanced Options (collapsed)
            - Import Config
            - Export/Copy Config
            - Share Link (future)
```

## 4. Component Architecture

### 4.1 New Components

```
frontend/app/element/settings/
├── omp-configurator/
│   ├── omp-configurator.tsx          # Main container
│   ├── omp-configurator.scss         # Styles
│   ├── omp-config-preview.tsx        # Rendered preview
│   ├── omp-block-editor.tsx          # Block list
│   ├── omp-segment-editor.tsx        # Segment properties
│   ├── omp-segment-picker.tsx        # Add new segments
│   └── index.ts                      # Exports
```

### 4.2 OmpConfigurator Component

```typescript
// frontend/app/element/settings/omp-configurator/omp-configurator.tsx

interface OmpConfiguratorProps {
    previewBackground: PreviewBackground;
    onConfigChange?: () => void;  // Notify parent of changes
}

interface OmpConfiguratorState {
    // Loading states
    loading: boolean;
    saving: boolean;
    error: string | null;

    // Config state
    originalConfig: OmpConfig | null;  // Loaded from disk
    editedConfig: OmpConfig | null;    // Current edits
    hasChanges: boolean;

    // UI state
    selectedBlockIndex: number;
    selectedSegmentIndex: number;
    advancedExpanded: boolean;
}

export const OmpConfigurator = memo(({ previewBackground, onConfigChange }: OmpConfiguratorProps) => {
    const [state, setState] = useState<OmpConfiguratorState>({
        loading: true,
        saving: false,
        error: null,
        originalConfig: null,
        editedConfig: null,
        hasChanges: false,
        selectedBlockIndex: 0,
        selectedSegmentIndex: 0,
        advancedExpanded: false,
    });

    // Load config on mount
    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const result = await RpcApi.OmpReadConfigCommand(TabRpcClient);
            if (result.error) {
                setState(s => ({ ...s, loading: false, error: result.error }));
                return;
            }
            setState(s => ({
                ...s,
                loading: false,
                originalConfig: result.config,
                editedConfig: structuredClone(result.config),
            }));
        } catch (err) {
            setState(s => ({ ...s, loading: false, error: String(err) }));
        }
    };

    const handleSave = async () => {
        if (!state.editedConfig || !state.hasChanges) return;

        setState(s => ({ ...s, saving: true }));
        try {
            await RpcApi.OmpWriteConfigCommand(TabRpcClient, {
                config: state.editedConfig,
                createBackup: true,
            });
            setState(s => ({
                ...s,
                saving: false,
                originalConfig: structuredClone(s.editedConfig),
                hasChanges: false,
            }));
            // Reinit OMP in all terminals
            await reinitOmpInAllTerminals();
            onConfigChange?.();
        } catch (err) {
            setState(s => ({ ...s, saving: false, error: String(err) }));
        }
    };

    const handleCancel = () => {
        setState(s => ({
            ...s,
            editedConfig: structuredClone(s.originalConfig),
            hasChanges: false,
            selectedBlockIndex: 0,
            selectedSegmentIndex: 0,
        }));
    };

    // ... render implementation
});
```

### 4.3 Integration with Appearance Panel

```typescript
// frontend/app/view/waveconfig/appearance-content.tsx

// Add to imports
import { OmpConfigurator } from "@/app/element/settings/omp-configurator";

// In the Oh-My-Posh Integration section:
<CollapsibleSection
    title="Oh-My-Posh Integration"
    icon="wand-magic-sparkles"
    isExpanded={expandedSections.has("omp")}
    onToggle={() => toggleSection("omp")}
>
    <div className="omp-section">
        <PreviewBackgroundToggle value={ompPreviewBg} onChange={setOmpPreviewBg} />
        <OmpThemeControl
            value={ompTheme}
            onChange={handleOmpThemeChange}
            previewBackground={ompPreviewBg}
        />
        <div className="section-divider" />
        <OmpHighContrast />
        <div className="section-divider" />
        <OmpPaletteExport />
        <div className="section-divider" />
        {/* NEW: Theme Configurator */}
        <OmpConfigurator
            previewBackground={ompPreviewBg}
            onConfigChange={handleOmpConfigChange}
        />
    </div>
</CollapsibleSection>
```

## 5. New RPC Commands

### 5.1 OmpReadConfigCommand

Read the full OMP configuration as JSON.

```go
// pkg/wshrpc/wshrpctypes.go

type CommandOmpReadConfigRtnData struct {
    ConfigPath string          `json:"configpath"`
    Config     *OmpConfig      `json:"config,omitempty"`
    RawContent string          `json:"rawcontent,omitempty"`
    Format     string          `json:"format"`
    Error      string          `json:"error,omitempty"`
}

// In WshRpcInterface
OmpReadConfigCommand(ctx context.Context) (CommandOmpReadConfigRtnData, error)
```

```go
// pkg/wshrpc/wshserver/wshserver.go

func (ws *WshServer) OmpReadConfigCommand(ctx context.Context) (wshrpc.CommandOmpReadConfigRtnData, error) {
    configPath, err := wshutil.GetOmpConfigPath()
    if err != nil {
        return wshrpc.CommandOmpReadConfigRtnData{Error: err.Error()}, nil
    }

    content, err := os.ReadFile(configPath)
    if err != nil {
        return wshrpc.CommandOmpReadConfigRtnData{
            ConfigPath: configPath,
            Error:      fmt.Sprintf("Failed to read config: %v", err),
        }, nil
    }

    format := wshutil.DetectConfigFormat(configPath)

    // Parse JSON configs
    if format == wshutil.OmpFormatJSON {
        config, err := wshutil.ParseOmpConfig(content)
        if err != nil {
            return wshrpc.CommandOmpReadConfigRtnData{
                ConfigPath: configPath,
                Format:     string(format),
                RawContent: string(content),
                Error:      fmt.Sprintf("Failed to parse config: %v", err),
            }, nil
        }
        return wshrpc.CommandOmpReadConfigRtnData{
            ConfigPath: configPath,
            Config:     config,
            Format:     string(format),
        }, nil
    }

    // For YAML/TOML, return raw content
    return wshrpc.CommandOmpReadConfigRtnData{
        ConfigPath: configPath,
        RawContent: string(content),
        Format:     string(format),
    }, nil
}
```

### 5.2 OmpWriteConfigCommand

Write the full OMP configuration with backup support.

```go
// pkg/wshrpc/wshrpctypes.go

type CommandOmpWriteConfigData struct {
    Config       *OmpConfig `json:"config"`
    CreateBackup bool       `json:"createbackup"`
}

type CommandOmpWriteConfigRtnData struct {
    Success    bool   `json:"success"`
    BackupPath string `json:"backuppath,omitempty"`
    Error      string `json:"error,omitempty"`
}

// In WshRpcInterface
OmpWriteConfigCommand(ctx context.Context, data CommandOmpWriteConfigData) (CommandOmpWriteConfigRtnData, error)
```

```go
// pkg/wshrpc/wshserver/wshserver.go

func (ws *WshServer) OmpWriteConfigCommand(ctx context.Context, data wshrpc.CommandOmpWriteConfigData) (wshrpc.CommandOmpWriteConfigRtnData, error) {
    configPath, err := wshutil.GetOmpConfigPath()
    if err != nil {
        return wshrpc.CommandOmpWriteConfigRtnData{Error: err.Error()}, nil
    }

    // Validate path
    if err := wshutil.ValidateOmpConfigPath(configPath); err != nil {
        return wshrpc.CommandOmpWriteConfigRtnData{Error: err.Error()}, nil
    }

    var backupPath string
    if data.CreateBackup {
        backupPath, err = wshutil.CreateOmpBackup(configPath)
        if err != nil {
            return wshrpc.CommandOmpWriteConfigRtnData{
                Error: fmt.Sprintf("Failed to create backup: %v", err),
            }, nil
        }
    }

    content, err := wshutil.SerializeOmpConfig(data.Config)
    if err != nil {
        return wshrpc.CommandOmpWriteConfigRtnData{
            BackupPath: backupPath,
            Error:      fmt.Sprintf("Failed to serialize config: %v", err),
        }, nil
    }

    // Get original file permissions
    origInfo, err := os.Stat(configPath)
    mode := os.FileMode(0644)
    if err == nil {
        mode = origInfo.Mode()
    }

    if err := os.WriteFile(configPath, content, mode); err != nil {
        return wshrpc.CommandOmpWriteConfigRtnData{
            BackupPath: backupPath,
            Error:      fmt.Sprintf("Failed to write config: %v", err),
        }, nil
    }

    return wshrpc.CommandOmpWriteConfigRtnData{
        Success:    true,
        BackupPath: backupPath,
    }, nil
}
```

## 6. TypeScript Types

```typescript
// frontend/types/gotypes.d.ts (add to existing)

interface CommandOmpReadConfigRtnData {
    configpath: string;
    config?: OmpConfig;
    rawcontent?: string;
    format: string;
    error?: string;
}

interface CommandOmpWriteConfigData {
    config: OmpConfig;
    createbackup: boolean;
}

interface CommandOmpWriteConfigRtnData {
    success: boolean;
    backuppath?: string;
    error?: string;
}

interface OmpConfig {
    final_space?: boolean;
    console_title_template?: string;
    blocks: OmpBlock[];
    palette?: Record<string, string>;
    version?: number;
}

interface OmpBlock {
    type: string;
    alignment: string;
    segments: OmpSegment[];
}

interface OmpSegment {
    type: string;
    style: string;
    foreground?: string;
    background?: string;
    properties?: Record<string, any>;
    templates?: string[];
    template?: string;
}
```

## 7. Build Sequence

### Phase 1: Backend RPC Commands
1. Add `CommandOmpReadConfigRtnData` and `CommandOmpWriteConfigData` types to `wshrpctypes.go`
2. Add `OmpReadConfigCommand` and `OmpWriteConfigCommand` to `WshRpcInterface`
3. Implement handlers in `wshserver.go`
4. Run `task generate` to generate TypeScript bindings
5. Test with `wsh` CLI

### Phase 2: Component Skeleton
1. Create `omp-configurator/` directory structure
2. Create basic `OmpConfigurator` component with loading state
3. Wire up to `appearance-content.tsx`
4. Test config loading

### Phase 3: UI Implementation
1. Implement config preview panel
2. Implement Save/Cancel buttons
3. Add error handling and states
4. Add basic SCSS styling

### Phase 4: Integration
1. Connect to existing OMP reinit flow
2. Add notification on successful save
3. Handle edge cases (no config, read-only, etc.)

## 8. Acceptance Criteria

- [ ] OmpConfigurator appears in Appearance > Oh-My-Posh Integration
- [ ] Component loads current OMP config from $POSH_THEME
- [ ] Config is displayed in a preview panel
- [ ] Save button writes changes to disk with backup
- [ ] Cancel button discards changes
- [ ] Terminals are reinitialized after saving
- [ ] Error states are handled gracefully
- [ ] Component respects dark/light preview background setting

## 9. Edge Cases

| Case | Behavior |
|------|----------|
| No $POSH_THEME set | Show message with link to OMP docs |
| Config file not found | Show message suggesting theme selection |
| Config is read-only | Disable Save, show warning |
| Config is YAML/TOML | Show raw editor (future), or convert to JSON |
| Config parse error | Show error message, offer raw editor |
| Save fails | Show error, keep edits in state |
| Backup fails | Warn but allow save |

## 10. Security Considerations

- Validate config path before read/write (already in `omputil.go`)
- Create atomic backups before any modification
- Don't expose full file paths in error messages to user
- Sanitize JSON before parse to prevent prototype pollution
