# Spec 005: Collapsing Secondary Actions

**Date:** 2026-01-25
**Status:** Draft
**Dependencies:** Spec 001, Spec 002

---

## 1. Objective

Move Import, Export/Copy, and Share functionality into a collapsed "Advanced Options" section, making the primary workflow (editing and saving the current theme) the prominent focus.

## 2. UI Hierarchy

### 2.1 Primary Actions (Always Visible)
- Config Preview
- Block/Segment Editor
- **Save** and **Cancel** buttons

### 2.2 Secondary Actions (Collapsed by Default)
- Import Configuration
- Export Configuration
- Copy to Clipboard
- Share Link (future)

## 3. Advanced Section Design

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   [Config Preview Panel]                                        │
│                                                                 │
│   [Block/Segment Editor]                                        │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  Cancel                                     Save         │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   ────────────────────────────────────────────────────────────  │
│                                                                 │
│   ▸ Advanced Options                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

When expanded:

│   ▾ Advanced Options                                            │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  ┌──────────────────────────────────────────────────┐   │  │
│   │  │ 📥  Import Configuration                          │   │  │
│   │  │     Load a theme from file or URL                 │   │  │
│   │  └──────────────────────────────────────────────────┘   │  │
│   │                                                         │  │
│   │  ┌──────────────────────────────────────────────────┐   │  │
│   │  │ 📤  Export Configuration                          │   │  │
│   │  │     Download as JSON, YAML, or TOML               │   │  │
│   │  └──────────────────────────────────────────────────┘   │  │
│   │                                                         │  │
│   │  ┌──────────────────────────────────────────────────┐   │  │
│   │  │ 📋  Copy to Clipboard                             │   │  │
│   │  │     Copy configuration as JSON                    │   │  │
│   │  └──────────────────────────────────────────────────┘   │  │
│   │                                                         │  │
│   │  ┌──────────────────────────────────────────────────┐   │  │
│   │  │ 🔄  Restore from Backup                           │   │  │
│   │  │     Revert to last saved version                  │   │  │
│   │  └──────────────────────────────────────────────────┘   │  │
│   └─────────────────────────────────────────────────────────┘  │
```

## 4. Component Implementation

### 4.1 Advanced Section Container

```tsx
// frontend/app/element/settings/omp-configurator/advanced-section.tsx

interface AdvancedSectionProps {
    config: OmpConfig | null;
    configPath: string | null;
    onImport: (config: OmpConfig) => void;
    onReload: () => void;
}

export const AdvancedSection = memo(({
    config,
    configPath,
    onImport,
    onReload,
}: AdvancedSectionProps) => {
    const [expanded, setExpanded] = useState(false);
    const [importing, setImporting] = useState(false);
    const [exporting, setExporting] = useState(false);

    return (
        <div className="omp-advanced-section">
            <button
                className={cn("advanced-toggle", { expanded })}
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
            >
                <i className="fa fa-solid fa-chevron-right" />
                <span>Advanced Options</span>
            </button>

            <div className={cn("advanced-content", { visible: expanded })}>
                <div className="advanced-actions">
                    <ImportAction onImport={onImport} />
                    <ExportAction config={config} />
                    <CopyAction config={config} />
                    <RestoreAction configPath={configPath} onReload={onReload} />
                </div>
            </div>
        </div>
    );
});
```

### 4.2 Import Action

```tsx
// frontend/app/element/settings/omp-configurator/import-action.tsx

interface ImportActionProps {
    onImport: (config: OmpConfig) => void;
}

export const ImportAction = memo(({ onImport }: ImportActionProps) => {
    const [showDialog, setShowDialog] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const content = await file.text();
            const config = parseConfigContent(content, file.name);

            if (config) {
                onImport(config);
                showToast({ type: "success", message: "Configuration imported" });
            }
        } catch (err) {
            showToast({ type: "error", message: `Import failed: ${err}` });
        }

        // Reset input
        e.target.value = "";
    };

    return (
        <>
            <button
                className="advanced-action"
                onClick={() => fileInputRef.current?.click()}
            >
                <i className="fa fa-solid fa-file-import" />
                <div>
                    <div className="action-label">Import Configuration</div>
                    <div className="action-description">
                        Load a theme from file (JSON, YAML, TOML)
                    </div>
                </div>
            </button>
            <input
                ref={fileInputRef}
                type="file"
                accept=".json,.yaml,.yml,.toml,.omp.json"
                onChange={handleFileSelect}
                style={{ display: "none" }}
            />
        </>
    );
});

