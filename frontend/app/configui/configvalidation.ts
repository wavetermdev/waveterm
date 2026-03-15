// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type ConfigStringValidationOptions = {
    required?: boolean;
    trim?: boolean;
    maxLength?: number;
    pattern?: RegExp;
    validate?: (value: string) => string | undefined;
};

export type ConfigNumberValidationOptions = {
    min?: number;
    max?: number;
    integer?: boolean;
};

export function isConfigValueOverridden<T>(value: T | undefined): boolean {
    return value != null;
}

export function getEffectiveConfigValue<T>(value: T | undefined, defaultValue: T): T {
    if (value != null) {
        return value;
    }
    return defaultValue;
}

export function normalizeConfigStringInput(value: string, options?: ConfigStringValidationOptions): string {
    if (options?.trim === false) {
        return value;
    }
    return value.trim();
}

export function validateConfigStringInput(value: string, options?: ConfigStringValidationOptions): string | undefined {
    const normalizedValue = normalizeConfigStringInput(value, options);

    if (options?.required && normalizedValue.length === 0) {
        return "Required";
    }
    if (normalizedValue.length === 0) {
        return;
    }
    if (options?.maxLength != null && normalizedValue.length > options.maxLength) {
        return `Must be ${options.maxLength} characters or less`;
    }
    if (options?.pattern != null && !options.pattern.test(normalizedValue)) {
        return "Invalid format";
    }
    return options?.validate?.(normalizedValue);
}

export function validateConfigNumberInput(
    value: string,
    options?: ConfigNumberValidationOptions
): { value: number | undefined; error?: string } {
    const trimmedValue = value.trim();
    if (trimmedValue.length === 0) {
        return { value: undefined };
    }

    const parsedValue = Number(trimmedValue);
    if (!Number.isFinite(parsedValue)) {
        return { value: undefined, error: "Must be a number" };
    }
    if (options?.integer && !Number.isInteger(parsedValue)) {
        return { value: undefined, error: "Must be a whole number" };
    }
    if (options?.min != null && parsedValue < options.min) {
        return { value: undefined, error: `Must be at least ${options.min}` };
    }
    if (options?.max != null && parsedValue > options.max) {
        return { value: undefined, error: `Must be at most ${options.max}` };
    }

    return { value: parsedValue };
}
