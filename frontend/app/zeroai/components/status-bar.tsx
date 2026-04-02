// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import * as React from "react";
import type { ZeroAiAgentInfo, ZeroAiSession } from "../types";
import "./status-bar.scss";

export interface StatusBarProps {
    session?: ZeroAiSession;
    agentInfo?: ZeroAiAgentInfo;
    isStreaming?: boolean;
    onWorkDirClick?: () => void;
    onModelClick?: () => void;
    className?: string;
}

export const StatusBar = React.memo(
    ({ session, agentInfo, isStreaming = false, onWorkDirClick, onModelClick, className }: StatusBarProps) => {
        const formatThinkingLevel = React.useCallback((level: string): string => {
            const levelMap: Record<string, string> = {
                low: "Low",
                medium: "Medium",
                high: "High",
            };
            return levelMap[level] || level;
        }, []);

        const getThinkingLevelIcon = React.useCallback((level: string): string => {
            const iconMap: Record<string, string> = {
                low: "fa-solid fa-brain",
                medium: "fa-solid fa-brain",
                high: "fa-solid fa-brain",
            };
            return iconMap[level] || "fa-solid fa-brain";
        }, []);

        const getThinkingLevelColor = React.useCallback((level: string): string => {
            const colorMap: Record<string, string> = {
                low: "rgba(239, 68, 68, 1)", // red
                medium: "rgba(234, 179, 8, 1)", // yellow
                high: "rgba(59, 130, 246, 1)", // blue
            };
            return colorMap[level] || "rgba(255, 255, 255, 0.6)";
        }, []);

        const getBackendIcon = React.useCallback((backend: string): string => {
            const iconMap: Record<string, string> = {
                claude: "fa-solid fa-brain",
                qwen: "fa-solid fa-sparkles",
                codex: "fa-solid fa-code",
                opencode: "fa-solid fa-code-branch",
                custom: "fa-solid fa-robot",
            };
            return iconMap[backend.toLowerCase()] || iconMap.custom;
        }, []);

        const getProviderIcon = React.useCallback((provider: string): string => {
            const iconMap: Record<string, string> = {
                anthropic: "fa-solid fa-cube",
                openai: "fa-solid fa-robot",
                qwen: "fa-solid fa-cloud",
                codex: "fa-solid fa-code",
            };
            return iconMap[provider.toLowerCase()] || "fa-solid fa-server";
        }, []);

        return (
            <div className={clsx("status-bar", className)}>
                <div className="status-bar-content">
                    {/* Backend/Provider Info */}
                    {session?.backend && (
                        <div className="status-bar-section status-bar-backend">
                            <div className="status-bar-item">
                                <i className={makeIconClass(getBackendIcon(session.backend), false)} />
                                <span className="status-bar-label">Backend:</span>
                                <span className="status-bar-value">{session.backend}</span>
                            </div>
                        </div>
                    )}

                    {/* Model Info */}
                    {session?.model && (
                        <div
                            className={clsx("status-bar-section status-bar-model", {
                                clickable: onModelClick != null,
                            })}
                            onClick={onModelClick}
                        >
                            <div className="status-bar-item">
                                {session.provider && (
                                    <i className={makeIconClass(getProviderIcon(session.provider), false)} />
                                )}
                                <span className="status-bar-label">Model:</span>
                                <span className="status-bar-value">{session.model}</span>
                            </div>
                        </div>
                    )}

                    {/* Thinking Level */}
                    {session?.thinkingLevel && (
                        <div className="status-bar-section status-bar-thinking">
                            <div className="status-bar-item">
                                <i
                                    className={makeIconClass(getThinkingLevelIcon(session.thinkingLevel), false)}
                                    style={{ color: getThinkingLevelColor(session.thinkingLevel) }}
                                />
                                <span className="status-bar-label">Thinking:</span>
                                <span
                                    className="status-bar-value"
                                    style={{ color: getThinkingLevelColor(session.thinkingLevel) }}
                                >
                                    {formatThinkingLevel(session.thinkingLevel)}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* YOLO Mode Badge */}
                    {session?.yoloMode && (
                        <div className="status-bar-section status-bar-yolo">
                            <div className="status-bar-item">
                                <i className="fa-solid fa-bolt" />
                                <span className="status-bar-value">YOLO</span>
                            </div>
                        </div>
                    )}

                    {/* Streaming Indicator */}
                    {isStreaming && (
                        <div className="status-bar-section status-bar-streaming">
                            <div className="status-bar-item">
                                <span className="streaming-dots">
                                    <span />
                                    <span />
                                    <span />
                                </span>
                                <span className="status-bar-value">Streaming</span>
                            </div>
                        </div>
                    )}

                    {/* Work Directory */}
                    {session?.workDir && (
                        <div
                            className={clsx("status-bar-section status-bar-workdir", {
                                clickable: onWorkDirClick != null,
                            })}
                            onClick={onWorkDirClick}
                        >
                            <div className="status-bar-item">
                                <i className="fa-solid fa-folder" />
                                <span className="status-bar-value workdir-path" title={session.workDir}>
                                    {session.workDir}
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Status Bar Actions */}
                <div className="status-bar-actions">
                    {agentInfo?.enabled && (
                        <div
                            className={clsx("status-bar-item status-indicator", {
                                online: true,
                            })}
                        >
                            <span className="status-dot" />
                            <span className="status-text">Online</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }
);

StatusBar.displayName = "StatusBar";
