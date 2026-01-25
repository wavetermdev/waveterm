// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { cn } from "@/util/util";
import { memo } from "react";

// ============================================
// Types
// ============================================

export type ModeStatus = "ready" | "incomplete" | "local" | "cloud";

interface ProviderStatusBadgeProps {
    status: ModeStatus;
    secretName?: string;
    endpoint?: string;
    onNavigateToSecrets?: () => void;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Check if an endpoint URL is local (localhost, LAN, etc.)
 */
export function isLocalEndpoint(endpoint: string | undefined): boolean {
    if (!endpoint) return false;
    try {
        const url = new URL(endpoint);
        return (
            url.hostname === "localhost" ||
            url.hostname === "127.0.0.1" ||
            url.hostname === "::1" ||
            url.hostname === "0.0.0.0" ||
            url.hostname.endsWith(".local") ||
            url.hostname.startsWith("192.168.") ||
            url.hostname.startsWith("10.") ||
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(url.hostname)
        );
    } catch {
        return false;
    }
}

/**
 * Compute the status of an AI mode based on its configuration and available secrets
 */
export function computeModeStatus(
    modeKey: string,
    mode: AIModeConfigType,
    secretNames: Set<string>
): ModeStatus {
    // Wave Cloud modes are always ready (managed by Wave)
    if (modeKey.startsWith("waveai@")) {
        return "cloud";
    }

    // Check if it's a local provider (no API key needed)
    const endpoint = mode["ai:endpoint"] || "";
    if (isLocalEndpoint(endpoint)) {
        return "local";
    }

    // Check if API key is required and present
    const secretName = mode["ai:apitokensecretname"];
    if (secretName) {
        return secretNames.has(secretName) ? "ready" : "incomplete";
    }

    // If there's a direct API token, it's ready
    if (mode["ai:apitoken"]) {
        return "ready";
    }

    // Default to ready for modes that don't require authentication
    return "ready";
}

// ============================================
// Status Badge Component
// ============================================

interface StatusIconProps {
    status: ModeStatus;
}

const StatusIcon = memo(({ status }: StatusIconProps) => {
    switch (status) {
        case "ready":
            return <i className="fa fa-solid fa-check-circle" />;
        case "incomplete":
            return <i className="fa fa-solid fa-exclamation-triangle" />;
        case "local":
            return <i className="fa fa-solid fa-server" />;
        case "cloud":
            return <i className="fa fa-solid fa-cloud" />;
        default:
            return null;
    }
});

StatusIcon.displayName = "StatusIcon";

// ============================================
// Tooltip Content Component
// ============================================

interface StatusTooltipContentProps {
    status: ModeStatus;
    secretName?: string;
    endpoint?: string;
    onNavigateToSecrets?: () => void;
}

export const StatusTooltipContent = memo(
    ({ status, secretName, endpoint, onNavigateToSecrets }: StatusTooltipContentProps) => {
        switch (status) {
            case "ready":
                return (
                    <div className="waveai-status-tooltip">
                        <div className="waveai-tooltip-header ready">
                            <i className="fa fa-solid fa-check-circle" />
                            <span>Ready</span>
                        </div>
                        <div className="waveai-tooltip-body">
                            This provider is fully configured and ready to use.
                        </div>
                    </div>
                );

            case "incomplete":
                return (
                    <div className="waveai-status-tooltip">
                        <div className="waveai-tooltip-header incomplete">
                            <i className="fa fa-solid fa-exclamation-triangle" />
                            <span>API Key Required</span>
                        </div>
                        <div className="waveai-tooltip-body">
                            <p>This provider needs an API key to function.</p>
                            {secretName && (
                                <p className="waveai-tooltip-secret">
                                    Secret Name: <code>{secretName}</code>
                                </p>
                            )}
                            {onNavigateToSecrets && (
                                <button
                                    className="waveai-tooltip-link"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onNavigateToSecrets();
                                    }}
                                >
                                    <i className="fa fa-solid fa-key" />
                                    Set API Key in Secrets
                                </button>
                            )}
                        </div>
                    </div>
                );

            case "local":
                return (
                    <div className="waveai-status-tooltip">
                        <div className="waveai-tooltip-header local">
                            <i className="fa fa-solid fa-server" />
                            <span>Local Provider</span>
                        </div>
                        <div className="waveai-tooltip-body">
                            <p>No API key required.</p>
                            {endpoint && (
                                <p className="waveai-tooltip-endpoint">
                                    Make sure the local server is running at:
                                    <code>{endpoint}</code>
                                </p>
                            )}
                        </div>
                    </div>
                );

            case "cloud":
                return (
                    <div className="waveai-status-tooltip">
                        <div className="waveai-tooltip-header cloud">
                            <i className="fa fa-solid fa-cloud" />
                            <span>Wave Cloud</span>
                        </div>
                        <div className="waveai-tooltip-body">
                            Managed by Wave. No configuration required.
                        </div>
                    </div>
                );

            default:
                return null;
        }
    }
);

StatusTooltipContent.displayName = "StatusTooltipContent";

// ============================================
// Main Badge Component
// ============================================

export const ProviderStatusBadge = memo(
    ({ status, secretName, endpoint, onNavigateToSecrets }: ProviderStatusBadgeProps) => {
        const getAriaLabel = () => {
            switch (status) {
                case "ready":
                    return "Status: Ready";
                case "incomplete":
                    return `Status: API key required${secretName ? ` for ${secretName}` : ""}`;
                case "local":
                    return "Status: Local provider";
                case "cloud":
                    return "Status: Wave Cloud (managed)";
                default:
                    return "Status: Unknown";
            }
        };

        return (
            <Tooltip
                content={
                    <StatusTooltipContent
                        status={status}
                        secretName={secretName}
                        endpoint={endpoint}
                        onNavigateToSecrets={onNavigateToSecrets}
                    />
                }
                placement="left"
            >
                <div
                    className={cn("waveai-status-badge", `status-${status}`)}
                    aria-label={getAriaLabel()}
                    role="status"
                    tabIndex={0}
                >
                    <StatusIcon status={status} />
                </div>
            </Tooltip>
        );
    }
);

ProviderStatusBadge.displayName = "ProviderStatusBadge";
