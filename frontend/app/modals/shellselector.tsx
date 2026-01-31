// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TypeAheadModal } from "@/app/modals/typeaheadmodal";
import { atoms, globalStore, WOS } from "@/app/store/global";
import { globalRefocusWithTimeout } from "@/app/store/keymodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { NodeModel } from "@/layout/index";
import * as keyutil from "@/util/keyutil";
import * as jotai from "jotai";
import * as React from "react";

/**
 * Gets appropriate icon for a shell type.
 */
function getShellIcon(shellId: string, profile?: ShellProfileType): string {
    if (profile?.["display:icon"]) {
        return profile["display:icon"];
    }

    // WSL distros
    if (profile?.["shell:iswsl"] || shellId.startsWith("wsl:")) {
        const distroName = (profile?.["shell:wsldistro"] || shellId.substring(4)).toLowerCase();
        if (distroName.includes("ubuntu")) return "brands@ubuntu";
        if (distroName.includes("debian")) return "brands@debian";
        if (distroName.includes("fedora")) return "brands@fedora";
        if (distroName.includes("opensuse") || distroName.includes("suse")) return "brands@suse";
        return "brands@linux";
    }

    const lowerId = shellId.toLowerCase();

    // PowerShell
    if (lowerId.includes("pwsh") || lowerId.includes("powershell")) {
        return "terminal";
    }

    // CMD
    if (lowerId === "cmd") {
        return "brands@windows";
    }

    // Git Bash
    if (lowerId.includes("gitbash") || lowerId.includes("git-bash")) {
        return "brands@git-alt";
    }

    // Default
    return "terminal";
}

/**
 * Formats a shell profile name for display.
 */
function formatShellDisplayName(shellId: string, profile?: ShellProfileType): string {
    if (profile?.["display:name"]) {
        return profile["display:name"];
    }

    // WSL distros: show just the distro name
    if (shellId.startsWith("wsl:")) {
        return shellId.substring(4);
    }

    const lowerId = shellId.toLowerCase();

    // PowerShell variants
    if (lowerId === "pwsh" || lowerId === "powershell") {
        return "PowerShell";
    }
    if (lowerId.startsWith("pwsh-")) {
        return `PowerShell ${shellId.substring(5)}`;
    }

    // CMD
    if (lowerId === "cmd") {
        return "CMD";
    }

    // Default: capitalize first letter
    return shellId.charAt(0).toUpperCase() + shellId.slice(1);
}

/**
 * Creates shell suggestion items from configured shell profiles.
 * Filters out hidden profiles.
 */
function createShellSuggestionItems(
    shellProfiles: Record<string, ShellProfileType> | undefined,
    currentShell: string,
    defaultShell: string,
    filterText: string
): Array<SuggestionConnectionItem> {
    if (!shellProfiles) return [];

    const items: Array<SuggestionConnectionItem> = [];
    const normalizedFilter = filterText.toLowerCase();

    // Sort entries by display order, then by name
    const sortedEntries = Object.entries(shellProfiles).sort(([idA, profileA], [idB, profileB]) => {
        const orderA = profileA["display:order"] ?? 0;
        const orderB = profileB["display:order"] ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        const nameA = profileA["display:name"] || idA;
        const nameB = profileB["display:name"] || idB;
        return nameA.localeCompare(nameB);
    });

    for (const [shellId, profile] of sortedEntries) {
        // Skip hidden profiles
        if (profile.hidden) continue;

        const displayName = formatShellDisplayName(shellId, profile);
        const icon = getShellIcon(shellId, profile);
        const isDefault = shellId === defaultShell;
        const label = isDefault ? `${displayName} (default)` : displayName;

        // Filter by search text
        if (normalizedFilter && !displayName.toLowerCase().includes(normalizedFilter) && !shellId.toLowerCase().includes(normalizedFilter)) {
            continue;
        }

        items.push({
            status: "connected",
            icon: icon,
            iconColor: "var(--grey-text-color)",
            value: shellId,
            label: label,
            current: shellId === currentShell,
        });
    }

    return items;
}

/**
 * Creates WSL distribution suggestion items.
 */
function createWslSuggestionItems(
    wslList: Array<string>,
    currentShell: string,
    defaultShell: string
): Array<SuggestionConnectionItem> {
    return wslList.map((distroName) => {
        const shellId = `wsl:${distroName}`;
        const icon = getShellIcon(shellId, null);
        const isDefault = shellId === defaultShell;
        const label = isDefault ? `${distroName} (default)` : distroName;

        return {
            status: "connected",
            icon: icon,
            iconColor: "var(--grey-text-color)",
            value: shellId,
            label: label,
            current: shellId === currentShell,
        };
    });
}

