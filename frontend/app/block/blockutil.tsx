// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { NumActiveConnColors } from "@/app/block/blockframe";
import { atoms, getConnStatusAtom, recordTEvent } from "@/app/store/global";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import DotsSvg from "../asset/dots-anim-4.svg";

/**
 * Gets a user-friendly display name for a connection.
 * - WSL: "wsl://Ubuntu" → "Ubuntu"
 * - Git Bash: "local:gitbash" → "Git Bash"
 * - Shell profiles: "cmd" → "CMD", "pwsh-7.5" → "PowerShell 7.5"
 * - Connections with display:name in config → use that
 */
function getConnectionDisplayName(
    connection: string,
    connectionsConfig?: Record<string, ConnKeywords>
): { displayName: string | null; icon: string; isWsl: boolean } {
    if (util.isBlank(connection)) {
        return { displayName: null, icon: "laptop", isWsl: false };
    }

    // WSL connections: wsl://DistroName → DistroName
    if (connection.startsWith("wsl://")) {
        const distroName = connection.substring(6); // Remove "wsl://"
        return { displayName: distroName, icon: "brands@linux", isWsl: true };
    }

    // Git Bash special case
    if (connection === "local:gitbash") {
        return { displayName: "Git Bash", icon: "brands@git-alt", isWsl: false };
    }

    // Other local:* patterns
    if (connection.startsWith("local:")) {
        const profileName = connection.substring(6); // Remove "local:"
        // Check if there's a display name in config
        if (connectionsConfig?.[connection]?.["display:name"]) {
            return { displayName: connectionsConfig[connection]["display:name"], icon: "terminal", isWsl: false };
        }
        // Format the profile name nicely
        return { displayName: formatShellName(profileName), icon: "terminal", isWsl: false };
    }

    // Plain "local" - no display name needed
    if (connection === "local") {
        return { displayName: null, icon: "laptop", isWsl: false };
    }

    // Check connections config for shell profiles (e.g., "cmd", "pwsh-7.5")
    if (connectionsConfig?.[connection]) {
        const connSettings = connectionsConfig[connection];
        // Check if it's a local shell profile
        const isLocalProfile =
            connSettings["conn:local"] === true ||
            (connSettings["conn:shellpath"] && !connSettings["ssh:hostname"]);

        if (isLocalProfile) {
            if (connSettings["display:name"]) {
                return { displayName: connSettings["display:name"], icon: "terminal", isWsl: false };
            }
            return { displayName: formatShellName(connection), icon: "terminal", isWsl: false };
        }
    }

    // Not a local connection - return null to indicate it's remote
    return { displayName: null, icon: "arrow-right-arrow-left", isWsl: false };
}

/**
 * Formats a shell profile name for display.
 * - "cmd" → "CMD"
 * - "pwsh" → "PowerShell"
 * - "pwsh-7.5" → "PowerShell 7.5"
 * - "bash" → "Bash"
 */