function parseConfigContent(content: string, filename: string): OmpConfig | null {
    const ext = filename.split(".").pop()?.toLowerCase();

    try {
        if (ext === "json" || filename.endsWith(".omp.json")) {
            return JSON.parse(content);
        }

        // For MVP, only JSON is fully supported
        // YAML/TOML would need js-yaml/@iarna/toml
        showToast({
            type: "warning",
            message: `${ext?.toUpperCase()} import not yet supported. Please use JSON.`,
        });
        return null;
    } catch (err) {
        throw new Error(`Invalid ${ext?.toUpperCase()} syntax`);
    }
}
```

### 4.3 Export Action

```tsx
// frontend/app/element/settings/omp-configurator/export-action.tsx

interface ExportActionProps {
    config: OmpConfig | null;
}

export const ExportAction = memo(({ config }: ExportActionProps) => {
    const [showMenu, setShowMenu] = useState(false);

    const handleExport = (format: "json" | "yaml" | "toml") => {
        if (!config) return;

        let content: string;
        let mimeType: string;
        let extension: string;

        switch (format) {
            case "json":
                content = JSON.stringify(config, null, 2);
                mimeType = "application/json";
                extension = "omp.json";
                break;
            case "yaml":
                // For MVP, show not supported message
                showToast({
                    type: "warning",
                    message: "YAML export coming soon. Using JSON.",
                });
                content = JSON.stringify(config, null, 2);
                mimeType = "application/json";
                extension = "omp.json";
                break;
            case "toml":
                showToast({
                    type: "warning",
                    message: "TOML export coming soon. Using JSON.",
                });
                content = JSON.stringify(config, null, 2);
                mimeType = "application/json";
                extension = "omp.json";
                break;
        }

        downloadFile(content, `config.${extension}`, mimeType);
        setShowMenu(false);
    };

    return (
        <div className="advanced-action-wrapper">
            <button
                className="advanced-action"
                onClick={() => setShowMenu(!showMenu)}
                disabled={!config}
            >
                <i className="fa fa-solid fa-file-export" />
                <div>
                    <div className="action-label">Export Configuration</div>
                    <div className="action-description">
                        Download as JSON, YAML, or TOML
                    </div>
                </div>
                <i className="fa fa-solid fa-chevron-down menu-arrow" />
            </button>

            {showMenu && (
                <div className="action-dropdown">
                    <button onClick={() => handleExport("json")}>
                        <i className="fa fa-solid fa-brackets-curly" />
                        JSON (.omp.json)
                    </button>
                    <button onClick={() => handleExport("yaml")} className="disabled">
                        <i className="fa fa-solid fa-file-lines" />
                        YAML (.yaml) <span className="badge">Soon</span>
                    </button>
                    <button onClick={() => handleExport("toml")} className="disabled">
                        <i className="fa fa-solid fa-file-code" />
                        TOML (.toml) <span className="badge">Soon</span>
                    </button>
                </div>
            )}
        </div>
    );
});

function downloadFile(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
```

### 4.4 Copy to Clipboard Action

```tsx
// frontend/app/element/settings/omp-configurator/copy-action.tsx

interface CopyActionProps {
    config: OmpConfig | null;
}

export const CopyAction = memo(({ config }: CopyActionProps) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        if (!config) return;

        try {
            const content = JSON.stringify(config, null, 2);
            await navigator.clipboard.writeText(content);
            setCopied(true);
            showToast({ type: "success", message: "Configuration copied to clipboard" });

            // Reset copied state after 2 seconds
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            showToast({ type: "error", message: "Failed to copy to clipboard" });
        }
    };

    return (
        <button
            className="advanced-action"
            onClick={handleCopy}
            disabled={!config}
        >
            <i className={cn("fa fa-solid", copied ? "fa-check" : "fa-copy")} />
            <div>
                <div className="action-label">
                    {copied ? "Copied!" : "Copy to Clipboard"}
                </div>
                <div className="action-description">
                    Copy configuration as JSON
                </div>
            </div>
        </button>
    );
});
```

### 4.5 Restore from Backup Action

```tsx
// frontend/app/element/settings/omp-configurator/restore-action.tsx