/**
 * Creates built-in shell suggestion items (cmd, pwsh, etc.).
 */
function createBuiltInShellItems(
    currentShell: string,
    defaultShell: string,
    filterText: string
): Array<SuggestionConnectionItem> {
    const builtInShells = [
        { id: "pwsh", name: "PowerShell", icon: "terminal" },
        { id: "cmd", name: "CMD", icon: "brands@windows" },
    ];

    const items: Array<SuggestionConnectionItem> = [];
    const normalizedFilter = filterText.toLowerCase();

    for (const shell of builtInShells) {
        // Filter by search text
        if (normalizedFilter && !shell.name.toLowerCase().includes(normalizedFilter) && !shell.id.includes(normalizedFilter)) {
            continue;
        }

        const isDefault = shell.id === defaultShell;
        const label = isDefault ? `${shell.name} (default)` : shell.name;

        items.push({
            status: "connected",
            icon: shell.icon,
            iconColor: "var(--grey-text-color)",
            value: shell.id,
            label: label,
            current: shell.id === currentShell,
        });
    }

    return items;
}

interface ShellSelectorModalProps {
    blockId: string;
    blockRef: React.RefObject<HTMLDivElement>;
    shellBtnRef: React.RefObject<HTMLDivElement>;
    changeShellModalAtom: jotai.PrimitiveAtom<boolean>;
    nodeModel: NodeModel;
}

/**
 * Shell Selector Modal
 *
 * Allows users to select a shell profile for their terminal.
 * Unlike the connection modal, this only shows local shells (not remote connections).
 */
