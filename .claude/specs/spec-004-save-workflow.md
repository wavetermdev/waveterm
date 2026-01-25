# Spec 004: Save/Cancel Workflow

**Date:** 2026-01-25
**Status:** Draft
**Dependencies:** Spec 001, Spec 003

---

## 1. Objective

Implement a robust Save/Cancel workflow for the OMP Configurator that:
- Tracks changes accurately
- Creates backups before saving
- Validates configuration before write
- Reinitializes OMP in all terminals after save
- Handles errors gracefully
- Provides clear feedback to users

## 2. Workflow Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Edit Mode Active                            │
│                                                                 │
│   Config Preview [■■■■■■■■]                                    │
│   Block/Segment Editor                                          │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  ⚠️ You have unsaved changes                             │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   ┌──────────┐  ┌──────────┐                                   │
│   │  Cancel  │  │   Save   │                                   │
│   └──────────┘  └──────────┘                                   │
└─────────────────────────────────────────────────────────────────┘

         │ Cancel                          │ Save
         ▼                                 ▼
┌─────────────────┐              ┌─────────────────────┐
│ Confirm Dialog  │              │ Create Backup       │
│ "Discard        │              │ Validate Config     │
│  changes?"      │              │ Write to File       │
│                 │              │ Reinit Terminals    │
│ [Yes] [No]      │              │ Show Success Toast  │
└─────────────────┘              └─────────────────────┘
```

## 3. Change Tracking

### 3.1 Change Detection

```typescript
// frontend/app/element/settings/omp-configurator/change-tracking.ts

/**
 * Deep compare two OMP configs to detect changes
 */
export function hasConfigChanges(
    original: OmpConfig | null,
    edited: OmpConfig | null
): boolean {
    if (!original || !edited) return false;

    // Quick check - JSON stringify comparison
    // This catches most changes accurately
    return JSON.stringify(original) !== JSON.stringify(edited);
}

/**
 * Get a summary of changes for display
 */
export function getChangeSummary(
    original: OmpConfig | null,
    edited: OmpConfig | null
): ChangeSummary {
    const summary: ChangeSummary = {
        hasChanges: false,
        blockChanges: [],
        segmentChanges: [],
        paletteChanges: [],
        globalChanges: [],
    };

    if (!original || !edited) return summary;

    // Compare blocks
    const maxBlocks = Math.max(original.blocks.length, edited.blocks.length);
    for (let i = 0; i < maxBlocks; i++) {
        const origBlock = original.blocks[i];
        const editBlock = edited.blocks[i];

        if (!origBlock && editBlock) {
            summary.blockChanges.push({ type: "added", index: i });
            summary.hasChanges = true;
        } else if (origBlock && !editBlock) {
            summary.blockChanges.push({ type: "removed", index: i });
            summary.hasChanges = true;
        } else if (JSON.stringify(origBlock) !== JSON.stringify(editBlock)) {
            summary.blockChanges.push({ type: "modified", index: i });
            summary.hasChanges = true;

            // Track segment changes within block
            const maxSegs = Math.max(
                origBlock?.segments?.length ?? 0,
                editBlock?.segments?.length ?? 0
            );
            for (let j = 0; j < maxSegs; j++) {
                const origSeg = origBlock?.segments?.[j];
                const editSeg = editBlock?.segments?.[j];

                if (!origSeg && editSeg) {
                    summary.segmentChanges.push({
                        type: "added",
                        blockIndex: i,
                        segmentIndex: j,
                        segmentType: editSeg.type,
                    });
                } else if (origSeg && !editSeg) {
                    summary.segmentChanges.push({
                        type: "removed",
                        blockIndex: i,
                        segmentIndex: j,
                        segmentType: origSeg.type,
                    });
                } else if (JSON.stringify(origSeg) !== JSON.stringify(editSeg)) {
                    summary.segmentChanges.push({
                        type: "modified",
                        blockIndex: i,
                        segmentIndex: j,
                        segmentType: editSeg?.type,
                    });
                }
            }
        }
    }

    // Compare palette
    const origPalette = original.palette ?? {};
    const editPalette = edited.palette ?? {};
    const allKeys = new Set([...Object.keys(origPalette), ...Object.keys(editPalette)]);

    for (const key of allKeys) {
        if (!(key in origPalette)) {
            summary.paletteChanges.push({ type: "added", name: key });
            summary.hasChanges = true;
        } else if (!(key in editPalette)) {
            summary.paletteChanges.push({ type: "removed", name: key });
            summary.hasChanges = true;
        } else if (origPalette[key] !== editPalette[key]) {
            summary.paletteChanges.push({ type: "modified", name: key });
            summary.hasChanges = true;
        }
    }

    // Compare global settings
    const globalKeys = ["final_space", "console_title_template", "version"] as const;
    for (const key of globalKeys) {
        if (original[key] !== edited[key]) {
            summary.globalChanges.push(key);
            summary.hasChanges = true;
        }
    }

    return summary;
}

