// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ObjectService } from "@/app/store/services";
import { validatePresetBeforeApply, sanitizePreset } from "@/util/presetutil";
import { fireAndForget } from "@/util/util";

/**
 * Configuration for building preset menu items.
 */
export interface PresetMenuConfig {
    /** Prefix to filter presets (e.g., "tabvar@", "bg@") */
    prefix: string;

    /** Whether to sort by display:order (default: false) */
    sortByOrder?: boolean;

    /** Whether to strip prefix from fallback label (default: false) */
    stripPrefixFromLabel?: boolean;

    /** Additional callback to execute after applying preset */
    onApply?: (presetName: string) => void;
}

/**
 * Filter preset keys by prefix from the full configuration.
 *
 * @param presets - The presets map from fullConfig
 * @param prefix - Prefix to filter by
 * @returns Array of matching preset keys
 */
function filterPresetsByPrefix(presets: { [key: string]: MetaType } | undefined, prefix: string): string[] {
    if (!presets) {
        return [];
    }
    const matching: string[] = [];
    for (const key in presets) {
        if (key.startsWith(prefix)) {
            matching.push(key);
        }
    }
    return matching;
}

/**
 * Build context menu items from presets matching the specified prefix.
 *
 * @param fullConfig - The full configuration containing presets
 * @param oref - Object reference to apply presets to
 * @param config - Configuration for filtering and building menu items
 * @returns Array of context menu items (empty if no matching presets)
 *
 * @example
 * // Tab variables presets
 * const tabVarItems = buildPresetMenuItems(fullConfig, oref, {
 *     prefix: "tabvar@",
 *     stripPrefixFromLabel: true,
 * });
 *
 * @example
 * // Background presets with sorting and callback
 * const bgItems = buildPresetMenuItems(fullConfig, oref, {
 *     prefix: "bg@",
 *     sortByOrder: true,
 *     onApply: () => {
 *         RpcApi.ActivityCommand(TabRpcClient, { settabtheme: 1 }, { noresponse: true });
 *         recordTEvent("action:settabtheme");
 *     },
 * });
 */
export function buildPresetMenuItems(
    fullConfig: FullConfigType | null,
    oref: string,
    config: PresetMenuConfig
): ContextMenuItem[] {
    if (!fullConfig?.presets) {
        return [];
    }

    const { prefix, sortByOrder = false, stripPrefixFromLabel = false, onApply } = config;

    // Filter presets by prefix
    let presetKeys = filterPresetsByPrefix(fullConfig.presets, prefix);

    if (presetKeys.length === 0) {
        return [];
    }

    // Sort by display:order if requested
    if (sortByOrder) {
        presetKeys.sort((a, b) => {
            const aOrder = fullConfig.presets[a]?.["display:order"] ?? 0;
            const bOrder = fullConfig.presets[b]?.["display:order"] ?? 0;
            return aOrder - bOrder;
        });
    }

    // Build menu items
    const menuItems: ContextMenuItem[] = [];

    for (const presetName of presetKeys) {
        const preset = fullConfig.presets[presetName];
        if (preset == null) {
            continue;
        }

        // Frontend validation (defense in depth)
        const validation = validatePresetBeforeApply(presetName, preset);
        if (!validation.valid) {
            console.warn(`[Preset] Skipping invalid preset "${presetName}": ${validation.error}`);
            continue;
        }
        if (validation.warnings?.length) {
            console.info(`[Preset] Warnings for "${presetName}":`, validation.warnings);
        }

        // Determine display label
        let label: string;
        if (preset["display:name"]) {
            label = preset["display:name"] as string;
        } else if (stripPrefixFromLabel) {
            label = presetName.replace(prefix, "");
        } else {
            label = presetName;
        }

        menuItems.push({
            label,
            click: () =>
                fireAndForget(async () => {
                    // Sanitize preset to ensure only allowed keys are sent
                    const sanitizedPreset = sanitizePreset(presetName, preset);
                    await ObjectService.UpdateObjectMeta(oref, sanitizedPreset);
                    onApply?.(presetName);
                }),
        });
    }

    return menuItems;
}

/**
 * Add preset submenu to an existing menu array if presets exist.
 * This is a convenience wrapper around buildPresetMenuItems that handles
 * the common pattern of adding a labeled submenu with separator.
 *
 * @param menu - Menu array to add to (modified in place)
 * @param fullConfig - The full configuration containing presets
 * @param oref - Object reference to apply presets to
 * @param label - Label for the submenu
 * @param config - Configuration for filtering and building menu items
 * @returns The modified menu array (for chaining)
 */
export function addPresetSubmenu(
    menu: ContextMenuItem[],
    fullConfig: FullConfigType | null,
    oref: string,
    label: string,
    config: PresetMenuConfig
): ContextMenuItem[] {
    const submenuItems = buildPresetMenuItems(fullConfig, oref, config);

    if (submenuItems.length > 0) {
        menu.push({ label, type: "submenu", submenu: submenuItems }, { type: "separator" });
    }

    return menu;
}