interface RestoreActionProps {
    configPath: string | null;
    onReload: () => void;
}

export const RestoreAction = memo(({ configPath, onReload }: RestoreActionProps) => {
    const [hasBackup, setHasBackup] = useState(false);
    const [restoring, setRestoring] = useState(false);

    useEffect(() => {
        if (configPath) {
            checkBackupExists(configPath).then(setHasBackup);
        }
    }, [configPath]);

    const handleRestore = async () => {
        const confirmed = await showConfirmDialog({
            title: "Restore from Backup?",
            message: "This will replace your current configuration with the backup. This action cannot be undone.",
            confirmText: "Restore",
            confirmStyle: "danger",
        });

        if (!confirmed) return;

        setRestoring(true);
        try {
            await RpcApi.OmpRestoreBackupCommand(TabRpcClient, {});
            showToast({ type: "success", message: "Configuration restored from backup" });
            onReload();
            await reinitOmpInAllTerminals();
        } catch (err) {
            showToast({ type: "error", message: `Failed to restore: ${err}` });
        } finally {
            setRestoring(false);
        }
    };

    if (!hasBackup) {
        return (
            <div className="advanced-action disabled">
                <i className="fa fa-solid fa-rotate-left" />
                <div>
                    <div className="action-label">Restore from Backup</div>
                    <div className="action-description">
                        No backup available
                    </div>
                </div>
            </div>
        );
    }

    return (
        <button
            className="advanced-action"
            onClick={handleRestore}
            disabled={restoring}
        >
            {restoring ? (
                <i className="fa fa-solid fa-spinner fa-spin" />
            ) : (
                <i className="fa fa-solid fa-rotate-left" />
            )}
            <div>
                <div className="action-label">Restore from Backup</div>
                <div className="action-description">
                    Revert to last saved version
                </div>
            </div>
        </button>
    );
});

async function checkBackupExists(configPath: string): Promise<boolean> {
    // Check via RPC or derive backup path
    // For now, assume backup exists if config exists
    // Backend can provide this info in OmpReadConfigCommand
    return true;
}
```

## 5. Styling

```scss
// frontend/app/element/settings/omp-configurator/omp-configurator.scss

// Advanced section toggle
.omp-advanced-section {
    margin-top: 16px;
    border-top: 1px solid var(--border-color);
    padding-top: 12px;
}

.advanced-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 4px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--secondary-text-color);
    font-size: 13px;
    width: 100%;
    text-align: left;
    transition: color 0.15s ease;

    &:hover {
        color: var(--main-text-color);
    }

    i {
        font-size: 10px;
        transition: transform 0.2s ease;
    }

    &.expanded i {
        transform: rotate(90deg);
    }
}

.advanced-content {
    display: none;
    padding: 12px 0;
    animation: slideDown 0.2s ease;

    &.visible {
        display: block;
    }
}