interface ChangeSummary {
    hasChanges: boolean;
    blockChanges: Array<{ type: "added" | "removed" | "modified"; index: number }>;
    segmentChanges: Array<{
        type: "added" | "removed" | "modified";
        blockIndex: number;
        segmentIndex: number;
        segmentType?: string;
    }>;
    paletteChanges: Array<{ type: "added" | "removed" | "modified"; name: string }>;
    globalChanges: string[];
}
```

### 3.2 Unsaved Changes Warning

```tsx
// frontend/app/element/settings/omp-configurator/unsaved-changes-banner.tsx

interface UnsavedChangesBannerProps {
    changeSummary: ChangeSummary;
}

export const UnsavedChangesBanner = memo(({ changeSummary }: UnsavedChangesBannerProps) => {
    if (!changeSummary.hasChanges) return null;

    const changeCount =
        changeSummary.blockChanges.length +
        changeSummary.segmentChanges.length +
        changeSummary.paletteChanges.length +
        changeSummary.globalChanges.length;

    return (
        <div className="unsaved-changes-banner">
            <i className="fa fa-solid fa-exclamation-circle" />
            <span>
                You have <strong>{changeCount}</strong> unsaved change{changeCount !== 1 ? "s" : ""}
            </span>
        </div>
    );
});
```

## 4. Save Flow Implementation

### 4.1 Save Button Handler

```typescript
// frontend/app/element/settings/omp-configurator/save-handler.ts

interface SaveResult {
    success: boolean;
    backupPath?: string;
    error?: string;
}

export async function saveOmpConfig(
    config: OmpConfig,
    options: { createBackup: boolean } = { createBackup: true }
): Promise<SaveResult> {
    // Step 1: Validate config before save
    const validation = validateConfig(config);
    if (!validation.valid) {
        return {
            success: false,
            error: `Invalid configuration: ${validation.errors.join(", ")}`,
        };
    }

    // Step 2: Save via RPC
    try {
        const result = await RpcApi.OmpWriteConfigCommand(TabRpcClient, {
            config,
            createbackup: options.createBackup,
        });

        if (result.error) {
            return {
                success: false,
                error: result.error,
            };
        }

        return {
            success: true,
            backupPath: result.backuppath,
        };
    } catch (err) {
        return {
            success: false,
            error: `Failed to save: ${err}`,
        };
    }
}
```

### 4.2 Validation

```typescript
// frontend/app/element/settings/omp-configurator/config-validation.ts

interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export function validateConfig(config: OmpConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Must have at least one block
    if (!config.blocks || config.blocks.length === 0) {
        errors.push("Configuration must have at least one block");
    }

    // Each block must have at least one segment
    config.blocks?.forEach((block, i) => {
        if (!block.segments || block.segments.length === 0) {
            errors.push(`Block ${i + 1} has no segments`);
        }

        // Block type validation
        if (!["prompt", "rprompt"].includes(block.type)) {
            errors.push(`Block ${i + 1} has invalid type: ${block.type}`);
        }

        // Block alignment validation
        if (!["left", "right"].includes(block.alignment)) {
            errors.push(`Block ${i + 1} has invalid alignment: ${block.alignment}`);
        }

        // Segment validation
        block.segments?.forEach((segment, j) => {
            // Segment type is required
            if (!segment.type) {
                errors.push(`Block ${i + 1}, Segment ${j + 1} has no type`);
            }

            // Style validation
            const validStyles = ["plain", "diamond", "powerline", "accordion"];
            if (!validStyles.includes(segment.style)) {
                warnings.push(
                    `Block ${i + 1}, Segment ${j + 1} has unusual style: ${segment.style}`
                );
            }

            // Diamond style requires leading/trailing diamond symbols
            if (segment.style === "diamond") {
                if (!segment.leading_diamond) {
                    warnings.push(
                        `Block ${i + 1}, Segment ${j + 1} uses diamond style but has no leading_diamond`
                    );
                }
                if (!segment.trailing_diamond) {
                    warnings.push(
                        `Block ${i + 1}, Segment ${j + 1} uses diamond style but has no trailing_diamond`
                    );
                }
            }
        });
    });

    // Palette reference validation
    const paletteNames = new Set(Object.keys(config.palette ?? {}));
    config.blocks?.forEach((block, i) => {
        block.segments?.forEach((segment, j) => {
            checkPaletteReference(segment.foreground, paletteNames, warnings, i, j, "foreground");
            checkPaletteReference(segment.background, paletteNames, warnings, i, j, "background");
        });
    });

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

function checkPaletteReference(
    color: string | undefined,
    paletteNames: Set<string>,
    warnings: string[],
    blockIndex: number,
    segmentIndex: number,
    field: string
): void {
    if (color?.startsWith("p:")) {
        const refName = color.slice(2);
        if (!paletteNames.has(refName)) {
            warnings.push(
                `Block ${blockIndex + 1}, Segment ${segmentIndex + 1} ${field} references unknown palette color: ${refName}`
            );
        }
    }
}
```

### 4.3 Terminal Reinitialization

```typescript
// Reuse existing function from appearance-content.tsx
import { reinitOmpInAllTerminals } from "@/app/view/waveconfig/appearance-content";

// After successful save:
async function handleSaveComplete(result: SaveResult) {
    if (result.success) {
        // Reinit OMP in all terminals
        await reinitOmpInAllTerminals();

        // Show success toast
        showToast({
            type: "success",
            message: "Configuration saved",
            details: result.backupPath
                ? `Backup created at ${result.backupPath}`
                : undefined,
        });
    }
}
```

## 5. Cancel Flow Implementation

### 5.1 Cancel with Confirmation

```tsx
// frontend/app/element/settings/omp-configurator/cancel-handler.tsx

interface CancelDialogProps {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const CancelConfirmDialog = memo(({ isOpen, onConfirm, onCancel }: CancelDialogProps) => {
    if (!isOpen) return null;

    return (
        <div className="confirm-dialog-overlay">
            <div className="confirm-dialog">
                <div className="dialog-header">
                    <i className="fa fa-solid fa-exclamation-triangle" />
                    <span>Discard Changes?</span>
                </div>
                <div className="dialog-body">
                    You have unsaved changes. Are you sure you want to discard them?
                </div>
                <div className="dialog-actions">
                    <button className="btn-secondary" onClick={onCancel}>
                        Keep Editing
                    </button>
                    <button className="btn-danger" onClick={onConfirm}>
                        Discard Changes
                    </button>
                </div>
            </div>
        </div>
    );
});
```

### 5.2 Cancel Handler

```typescript
export function useCancelHandler(
    hasChanges: boolean,
    onDiscard: () => void
) {
    const [showConfirm, setShowConfirm] = useState(false);

    const handleCancel = useCallback(() => {
        if (hasChanges) {
            setShowConfirm(true);
        } else {
            // No changes, just reset selection
            onDiscard();
        }
    }, [hasChanges, onDiscard]);

    const handleConfirmDiscard = useCallback(() => {
        setShowConfirm(false);
        onDiscard();
    }, [onDiscard]);

    const handleKeepEditing = useCallback(() => {
        setShowConfirm(false);
    }, []);

    return {
        showConfirm,
        handleCancel,
        handleConfirmDiscard,
        handleKeepEditing,
    };
}
```

## 6. Action Buttons Component

```tsx
// frontend/app/element/settings/omp-configurator/action-buttons.tsx

interface ActionButtonsProps {
    hasChanges: boolean;
    saving: boolean;
    onSave: () => void;
    onCancel: () => void;
}

export const ActionButtons = memo(({
    hasChanges,
    saving,
    onSave,
    onCancel,
}: ActionButtonsProps) => {
    return (
        <div className="omp-action-buttons">
            <button
                className="btn-secondary"
                onClick={onCancel}
                disabled={saving}
            >
                <i className="fa fa-solid fa-times" />
                Cancel
            </button>
            <button
                className="btn-primary"
                onClick={onSave}
                disabled={!hasChanges || saving}
            >
                {saving ? (
                    <>
                        <i className="fa fa-solid fa-spinner fa-spin" />
                        Saving...
                    </>
                ) : (
                    <>
                        <i className="fa fa-solid fa-check" />
                        Save
                    </>
                )}
            </button>
        </div>
    );
});
```

## 7. Error Handling

### 7.1 Save Errors

```tsx
const SaveErrorBanner = memo(({ error, onDismiss }: { error: string; onDismiss: () => void }) => (
    <div className="save-error-banner">
        <i className="fa fa-solid fa-circle-exclamation" />
        <div className="error-content">
            <div className="error-title">Failed to save configuration</div>
            <div className="error-message">{error}</div>
        </div>
        <button className="dismiss-button" onClick={onDismiss}>
            <i className="fa fa-solid fa-times" />
        </button>
    </div>
));
```

### 7.2 Validation Warnings

```tsx
const ValidationWarnings = memo(({ warnings }: { warnings: string[] }) => {
    if (warnings.length === 0) return null;

    return (
        <div className="validation-warnings">
            <details>
                <summary>
                    <i className="fa fa-solid fa-exclamation-triangle" />
                    {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
                </summary>
                <ul>
                    {warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                    ))}
                </ul>
            </details>
        </div>
    );
});
```

## 8. Keyboard Shortcuts

```tsx
// Add keyboard shortcut support
useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Ctrl/Cmd + S to save
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            if (hasChanges && !saving) {
                handleSave();
            }
        }

        // Escape to cancel
        if (e.key === "Escape") {
            e.preventDefault();
            handleCancel();
        }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
}, [hasChanges, saving, handleSave, handleCancel]);
```

## 9. Backup Management

### 9.1 Backup Strategy

- Backup file: `{config_path}.wave-backup`
- Created before every save
- Only one backup kept (overwritten on each save)
- User can restore via `OmpRestoreBackup` command

### 9.2 Restore Button (in Advanced section)

```tsx
const RestoreBackupButton = memo(({ configPath }: { configPath: string }) => {
    const [hasBackup, setHasBackup] = useState(false);
    const [restoring, setRestoring] = useState(false);

    useEffect(() => {
        // Check if backup exists
        checkBackupExists();
    }, [configPath]);

    const handleRestore = async () => {
        if (!confirm("Restore from backup? This will overwrite your current configuration.")) {
            return;
        }

        setRestoring(true);
        try {
            await RpcApi.OmpRestoreBackupCommand(TabRpcClient, {});
            showToast({ type: "success", message: "Configuration restored from backup" });
            // Reload config
            await loadConfig();
            // Reinit terminals
            await reinitOmpInAllTerminals();
        } catch (err) {
            showToast({ type: "error", message: `Failed to restore: ${err}` });
        } finally {
            setRestoring(false);
        }
    };

    if (!hasBackup) return null;

    return (
        <button
            className="advanced-action"
            onClick={handleRestore}
            disabled={restoring}
        >
            <i className="fa fa-solid fa-rotate-left" />
            <div>
                <div className="action-label">Restore from Backup</div>
                <div className="action-description">
                    Revert to the last saved version
                </div>
            </div>
        </button>
    );
});
```

## 10. Complete Save Flow Sequence

```
User clicks Save
        ↓
