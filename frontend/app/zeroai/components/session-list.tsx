// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import * as React from "react";
import type { ZeroAiSession } from "../types";
import "./session-list.scss";

export interface SessionListProps {
    sessions: ZeroAiSession[];
    currentSessionId?: string;
    onSelectSession: (sessionId: string) => void;
    onCreateSession: () => void;
    onDeleteSession?: (sessionId: string) => void;
    className?: string;
}

interface SessionItemProps {
    session: ZeroAiSession;
    isActive: boolean;
    onSelect: () => void;
    onDelete?: () => void;
}

const SessionItem = React.memo(({ session, isActive, onSelect, onDelete }: SessionItemProps) => {
    const [isHovered, setIsHovered] = React.useState(false);
    const formatDate = React.useCallback((timestamp: number): string => {
        const date = new Date(timestamp * 1000);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        } else if (diffDays === 1) {
            return "Yesterday";
        } else if (diffDays < 7) {
            return date.toLocaleDateString([], { weekday: "short" });
        }
        return date.toLocaleDateString([], { month: "short", day: "numeric" });
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

    return (
        <div
            className={clsx("session-list-item", { active: isActive })}
            onClick={onSelect}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="session-item-header">
                <div className="session-item-icon">
                    <i className={makeIconClass(getBackendIcon(session.backend), false)} />
                </div>
                <div className="session-item-info">
                    <div className="session-item-title">
                        <span className="backend-name">{session.backend}</span>
                        <span className="model-name">{session.model}</span>
                    </div>
                    <div className="session-item-meta">
                        <span className="timestamp">{formatDate(session.updatedAt)}</span>
                        {session.workDir && (
                            <span className="workdir" title={session.workDir}>
                                <i className="fa-solid fa-folder" /> {session.workDir.split("/").pop()}
                            </span>
                        )}
                    </div>
                </div>
                {onDelete && isHovered && (
                    <button
                        className="session-item-delete"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                        aria-label="Delete session"
                    >
                        <i className="fa-solid fa-trash" />
                    </button>
                )}
            </div>
            {isActive && <div className="session-item-indicator" />}
        </div>
    );
});

SessionItem.displayName = "SessionItem";

export const SessionList = React.memo(
    ({
        sessions,
        currentSessionId,
        onSelectSession,
        onCreateSession,
        onDeleteSession,
        className,
    }: SessionListProps) => {
        const [filterText, setFilterText] = React.useState("");

        // Group sessions by backend
        const groupedSessions = React.useMemo(() => {
            const groups: Record<string, ZeroAiSession[]> = {};
            sessions.forEach((session) => {
                const backend = session.backend || "custom";
                if (!groups[backend]) {
                    groups[backend] = [];
                }
                groups[backend].push(session);
            });

            // Sort sessions within each group by updatedAt (newest first)
            Object.keys(groups).forEach((backend) => {
                groups[backend].sort((a, b) => b.updatedAt - a.updatedAt);
            });

            return groups;
        }, [sessions]);

        // Filter sessions based on search text
        const filteredSessions = React.useMemo(() => {
            if (!filterText) {
                return sessions;
            }
            const lowerFilter = filterText.toLowerCase();
            return sessions.filter(
                (session) =>
                    session.backend.toLowerCase().includes(lowerFilter) ||
                    session.model.toLowerCase().includes(lowerFilter) ||
                    session.workDir?.toLowerCase().includes(lowerFilter)
            );
        }, [sessions, filterText]);

        const sortedFilteredSessions = React.useMemo(() => {
            return [...filteredSessions].sort((a, b) => b.updatedAt - a.updatedAt);
        }, [filteredSessions]);

        const handleSort = () => {
            // Could add sort functionality here (by date, by backend, etc.)
        };

        return (
            <div className={clsx("session-list", className)}>
                <div className="session-list-header">
                    <div className="session-list-title">
                        <i className="fa-solid fa-clock-rotate-left" />
                        <span>Sessions</span>
                        <span className="session-count">{sessions.length}</span>
                    </div>
                    <button
                        className="session-list-create"
                        onClick={onCreateSession}
                        title="Create new session"
                        aria-label="Create new session"
                    >
                        <i className="fa-solid fa-plus" />
                    </button>
                </div>

                {sessions.length > 0 && (
                    <div className="session-list-search">
                        <i className="fa-solid fa-magnifying-glass search-icon" />
                        <input
                            type="text"
                            placeholder="Search sessions..."
                            value={filterText}
                            onChange={(e) => setFilterText(e.target.value)}
                            aria-label="Search sessions"
                        />
                        {filterText && (
                            <button
                                className="search-clear"
                                onClick={() => setFilterText("")}
                                aria-label="Clear search"
                            >
                                <i className="fa-solid fa-xmark" />
                            </button>
                        )}
                    </div>
                )}

                <div className="session-list-content">
                    {sortedFilteredSessions.length === 0 ? (
                        <div className="session-list-empty">
                            {filterText ? (
                                <>
                                    <i className="fa-solid fa-search empty-icon" />
                                    <p className="empty-text">No sessions found</p>
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-comments empty-icon" />
                                    <p className="empty-text">No sessions yet</p>
                                    <button className="empty-action" onClick={onCreateSession}>
                                        Create your first session
                                    </button>
                                </>
                            )}
                        </div>
                    ) : (
                        sortedFilteredSessions.map((session) => (
                            <SessionItem
                                key={session.id}
                                session={session}
                                isActive={session.id === currentSessionId}
                                onSelect={() => onSelectSession(session.id)}
                                onDelete={onDeleteSession ? () => onDeleteSession(session.id) : undefined}
                            />
                        ))
                    )}
                </div>
            </div>
        );
    }
);

SessionList.displayName = "SessionList";