function formatShellName(name: string): string {
    if (!name) return name;

    const lowerName = name.toLowerCase();

    // PowerShell variants
    if (lowerName === "pwsh" || lowerName === "powershell") {
        return "PowerShell";
    }
    if (lowerName.startsWith("pwsh-")) {
        const version = name.substring(5);
        return `PowerShell ${version}`;
    }
    if (lowerName.startsWith("powershell-")) {
        const version = name.substring(11);
        return `PowerShell ${version}`;
    }

    // CMD
    if (lowerName === "cmd") {
        return "CMD";
    }

    // Bash variants
    if (lowerName === "bash" || lowerName === "gitbash") {
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    // Default: capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
}

export const colorRegex = /^((#[0-9a-f]{6,8})|([a-z]+))$/;

export function blockViewToIcon(view: string): string {
    if (view == "term") {
        return "terminal";
    }
    if (view == "preview") {
        return "file";
    }
    if (view == "web") {
        return "globe";
    }
    if (view == "waveai") {
        return "sparkles";
    }
    if (view == "help") {
        return "circle-question";
    }
    if (view == "tips") {
        return "lightbulb";
    }
    return "square";
}

export function blockViewToName(view: string): string {
    if (util.isBlank(view)) {
        return "(No View)";
    }
    if (view == "term") {
        return "Terminal";
    }
    if (view == "preview") {
        return "Preview";
    }
    if (view == "web") {
        return "Web";
    }
    if (view == "waveai") {
        return "WaveAI";
    }
    if (view == "help") {
        return "Help";
    }
    if (view == "tips") {
        return "Tips";
    }
    return view;
}

export function processTitleString(titleString: string): React.ReactNode[] {
    if (titleString == null) {
        return null;
    }
    const tagRegex = /<(\/)?([a-z]+)(?::([#a-z0-9@-]+))?>/g;
    let lastIdx = 0;
    let match;
    let partsStack = [[]];
    while ((match = tagRegex.exec(titleString)) != null) {
        const lastPart = partsStack[partsStack.length - 1];
        const before = titleString.substring(lastIdx, match.index);
        lastPart.push(before);
        lastIdx = match.index + match[0].length;
        const [_, isClosing, tagName, tagParam] = match;
        if (tagName == "icon" && !isClosing) {
            if (tagParam == null) {
                continue;
            }
            const iconClass = util.makeIconClass(tagParam, false);
            if (iconClass == null) {
                continue;
            }
            lastPart.push(<i key={match.index} className={iconClass} />);
            continue;
        }
        if (tagName == "c" || tagName == "color") {
            if (isClosing) {
                if (partsStack.length <= 1) {
                    continue;
                }
                partsStack.pop();
                continue;
            }
            if (tagParam == null) {
                continue;
            }
            if (!tagParam.match(colorRegex)) {
                continue;
            }
            let children = [];
            const rtag = React.createElement("span", { key: match.index, style: { color: tagParam } }, children);
            lastPart.push(rtag);
            partsStack.push(children);
            continue;
        }
        if (tagName == "i" || tagName == "b") {
            if (isClosing) {
                if (partsStack.length <= 1) {
                    continue;
                }
                partsStack.pop();
                continue;
            }
            let children = [];
            const rtag = React.createElement(tagName, { key: match.index }, children);
            lastPart.push(rtag);
            partsStack.push(children);
            continue;
        }
    }
    partsStack[partsStack.length - 1].push(titleString.substring(lastIdx));
    return partsStack[0];
}

export function getBlockHeaderIcon(blockIcon: string, blockData: Block): React.ReactNode {
    let blockIconElem: React.ReactNode = null;
    if (util.isBlank(blockIcon)) {
        blockIcon = "square";
    }
    let iconColor = blockData?.meta?.["icon:color"];
    if (iconColor && !iconColor.match(colorRegex)) {
        iconColor = null;
    }
    let iconStyle = null;
    if (!util.isBlank(iconColor)) {
        iconStyle = { color: iconColor };
    }
    const iconClass = util.makeIconClass(blockIcon, true);
    if (iconClass != null) {
        blockIconElem = <i key="icon" style={iconStyle} className={clsx(`block-frame-icon`, iconClass)} />;
    }
    return blockIconElem;
}

interface ConnectionButtonProps {
    connection: string;
    changeConnModalAtom: jotai.PrimitiveAtom<boolean>;
}

export function computeConnColorNum(connStatus: ConnStatus): number {
    // activeconnnum is 1-indexed, so we need to adjust for when mod is 0
    const connColorNum = (connStatus?.activeconnnum ?? 1) % NumActiveConnColors;
    if (connColorNum == 0) {
        return NumActiveConnColors;
    }
    return connColorNum;
}

export const ConnectionButton = React.memo(
    React.forwardRef<HTMLDivElement, ConnectionButtonProps>(
        ({ connection, changeConnModalAtom }: ConnectionButtonProps, ref) => {
            const [connModalOpen, setConnModalOpen] = jotai.useAtom(changeConnModalAtom);
            const fullConfig = jotai.useAtomValue(atoms.fullConfigAtom);
            const connectionsConfig = fullConfig?.connections;

            // Check if this is a local connection (includes WSL and local shell profiles)
            const isLocal = util.isLocalConnection(connection, connectionsConfig);
            const { displayName, icon, isWsl } = getConnectionDisplayName(connection, connectionsConfig);

            const connStatusAtom = getConnStatusAtom(connection);
            const connStatus = jotai.useAtomValue(connStatusAtom);
            let showDisconnectedSlash = false;
            let connIconElem: React.ReactNode = null;
            const connColorNum = computeConnColorNum(connStatus);
            let color = `var(--conn-icon-color-${connColorNum})`;
            const clickHandler = function () {
                recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "mouse" });
                setConnModalOpen(true);
            };
            let titleText = null;
            let shouldSpin = false;

            if (isLocal) {
                // Local connections (local, local:*, wsl://, and local shell profiles)
                color = "var(--grey-text-color)";
                if (displayName) {
                    titleText = `Connected to ${displayName}`;
                } else {
                    titleText = "Connected to Local Machine";
                }
                connIconElem = (
                    <i
                        className={clsx(util.makeIconClass(icon, false), "fa-stack-1x")}
                        style={{ color: color, marginRight: 2 }}
                    />
                );
            } else {
                // Remote connections (SSH)
                titleText = "Connected to " + connection;
                let iconName = "arrow-right-arrow-left";
                let iconSvg = null;
                if (connStatus?.status == "connecting") {
                    color = "var(--warning-color)";
                    titleText = "Connecting to " + connection;
                    shouldSpin = false;
                    iconSvg = (
                        <div className="connecting-svg">
                            <DotsSvg />
                        </div>
                    );
                } else if (connStatus?.status == "error") {
                    color = "var(--error-color)";
                    titleText = "Error connecting to " + connection;
                    if (connStatus?.error != null) {
                        titleText += " (" + connStatus.error + ")";
                    }
                    showDisconnectedSlash = true;
                } else if (!connStatus?.connected) {
                    color = "var(--grey-text-color)";
                    titleText = "Disconnected from " + connection;
                    showDisconnectedSlash = true;
                }
                if (iconSvg != null) {
                    connIconElem = iconSvg;
                } else {
                    connIconElem = (
                        <i
                            className={clsx(util.makeIconClass(iconName, false), "fa-stack-1x")}
                            style={{ color: color, marginRight: 2 }}
                        />
                    );
                }
            }

            // Determine what to display as the connection name
            const connDisplayName = displayName ?? (isLocal ? null : connection);

            return (
                <div ref={ref} className={clsx("connection-button")} onClick={clickHandler} title={titleText}>
                    <span className={clsx("fa-stack connection-icon-box", shouldSpin ? "fa-spin" : null)}>
                        {connIconElem}
                        <i
                            className="fa-slash fa-solid fa-stack-1x"
                            style={{
                                color: color,
                                marginRight: "2px",
                                textShadow: "0 1px black, 0 1.5px black",
                                opacity: showDisconnectedSlash ? 1 : 0,
                            }}
                        />
                    </span>
                    {connDisplayName && <div className="connection-name ellipsis">{connDisplayName}</div>}
                </div>
            );
        }
    )
);

/**
 * Gets shell profile display info from a profile ID.
 * Falls back to formatting the ID as a display name if no profile config exists.
 */
function getShellProfileDisplayInfo(
    profileId: string,
    shellProfiles?: Record<string, ShellProfileType>
): { displayName: string; icon: string } {
    if (util.isBlank(profileId)) {
        return { displayName: "Default Shell", icon: "terminal" };
    }

    // Check configured shell profiles
    if (shellProfiles?.[profileId]) {
        const profile = shellProfiles[profileId];
        return {
            displayName: profile["display:name"] || formatShellName(profileId),
            icon: profile["display:icon"] || getShellIcon(profileId, profile),
        };
    }

    // Handle WSL profile IDs (wsl:DistroName)
    if (profileId.startsWith("wsl:")) {
        const distroName = profileId.substring(4);
        return { displayName: distroName, icon: "brands@linux" };
    }

    // Fallback to formatted profile ID
    return { displayName: formatShellName(profileId), icon: getShellIcon(profileId, null) };
}

/**
 * Gets appropriate icon for a shell profile.
 */
function getShellIcon(profileId: string, profile: ShellProfileType | null): string {
    // Check if profile has a custom icon
    if (profile?.["display:icon"]) {
        return profile["display:icon"];
    }

    // WSL distros
    if (profile?.["shell:iswsl"] || profileId.startsWith("wsl:")) {
        return "brands@linux";
    }

    const lowerId = profileId.toLowerCase();

    // PowerShell
    if (lowerId.includes("pwsh") || lowerId.includes("powershell")) {
        return "terminal"; // Could use brands@windows but terminal is more recognizable
    }

    // CMD
    if (lowerId === "cmd") {
        return "brands@windows";
    }

    // Git Bash
    if (lowerId.includes("gitbash") || lowerId.includes("git-bash")) {
        return "brands@git-alt";
    }

    // Bash/Zsh/Fish/Other Unix shells
    if (lowerId === "bash" || lowerId === "zsh" || lowerId === "fish" || lowerId === "sh") {
        return "terminal";
    }

    // Default
    return "terminal";
}

interface ShellButtonProps {
    shellProfile: string;
    changeShellModalAtom: jotai.PrimitiveAtom<boolean>;
}

/**
 * ShellButton displays the current shell name for local shells.
 * Unlike ConnectionButton, it has no connection status indicators since shells
 * are local processes, not network connections.
 */
export const ShellButton = React.memo(
    React.forwardRef<HTMLDivElement, ShellButtonProps>(
        ({ shellProfile, changeShellModalAtom }: ShellButtonProps, ref) => {
            const [shellModalOpen, setShellModalOpen] = jotai.useAtom(changeShellModalAtom);
            const fullConfig = jotai.useAtomValue(atoms.fullConfigAtom);
            const shellProfiles = fullConfig?.settings?.["shell:profiles"];

            const { displayName, icon } = getShellProfileDisplayInfo(shellProfile, shellProfiles);

            const clickHandler = function () {
                recordTEvent("action:other", { "action:type": "shellselector", "action:initiator": "mouse" });
                setShellModalOpen(true);
            };

            const titleText = `Shell: ${displayName}`;

            return (
                <div ref={ref} className={clsx("shell-button")} onClick={clickHandler} title={titleText}>
                    <i
                        className={clsx(util.makeIconClass(icon, false), "shell-icon")}
                        style={{ color: "var(--grey-text-color)", marginRight: 4 }}
                    />
                    <div className="shell-name ellipsis">{displayName}</div>
                </div>
            );
        }
    )
);

export const Input = React.memo(
    ({ decl, className, preview }: { decl: HeaderInput; className: string; preview: boolean }) => {
        const { value, ref, isDisabled, onChange, onKeyDown, onFocus, onBlur } = decl;
        return (
            <div className="input-wrapper">
                <input
                    ref={
                        !preview
                            ? ref
                            : undefined /* don't wire up the input field if the preview block is being rendered */
                    }
                    disabled={isDisabled}
                    className={className}
                    value={value}
                    onChange={(e) => onChange(e)}
                    onKeyDown={(e) => onKeyDown(e)}
                    onFocus={(e) => onFocus(e)}
                    onBlur={(e) => onBlur(e)}
                    onDragStart={(e) => e.preventDefault()}
                />
            </div>
        );
    }
);