Disable Save button, show spinner
        ↓
Validate configuration
        ├── Has errors → Show error, stop
        └── Has warnings → Show warnings, continue
        ↓
Call OmpWriteConfigCommand RPC
        ↓
Backend:
    1. Validate path security
    2. Read existing file (for permissions)
    3. Create backup (if requested)
    4. Serialize config to JSON
    5. Write file atomically
    6. Return result
        ↓
Frontend receives result
        ├── Error → Show error banner, re-enable Save
        └── Success:
                1. Update originalConfig = editedConfig
                2. Set hasChanges = false
                3. Call reinitOmpInAllTerminals()
                4. Show success toast
                5. Re-enable Save button
```

## 11. Build Checklist

- [ ] Implement `hasConfigChanges` and `getChangeSummary`
- [ ] Implement `validateConfig` with error/warning detection
- [ ] Implement `saveOmpConfig` handler
- [ ] Create `UnsavedChangesBanner` component
- [ ] Create `ActionButtons` component
- [ ] Create `CancelConfirmDialog` component
- [ ] Create `SaveErrorBanner` component
- [ ] Create `ValidationWarnings` component
- [ ] Add keyboard shortcuts (Ctrl+S, Escape)
- [ ] Integrate with existing `reinitOmpInAllTerminals`
- [ ] Add restore from backup functionality
- [ ] Add toast notifications for save success/failure

## 12. Acceptance Criteria

- [ ] Save button is disabled when no changes
- [ ] Save button shows spinner while saving
- [ ] Configuration is validated before save
- [ ] Validation errors prevent save
- [ ] Validation warnings are shown but don't block save
- [ ] Backup is created before saving
- [ ] Success toast shows after successful save
- [ ] Error banner shows on save failure
- [ ] Cancel shows confirmation when there are changes
- [ ] Cancel without changes doesn't show confirmation
- [ ] Ctrl+S keyboard shortcut works
- [ ] Escape keyboard shortcut triggers cancel
- [ ] Terminals are reinitialized after save
- [ ] Restore from backup works
