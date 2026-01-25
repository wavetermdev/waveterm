// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Advanced Section
 *
 * Collapsed section for Import, Export, Copy, and Restore actions.
 */

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { memo, useCallback, useRef, useState } from "react";

interface AdvancedSectionProps {
    config: OmpConfigData | null;
    configPath: string | null;
    backupExists: boolean;
    onImport: (config: OmpConfigData) => void;
    onReload: () => void;
}

/**
 * Reinitialize OMP in all active terminal blocks
 */
async function reinitOmpInAllTerminals(): Promise<void> {
    try {
        const blocks = await RpcApi.BlocksListCommand(TabRpcClient, {});
        for (const block of blocks) {
            if (block.meta?.view === "term") {
                try {
                    await RpcApi.OmpReinitCommand(TabRpcClient, { blockid: block.blockid });
                } catch (err) {
                    console.warn(`Failed to reinit OMP for block ${block.blockid}:`, err);
                }
            }
        }
    } catch (err) {
        console.error("Failed to get blocks for OMP reinit:", err);
    }
}

/**
 * Import action component
 */
const ImportAction = memo(({ onImport }: { onImport: (config: OmpConfigData) => void }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [importing, setImporting] = useState(false);

    const handleFileSelect = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;

            setImporting(true);
            try {
                const content = await file.text();
                const config = JSON.parse(content) as OmpConfigData;
                onImport(config);
            } catch (err) {
                console.error("Failed to import config:", err);
                alert(`Import failed: ${err}`);
            } finally {
                setImporting(false);
                // Reset input
                if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                }
            }
        },
        [onImport]
    );

    return (
        <>
            <button
                className="advanced-action"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
            >
                {importing ? (
                    <i className="fa fa-solid fa-spinner fa-spin" />
                ) : (
                    <i className="fa fa-solid fa-file-import" />
                )}
                <div>
                    <div className="action-label">Import Configuration</div>
                    <div className="action-description">Load a theme from a JSON file</div>
                </div>
            </button>
            <input
                ref={fileInputRef}
                type="file"
                accept=".json,.omp.json"
                onChange={handleFileSelect}
                style={{ display: "none" }}
            />
        </>
    );
});

ImportAction.displayName = "ImportAction";

/**
 * Export action component
 */
const ExportAction = memo(({ config }: { config: OmpConfigData | null }) => {
    const handleExport = useCallback(() => {
        if (!config) return;

        const content = JSON.stringify(config, null, 2);
        const blob = new Blob([content], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "config.omp.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [config]);

    return (
        <button className="advanced-action" onClick={handleExport} disabled={!config}>
            <i className="fa fa-solid fa-file-export" />
            <div>
                <div className="action-label">Export Configuration</div>
                <div className="action-description">Download as JSON file</div>
            </div>
        </button>
    );
});

ExportAction.displayName = "ExportAction";

/**
 * Copy to clipboard action component
 */
const CopyAction = memo(({ config }: { config: OmpConfigData | null }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        if (!config) return;

        try {
            const content = JSON.stringify(config, null, 2);
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy to clipboard:", err);
            alert("Failed to copy to clipboard");
        }
    }, [config]);

    return (
        <button className="advanced-action" onClick={handleCopy} disabled={!config}>
            <i className={cn("fa fa-solid", copied ? "fa-check" : "fa-copy")} />
            <div>
                <div className="action-label">{copied ? "Copied!" : "Copy to Clipboard"}</div>
                <div className="action-description">Copy configuration as JSON</div>
            </div>
        </button>
    );
});

CopyAction.displayName = "CopyAction";

/**
 * Restore from backup action component
 */
const RestoreAction = memo(
    ({
        backupExists,
        onReload,
    }: {
        backupExists: boolean;
        onReload: () => void;
    }) => {
        const [restoring, setRestoring] = useState(false);

        const handleRestore = useCallback(async () => {
            if (!confirm("Restore from backup? This will replace your current configuration.")) {
                return;
            }

            setRestoring(true);
            try {
                const result = await RpcApi.OmpRestoreBackupCommand(TabRpcClient, {});
                if (result.error) {
                    alert(`Failed to restore: ${result.error}`);
                    return;
                }
                onReload();
                await reinitOmpInAllTerminals();
            } catch (err) {
                console.error("Failed to restore backup:", err);
                alert(`Failed to restore: ${err}`);
            } finally {
                setRestoring(false);
            }
        }, [onReload]);

        if (!backupExists) {
            return (
                <div className="advanced-action disabled">
                    <i className="fa fa-solid fa-rotate-left" />
                    <div>
                        <div className="action-label">Restore from Backup</div>
                        <div className="action-description">No backup available</div>
                    </div>
                </div>
            );
        }

        return (
            <button className="advanced-action" onClick={handleRestore} disabled={restoring}>
                {restoring ? (
                    <i className="fa fa-solid fa-spinner fa-spin" />
                ) : (
                    <i className="fa fa-solid fa-rotate-left" />
                )}
                <div>
                    <div className="action-label">Restore from Backup</div>
                    <div className="action-description">Revert to last saved version</div>
                </div>
            </button>
        );
    }
);

RestoreAction.displayName = "RestoreAction";

export const AdvancedSection = memo(
    ({ config, configPath, backupExists, onImport, onReload }: AdvancedSectionProps) => {
        const [expanded, setExpanded] = useState(false);

        const handleToggle = useCallback(() => {
            setExpanded((prev) => !prev);
        }, []);

        const handleKeyDown = useCallback(
            (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleToggle();
                }
            },
            [handleToggle]
        );

        return (
            <div className="omp-advanced-section">
                <button
                    className={cn("advanced-toggle", { expanded })}
                    onClick={handleToggle}
                    onKeyDown={handleKeyDown}
                    aria-expanded={expanded}
                    aria-controls="advanced-content"
                >
                    <i className="fa fa-solid fa-chevron-right" />
                    <span>Advanced Options</span>
                </button>

                <div
                    id="advanced-content"
                    className={cn("advanced-content", { visible: expanded })}
                    role="region"
                    aria-label="Advanced options"
                    hidden={!expanded}
                >
                    <div className="advanced-actions">
                        <ImportAction onImport={onImport} />
                        <ExportAction config={config} />
                        <CopyAction config={config} />
                        <RestoreAction backupExists={backupExists} onReload={onReload} />
                    </div>
                </div>
            </div>
        );
    }
);

AdvancedSection.displayName = "AdvancedSection";

export { AdvancedSection };
