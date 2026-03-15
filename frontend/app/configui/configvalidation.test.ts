// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
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
});