const ShellSelectorModal = React.memo(
    ({ blockId, blockRef, shellBtnRef, changeShellModalAtom, nodeModel }: ShellSelectorModalProps) => {
        const [filterText, setFilterText] = React.useState("");
        const shellModalOpen = jotai.useAtomValue(changeShellModalAtom);
        const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
        const isNodeFocused = jotai.useAtomValue(nodeModel.isFocused);
        const currentShell = blockData?.meta?.["shell:profile"] || "";
        const [rowIndex, setRowIndex] = React.useState(0);
        const [wslList, setWslList] = React.useState<Array<string>>([]);
        const fullConfig = jotai.useAtomValue(atoms.fullConfigAtom);
        const shellProfiles = fullConfig?.settings?.["shell:profiles"];
        const defaultShell = fullConfig?.settings?.["shell:default"] || "pwsh";

        // Load WSL distributions when modal opens
        React.useEffect(() => {
            if (!shellModalOpen) {
                setWslList([]);
                return;
            }

            const loadWsl = async () => {
                try {
                    const list = await RpcApi.WslListCommand(TabRpcClient, { timeout: 2000 });
                    setWslList(list ?? []);
                } catch (e) {
                    // WSL not available on this system - that's fine
                }
            };
            loadWsl();
        }, [shellModalOpen]);

        const changeShell = React.useCallback(
            async (shellId: string) => {
                if (shellId === currentShell) {
                    return;
                }

                // Set the shell:profile metadata on the block
                await RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { "shell:profile": shellId || null },
                });
            },
            [blockId, currentShell]
        );

        // Build suggestion groups
        const suggestions: Array<SuggestionsType> = [];

        // Determine effective current shell (empty means using default)
        const effectiveCurrentShell = currentShell || defaultShell || "pwsh";

        // Check if we have shell profiles configured
        const hasProfiles = shellProfiles && Object.keys(shellProfiles).length > 0;

        // Windows/Local Shells group
        const localShells: Array<SuggestionConnectionItem> = [];

        if (hasProfiles) {
            // Use configured shell profiles (which includes detected shells)
            // Filter out WSL profiles - they go in their own group
            const nonWslProfiles = Object.fromEntries(
                Object.entries(shellProfiles).filter(([id, profile]) => !profile["shell:iswsl"] && !id.startsWith("wsl:"))
            );
            const profileItems = createShellSuggestionItems(nonWslProfiles, effectiveCurrentShell, defaultShell, filterText);
            localShells.push(...profileItems);

            // WSL profiles from shell:profiles
            const wslProfiles = Object.fromEntries(
                Object.entries(shellProfiles).filter(([id, profile]) => profile["shell:iswsl"] || id.startsWith("wsl:"))
            );
            const wslProfileItems = createShellSuggestionItems(wslProfiles, effectiveCurrentShell, defaultShell, filterText);

            if (localShells.length > 0) {
                suggestions.push({
                    headerText: "Shells",
                    items: localShells,
                });
            }

            // Also check for WSL distros not in profiles
            const existingWslIds = new Set(Object.keys(wslProfiles));
            const additionalWslDistros = wslList.filter((distro) => !existingWslIds.has(`wsl:${distro}`));
            const filteredAdditionalWsl = additionalWslDistros.filter((distro) =>
                !filterText || distro.toLowerCase().includes(filterText.toLowerCase())
            );
            const additionalWslItems = createWslSuggestionItems(filteredAdditionalWsl, effectiveCurrentShell, defaultShell);

            // Combine WSL items
            const allWslItems = [...wslProfileItems, ...additionalWslItems];
            if (allWslItems.length > 0) {
                suggestions.push({
                    headerText: "WSL Distributions",
                    items: allWslItems,
                });
            }
        } else {
            // Fallback: show built-in shells when no profiles configured
            localShells.push(...createBuiltInShellItems(effectiveCurrentShell, defaultShell, filterText));

            if (localShells.length > 0) {
                suggestions.push({
                    headerText: "Windows Shells",
                    items: localShells,
                });
            }

            // WSL Distributions group from live query
            const filteredWsl = wslList.filter((distro) =>
                !filterText || distro.toLowerCase().includes(filterText.toLowerCase())
            );
            const wslItems = createWslSuggestionItems(filteredWsl, effectiveCurrentShell, defaultShell);

            if (wslItems.length > 0) {
                suggestions.push({
                    headerText: "WSL Distributions",
                    items: wslItems,
                });
            }
        }

        // Flatten selection list for keyboard navigation
        let selectionList: Array<SuggestionConnectionItem> = suggestions.flatMap((item) => {
            if ("items" in item) {
                return item.items;
            }
            return item;
        });

        // Highlight selected row
        selectionList = selectionList.map((item, index) => {
            if (index === rowIndex && item.iconColor === "var(--grey-text-color)") {
                return { ...item, iconColor: "var(--main-text-color)" };
            }
            return item;
        });

        const handleKeyDown = React.useCallback(
            (waveEvent: WaveKeyboardEvent): boolean => {
                if (keyutil.checkKeyPressed(waveEvent, "Enter")) {
                    const rowItem = selectionList[rowIndex];
                    if (rowItem) {
                        changeShell(rowItem.value);
                        globalStore.set(changeShellModalAtom, false);
                        globalRefocusWithTimeout(10);
                    }
                    setRowIndex(0);
                    return true;
                }
                if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                    globalStore.set(changeShellModalAtom, false);
                    setFilterText("");
                    globalRefocusWithTimeout(10);
                    return true;
                }
                if (keyutil.checkKeyPressed(waveEvent, "ArrowUp")) {
                    setRowIndex((idx) => Math.max(idx - 1, 0));
                    return true;
                }
                if (keyutil.checkKeyPressed(waveEvent, "ArrowDown")) {
                    setRowIndex((idx) => Math.min(idx + 1, selectionList.length - 1));
                    return true;
                }
                setRowIndex(0);
                return false;
            },
            [changeShellModalAtom, selectionList, rowIndex, changeShell]
        );

        // Keep row index in bounds when list changes
        React.useEffect(() => {
            setRowIndex((idx) => Math.min(idx, Math.max(0, selectionList.length - 1)));
        }, [selectionList.length]);

        if (!shellModalOpen) {
            return null;
        }

        return (
            <TypeAheadModal
                blockRef={blockRef}
                anchorRef={shellBtnRef}
                suggestions={suggestions}
                onSelect={(selected: string) => {
                    changeShell(selected);
                    globalStore.set(changeShellModalAtom, false);
                    globalRefocusWithTimeout(10);
                }}
                selectIndex={rowIndex}
                autoFocus={isNodeFocused}
                onKeyDown={(e) => keyutil.keydownWrapper(handleKeyDown)(e)}
                onChange={(current: string) => setFilterText(current)}
                value={filterText}
                label="Select Shell..."
                onClickBackdrop={() => globalStore.set(changeShellModalAtom, false)}
            />
        );
    }
);

export { ShellSelectorModal };