@keyframes slideDown {
    from {
        opacity: 0;
        transform: translateY(-8px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.advanced-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.advanced-action {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--form-element-bg-color);
    border: 1px solid var(--form-element-border-color);
    border-radius: 6px;
    cursor: pointer;
    transition:
        border-color 0.15s ease,
        background-color 0.15s ease;
    text-align: left;
    width: 100%;

    &:hover:not(.disabled):not(:disabled) {
        border-color: var(--form-element-primary-color);
        background: var(--hover-bg-color);
    }

    &.disabled,
    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    > i {
        width: 24px;
        font-size: 16px;
        text-align: center;
        color: var(--secondary-text-color);
    }

    .action-label {
        font-size: 13px;
        font-weight: 500;
        color: var(--main-text-color);
    }

    .action-description {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-top: 2px;
    }
}

// Dropdown for export format
.advanced-action-wrapper {
    position: relative;
}

.action-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    background: var(--modal-bg-color);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 4px 12px var(--modal-shadow-color);
    z-index: 10;
    overflow: hidden;

    button {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 10px 12px;
        background: none;
        border: none;
        text-align: left;
        font-size: 13px;
        color: var(--main-text-color);
        cursor: pointer;

        &:hover:not(.disabled) {
            background: var(--hover-bg-color);
        }

        &.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        i {
            width: 16px;
            text-align: center;
            color: var(--secondary-text-color);
        }

        .badge {
            margin-left: auto;
            font-size: 10px;
            padding: 2px 6px;
            background: var(--accent-color);
            color: white;
            border-radius: 10px;
        }
    }
}

.menu-arrow {
    margin-left: auto;
    font-size: 10px;
    color: var(--secondary-text-color);
}
```

## 6. State Management Integration

```typescript
// In OmpConfigurator main component

const handleImport = useCallback((importedConfig: OmpConfig) => {
    // Set the imported config as the edited config
    setState(prev => ({
        ...prev,
        editedConfig: importedConfig,
        hasChanges: true,
    }));
}, []);

const handleReload = useCallback(() => {
    // Reload config from disk
    loadConfig();
}, [loadConfig]);

// In render:
<AdvancedSection
    config={state.editedConfig}
    configPath={state.configPath}
    onImport={handleImport}
    onReload={handleReload}
/>
```

## 7. Accessibility

### 7.1 Keyboard Navigation

```tsx
// Advanced toggle supports Enter/Space
<button
    className={cn("advanced-toggle", { expanded })}
    onClick={() => setExpanded(!expanded)}
    onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
        }
    }}
    aria-expanded={expanded}
    aria-controls="advanced-content"
>
```

### 7.2 Screen Reader Support

```tsx
<div
    id="advanced-content"
    className={cn("advanced-content", { visible: expanded })}
    role="region"
    aria-label="Advanced options"
    hidden={!expanded}
>
```

## 8. Build Checklist

- [ ] Create `AdvancedSection` container component
- [ ] Create `ImportAction` with file input
- [ ] Create `ExportAction` with format dropdown
- [ ] Create `CopyAction` with clipboard API
- [ ] Create `RestoreAction` with confirmation
- [ ] Add SCSS styles for all components
- [ ] Implement collapse/expand animation
- [ ] Add keyboard navigation support
- [ ] Add ARIA attributes for accessibility
- [ ] Test import with JSON files
- [ ] Test export download
- [ ] Test clipboard copy
- [ ] Test restore from backup

## 9. Future Enhancements

### 9.1 Phase 2: Full Format Support

Add `js-yaml` and `@iarna/toml` dependencies for:
- YAML import/export
- TOML import/export

### 9.2 Phase 3: Share Functionality

Add shareable links:
- Generate compressed config URL
- Share via Oh-My-Posh website
- QR code generation

### 9.3 Phase 4: URL Import

Support importing from URL:
- GitHub raw URLs
- Oh-My-Posh theme URLs
- Any JSON/YAML/TOML URL

```tsx
// Future: URL import dialog
<ImportUrlDialog
    onImport={handleImport}
    onClose={() => setShowUrlDialog(false)}
/>
```

## 10. Acceptance Criteria

- [ ] Advanced Options section is collapsed by default
- [ ] Clicking toggle expands/collapses with animation
- [ ] Import accepts JSON files
- [ ] Import shows warning for YAML/TOML (MVP)
- [ ] Export downloads JSON file
- [ ] Export dropdown shows YAML/TOML as "coming soon"
- [ ] Copy to Clipboard works and shows confirmation
- [ ] Restore from Backup shows confirmation dialog
- [ ] Restore refreshes config and reinits terminals
- [ ] All actions are keyboard accessible
- [ ] All actions have appropriate ARIA labels
