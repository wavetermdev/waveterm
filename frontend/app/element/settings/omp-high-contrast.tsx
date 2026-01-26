// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * OMP High Contrast Component
 *
 * Detects transparent segments in OMP configurations and provides
 * a toggle to automatically add contrasting backgrounds for better
 * readability across different terminal backgrounds.
 */

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useState } from "react";

import "./omp-high-contrast.scss";

interface OmpHighContrastProps {
    className?: string;
}

type AnalysisState = "idle" | "loading" | "success" | "error";
type ApplyState = "idle" | "applying" | "success" | "error";

export const OmpHighContrast = memo(({ className }: OmpHighContrastProps) => {
    const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
    const [analysis, setAnalysis] = useState<CommandOmpAnalyzeRtnData | null>(null);
    const [applyState, setApplyState] = useState<ApplyState>("idle");
    const [errorMessage, setErrorMessage] = useState<string>("");
    const [showDetails, setShowDetails] = useState(false);
    const [lastApplyResult, setLastApplyResult] = useState<{ success: boolean; backupPath?: string } | null>(null);

    // Define analyzeConfig BEFORE the useEffect that uses it (TDZ fix)
    const analyzeConfig = useCallback(async () => {
        setAnalysisState("loading");
        setErrorMessage("");

        try {
            const result = await RpcApi.OmpAnalyzeCommand(TabRpcClient, {});

            if (result.error) {
                setAnalysisState("error");
                setErrorMessage(result.error);
                return;
            }

            setAnalysis(result);
            setAnalysisState("success");
        } catch (err) {
            setAnalysisState("error");
            setErrorMessage(err instanceof Error ? err.message : "Failed to analyze OMP config");
        }
    }, []);

    // Analyze on mount (placed AFTER analyzeConfig definition to avoid TDZ)
    useEffect(() => {
        analyzeConfig();
    }, [analyzeConfig]);

    const handleApplyHighContrast = useCallback(async () => {
        if (applyState === "applying") return;

        setApplyState("applying");
        setErrorMessage("");

        try {
            const result = await RpcApi.OmpApplyHighContrastCommand(TabRpcClient, {
                createbackup: true,
            });

            if (result.error) {
                setApplyState("error");
                setErrorMessage(result.error);
                return;
            }

            setApplyState("success");
            setLastApplyResult({
                success: result.success,
                backupPath: result.backuppath,
            });

            // Re-analyze to show updated state
            setTimeout(() => {
                analyzeConfig();
                setApplyState("idle");
            }, 2000);
        } catch (err) {
            setApplyState("error");
            setErrorMessage(err instanceof Error ? err.message : "Failed to apply high contrast mode");
        }
    }, [applyState, analyzeConfig]);

    const handleRestoreBackup = useCallback(async () => {
        if (applyState === "applying") return;

        setApplyState("applying");
        setErrorMessage("");

        try {
            const result = await RpcApi.OmpRestoreBackupCommand(TabRpcClient, {});

            if (result.error) {
                setApplyState("error");
                setErrorMessage(result.error);
                return;
            }

            setApplyState("success");
            setLastApplyResult(null);

            // Re-analyze to show updated state
            setTimeout(() => {
                analyzeConfig();
                setApplyState("idle");
            }, 2000);
        } catch (err) {
            setApplyState("error");
            setErrorMessage(err instanceof Error ? err.message : "Failed to restore backup");
        }
    }, [applyState, analyzeConfig]);

    const toggleDetails = useCallback((e: React.MouseEvent) => {
        e.preventDefault(); // Prevent native <details> toggle (avoids double-toggle)
        setShowDetails((prev) => !prev);
    }, []);

    // Loading state
    if (analysisState === "loading") {
        return (
            <div className={cn("omp-high-contrast", className)}>
                <div className="omp-hc-loading">
                    <i className="fa fa-solid fa-spinner fa-spin" />
                    <span>Analyzing OMP configuration...</span>
                </div>
            </div>
        );
    }

    // Error state
    if (analysisState === "error") {
        return (
            <div className={cn("omp-high-contrast", className)}>
                <div className="omp-hc-error">
                    <i className="fa fa-solid fa-exclamation-triangle" />
                    <span>{errorMessage || "Failed to analyze OMP configuration"}</span>
                    <button type="button" className="retry-button" onClick={analyzeConfig}>
                        <i className="fa fa-solid fa-refresh" />
                        <span>Retry</span>
                    </button>
                </div>
            </div>
        );
    }

    // No transparency detected
    if (!analysis?.hastransparency) {
        return (
            <div className={cn("omp-high-contrast", className)}>
                <div className="omp-hc-ok">
                    <i className="fa fa-solid fa-check-circle" />
                    <span>Your OMP theme has no transparent segments that need adjustment.</span>
                </div>
            </div>
        );
    }

    // Transparency detected - show warning and toggle
    const segmentCount = analysis.transparentsegments?.length ?? 0;

    return (
        <div className={cn("omp-high-contrast", className)}>
            <div className="omp-hc-warning">
                <i className="fa fa-solid fa-exclamation-triangle" />
                <div className="warning-content">
                    <span className="warning-title">
                        This theme has {segmentCount} transparent segment{segmentCount !== 1 ? "s" : ""}
                    </span>
                    <span className="warning-description">
                        Transparent segments may be hard to read on some terminal backgrounds.
                    </span>
                </div>
            </div>

            <div className="omp-hc-actions">
                <button
                    type="button"
                    className={cn("apply-button", {
                        applying: applyState === "applying",
                        success: applyState === "success",
                    })}
                    onClick={handleApplyHighContrast}
                    disabled={applyState === "applying"}
                >
                    {applyState === "applying" ? (
                        <>
                            <i className="fa fa-solid fa-spinner fa-spin" />
                            <span>Applying...</span>
                        </>
                    ) : applyState === "success" ? (
                        <>
                            <i className="fa fa-solid fa-check" />
                            <span>Applied!</span>
                        </>
                    ) : (
                        <>
                            <i className="fa fa-solid fa-wand-magic-sparkles" />
                            <span>Apply High Contrast Mode</span>
                        </>
                    )}
                </button>

                {lastApplyResult?.backupPath && (
                    <button
                        type="button"
                        className="restore-button"
                        onClick={handleRestoreBackup}
                        disabled={applyState === "applying"}
                    >
                        <i className="fa fa-solid fa-undo" />
                        <span>Restore Original</span>
                    </button>
                )}
            </div>

            <p className="omp-hc-description">
                High contrast mode automatically adds contrasting backgrounds to transparent segments based on their
                foreground color luminance. A backup of your original config will be created.
            </p>

            {applyState === "error" && errorMessage && (
                <div className="omp-hc-apply-error">
                    <i className="fa fa-solid fa-times-circle" />
                    <span>{errorMessage}</span>
                </div>
            )}

            {segmentCount > 0 && (
                <details className="omp-hc-details" open={showDetails}>
                    <summary onClick={toggleDetails}>
                        <i className={cn("fa fa-solid", showDetails ? "fa-chevron-down" : "fa-chevron-right")} />
                        <span>View affected segments ({segmentCount})</span>
                    </summary>
                    <ul className="segment-list">
                        {analysis.transparentsegments.map((seg, i) => (
                            <li key={i} className="segment-item">
                                <span className="segment-location">
                                    Block {seg.blockindex + 1}, Segment {seg.segmentindex + 1}
                                </span>
                                <span className="segment-type">{seg.segmenttype}</span>
                                {seg.foreground && (
                                    <span className="segment-fg">
                                        <span
                                            className="fg-swatch"
                                            style={{ backgroundColor: seg.foreground }}
                                            title={seg.foreground}
                                        />
                                        <code>{seg.foreground}</code>
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
});

OmpHighContrast.displayName = "OmpHighContrast";
