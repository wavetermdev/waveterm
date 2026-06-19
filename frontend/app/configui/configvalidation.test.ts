// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    getEffectiveConfigValue,
    isConfigValueOverridden,
    normalizeConfigStringInput,
    validateConfigNumberInput,
    validateConfigStringInput,
} from "./configvalidation";

describe("configvalidation", () => {
    it("normalizes and validates config strings", () => {
        expect(normalizeConfigStringInput("  wave  ")).toBe("wave");
        expect(validateConfigStringInput("   ", { required: true })).toBe("Required");
        expect(validateConfigStringInput("missing-placeholder", { validate: (value) => (!value.includes("{query}") ? "Must include {query}" : undefined) })).toBe(
            "Must include {query}"
        );
        expect(validateConfigStringInput("https://example.com/?q={query}", { validate: (value) => (!value.includes("{query}") ? "Must include {query}" : undefined) })).toBeUndefined();
    });

    it("validates config numbers with integer and range constraints", () => {
        expect(validateConfigNumberInput("", { min: 1, max: 10 })).toEqual({ value: undefined });
        expect(validateConfigNumberInput("12", { min: 1, max: 10 })).toEqual({
            value: undefined,
            error: "Must be at most 10",
        });
        expect(validateConfigNumberInput("8.5", { integer: true })).toEqual({
            value: undefined,
            error: "Must be a whole number",
        });
        expect(validateConfigNumberInput("256", { min: 128, max: 10000, integer: true })).toEqual({
            value: 256,
        });
    });

    it("distinguishes overridden values from inherited defaults", () => {
        expect(isConfigValueOverridden(undefined)).toBe(false);
        expect(isConfigValueOverridden(false)).toBe(true);
        expect(isConfigValueOverridden(0.95)).toBe(true);
        expect(getEffectiveConfigValue(undefined, 0.95)).toBe(0.95);
        expect(getEffectiveConfigValue(0.95, 0.9)).toBe(0.95);
    });
});
