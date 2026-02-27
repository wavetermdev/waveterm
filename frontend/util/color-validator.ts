// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const HexColorRegex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const FunctionalColorRegex = /^([a-z-]+)\(/i;
const NamedColorRegex = /^[a-z]+$/i;

function isValidCssColor(color: string): boolean {
    if (typeof CSS == "undefined" || typeof CSS.supports != "function") {
        return false;
    }
    return CSS.supports("color", color);
}

function getCssColorType(color: string): string {
    const normalizedColor = color.toLowerCase();
    if (HexColorRegex.test(normalizedColor)) {
        if (normalizedColor.length === 4) {
            return "hex3";
        }
        if (normalizedColor.length === 5) {
            return "hex4";
        }
        if (normalizedColor.length === 9) {
            return "hex8";
        }
        return "hex";
    }
    if (normalizedColor === "transparent") {
        return "transparent";
    }
    if (normalizedColor === "currentcolor") {
        return "currentcolor";
    }
    const functionMatch = normalizedColor.match(FunctionalColorRegex);
    if (functionMatch) {
        return functionMatch[1];
    }
    if (NamedColorRegex.test(normalizedColor)) {
        return "keyword";
    }
    return "color";
}

export function validateCssColor(color: string): string {
    if (typeof color != "string") {
        throw new Error(`Invalid CSS color: ${String(color)}`);
    }
    const normalizedColor = color.trim();
    if (normalizedColor === "" || !isValidCssColor(normalizedColor)) {
        throw new Error(`Invalid CSS color: ${color}`);
    }
    return getCssColorType(normalizedColor);
}
