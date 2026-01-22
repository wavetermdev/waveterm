// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Preset validation utilities for frontend defense-in-depth.
 * These provide early feedback before backend validation.
 */

export interface PresetValidationResult {
    valid: boolean;
    error?: string;
    warnings?: string[];
}

/**
 * Key allowlists by preset type prefix.
 * Defines which metadata keys each preset type is allowed to set.
 */
export const PRESET_KEY_ALLOWLISTS: Record<string, Set<string>> = {
    "tabvar@": new Set([
        "tab:basedir",
        "tab:basedirlock",
        "display:name",
        "display:order"
    ]),
    "bg@": new Set([
        "bg:*",
        "bg",
        "bg:opacity",
        "bg:blendmode",
        "bg:bordercolor",
        "bg:activebordercolor",
        "bg:text",
        "display:name",
        "display:order"
    ]),
};

/**
 * Validates a preset before application.
 * Returns validation result with error details if invalid.
 */
export function validatePresetBeforeApply(
    presetName: string,
    presetData: Record<string, any>
): PresetValidationResult {
    const warnings: string[] = [];

    // Determine preset type from name prefix
    let presetType: string | null = null;
    for (const prefix of Object.keys(PRESET_KEY_ALLOWLISTS)) {
        if (presetName.startsWith(prefix)) {
            presetType = prefix;
            break;
        }
    }

    // If preset type not recognized, allow but warn
    if (!presetType) {
        warnings.push(`Unknown preset type: ${presetName}`);
        return { valid: true, warnings };
    }

    const allowedKeys = PRESET_KEY_ALLOWLISTS[presetType];
    const disallowedKeys: string[] = [];

    // Check each key in the preset
    for (const key of Object.keys(presetData)) {
        // Skip display keys (always allowed)
        if (key.startsWith("display:")) {
            continue;
        }

        if (!allowedKeys.has(key)) {
            disallowedKeys.push(key);
        }
    }

    if (disallowedKeys.length > 0) {
        return {
            valid: false,
            error: `Preset "${presetName}" contains keys not allowed for its type: ${disallowedKeys.join(", ")}`
        };
    }

    return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Sanitizes a preset by removing disallowed keys.
 * Returns a new preset object with only allowed keys.
 */
export function sanitizePreset(
    presetName: string,
    presetData: Record<string, any>
): Record<string, any> {
    // Determine preset type from name prefix
    let presetType: string | null = null;
    for (const prefix of Object.keys(PRESET_KEY_ALLOWLISTS)) {
        if (presetName.startsWith(prefix)) {
            presetType = prefix;
            break;
        }
    }

    // If preset type not recognized, return as-is (backend will validate)
    if (!presetType) {
        return presetData;
    }

    const allowedKeys = PRESET_KEY_ALLOWLISTS[presetType];
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(presetData)) {
        // Always allow display keys
        if (key.startsWith("display:")) {
            sanitized[key] = value;
            continue;
        }

        if (allowedKeys.has(key)) {
            sanitized[key] = value;
        }
    }

    return sanitized;
}
