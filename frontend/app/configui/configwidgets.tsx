// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useState } from "react";
import {
    ConfigNumberValidationOptions,
    ConfigStringValidationOptions,
    normalizeConfigStringInput,
    validateConfigNumberInput,
    validateConfigStringInput,
} from "./configvalidation";

export type ConfigSelectOption = {
    value: string;
    label: string;
    description?: string;
};

type ConfigFieldTone = "muted" | "error";

type ConfigFieldFrameProps = {
    fieldId?: string;
    configKey: string;
    label: string;
    description?: string;
    hint?: string;
    message?: string;
    messageTone?: ConfigFieldTone;
    clearable?: boolean;
    onClear?: () => void;
    children: ReactNode;
};

type ConfigBooleanFieldProps = Omit<ConfigFieldFrameProps, "children" | "fieldId" | "message" | "messageTone"> & {
    value?: boolean;
    onValueChange: (value: boolean) => void;
};

type ConfigSelectFieldProps = Omit<ConfigFieldFrameProps, "children" | "fieldId" | "message" | "messageTone"> & {
    value?: string;
    options: ConfigSelectOption[];
    placeholder?: string;
    onValueChange: (value: string | undefined) => void;
};

type ConfigStringFieldProps = Omit<ConfigFieldFrameProps, "children" | "fieldId" | "message" | "messageTone"> & {
    value?: string;
    placeholder?: string;
    blankValue?: string;
    onValueChange: (value: string | undefined) => void;
    validation?: ConfigStringValidationOptions;
};

type ConfigNumberFieldProps = Omit<ConfigFieldFrameProps, "children" | "fieldId" | "message" | "messageTone"> & {
    value?: number;
    placeholder?: string;
    step?: number;
    onValueChange: (value: number | undefined) => void;
    validation?: ConfigNumberValidationOptions;
};

type ConfigFontSizeFieldProps = Omit<ConfigNumberFieldProps, "step"> & {
    sampleText?: string;
    presets?: number[];
};

export function ConfigSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
    return (
        <section className="rounded-xl border border-border bg-panel/70 p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                {description && <p className="text-sm text-muted">{description}</p>}
            </div>
            <div className="grid gap-4">{children}</div>
        </section>
    );
}

function ConfigFieldFrame({
    fieldId,
    configKey,
    label,
    description,
    hint,
    message,
    messageTone = "muted",
    clearable,
    onClear,
    children,
}: ConfigFieldFrameProps) {
    const messageClassName = messageTone === "error" ? "text-error" : "text-muted";

    return (
        <div className="grid gap-3 rounded-lg border border-border/80 bg-background/40 p-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
            <div className="flex flex-col gap-1">
                <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
                    {label}
                </label>
                <div className="font-mono text-[11px] text-accent">{configKey}</div>
                {description && <p className="text-xs leading-5 text-muted">{description}</p>}
            </div>
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">{children}</div>
                    {clearable && (
                        <button
                            type="button"
                            onClick={onClear}
                            className="rounded border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover cursor-pointer"
                        >
                            Clear
                        </button>
                    )}
                </div>
                {(message || hint) && <div className={cn("text-xs", message ? messageClassName : "text-muted")}>{message ?? hint}</div>}
            </div>
        </div>
    );
}

export function ConfigBooleanField({
    value,
    onValueChange,
    hint,
    clearable,
    onClear,
    ...frameProps
}: ConfigBooleanFieldProps) {
    const fieldId = useId();

    return (
        <ConfigFieldFrame
            {...frameProps}
            fieldId={fieldId}
            hint={hint ?? "Writes a JSON boolean value"}
            clearable={clearable}
            onClear={onClear}
        >
            <label
                htmlFor={fieldId}
                className="inline-flex cursor-pointer items-center gap-3 rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground transition-colors hover:bg-hover"
            >
                <input
                    id={fieldId}
                    type="checkbox"
                    checked={!!value}
                    onChange={(event) => onValueChange(event.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-accent"
                />
                <span>{value ? "Enabled" : "Disabled"}</span>
            </label>
        </ConfigFieldFrame>
    );
}

export function ConfigSelectField({
    value,
    options,
    placeholder = "Select a value",
    onValueChange,
    hint,
    clearable,
    onClear,
    ...frameProps
}: ConfigSelectFieldProps) {
    const fieldId = useId();

    return (
        <ConfigFieldFrame
            {...frameProps}
            fieldId={fieldId}
            hint={hint ?? "Writes one of the allowed string values"}
            clearable={clearable}
            onClear={onClear}
        >
            <select
                id={fieldId}
                value={value ?? ""}
                onChange={(event) => onValueChange(event.target.value || undefined)}
                className="w-full rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground cursor-pointer"
            >
                <option value="">{placeholder}</option>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </ConfigFieldFrame>
    );
}

export function ConfigStringField({
    value,
    placeholder,
    blankValue,
    onValueChange,
    validation,
    hint,
    clearable,
    onClear,
    ...frameProps
}: ConfigStringFieldProps) {
    const fieldId = useId();
    const [draftValue, setDraftValue] = useState(value ?? "");

    useEffect(() => {
        setDraftValue(value ?? "");
    }, [value]);

    const error = useMemo(() => validateConfigStringInput(draftValue, validation), [draftValue, validation]);

    const applyValue = (nextValue: string) => {
        setDraftValue(nextValue);
        const nextError = validateConfigStringInput(nextValue, validation);
        if (nextError != null) {
            return;
        }
        const normalizedValue = normalizeConfigStringInput(nextValue, validation);
        if (normalizedValue.length === 0) {
            onValueChange(blankValue);
            return;
        }
        onValueChange(normalizedValue);
    };

    return (
        <ConfigFieldFrame
            {...frameProps}
            fieldId={fieldId}
            hint={hint ?? "Writes a validated string value"}
            message={error}
            messageTone={error ? "error" : "muted"}
            clearable={clearable}
            onClear={onClear}
        >
            <input
                id={fieldId}
                type="text"
                value={draftValue}
                onChange={(event) => applyValue(event.target.value)}
                onBlur={() => {
                    if (error == null) {
                        setDraftValue(normalizeConfigStringInput(draftValue, validation));
                    }
                }}
                placeholder={placeholder}
                className={cn(
                    "w-full rounded-md border bg-panel px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/60",
                    error ? "border-error" : "border-border"
                )}
            />
        </ConfigFieldFrame>
    );
}

export function ConfigNumberField({
    value,
    placeholder,
    step = 1,
    onValueChange,
    validation,
    hint,
    clearable,
    onClear,
    ...frameProps
}: ConfigNumberFieldProps) {
    const fieldId = useId();
    const [draftValue, setDraftValue] = useState(value == null ? "" : String(value));

    useEffect(() => {
        setDraftValue(value == null ? "" : String(value));
    }, [value]);

    const result = useMemo(() => validateConfigNumberInput(draftValue, validation), [draftValue, validation]);

    const applyValue = (nextValue: string) => {
        setDraftValue(nextValue);
        const nextResult = validateConfigNumberInput(nextValue, validation);
        if (nextResult.error != null) {
            return;
        }
        onValueChange(nextResult.value);
    };

    return (
        <ConfigFieldFrame
            {...frameProps}
            fieldId={fieldId}
            hint={hint ?? "Writes a numeric value after validation"}
            message={result.error}
            messageTone={result.error ? "error" : "muted"}
            clearable={clearable}
            onClear={onClear}
        >
            <input
                id={fieldId}
                type="number"
                value={draftValue}
                onChange={(event) => applyValue(event.target.value)}
                onBlur={() => {
                    if (result.error == null) {
                        setDraftValue(result.value == null ? "" : String(result.value));
                    }
                }}
                min={validation?.min}
                max={validation?.max}
                step={step}
                placeholder={placeholder}
                className={cn(
                    "w-full rounded-md border bg-panel px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/60",
                    result.error ? "border-error" : "border-border"
                )}
            />
        </ConfigFieldFrame>
    );
}

export function ConfigFontSizeField({
    value,
    onValueChange,
    presets = [11, 12, 13, 14, 16, 18],
    sampleText = "Sphinx of black quartz, judge my vow.",
    hint,
    clearable,
    onClear,
    ...frameProps
}: ConfigFontSizeFieldProps) {
    const fieldId = useId();
    const [draftValue, setDraftValue] = useState(value == null ? "" : String(value));

    useEffect(() => {
        setDraftValue(value == null ? "" : String(value));
    }, [value]);

    const result = useMemo(() => validateConfigNumberInput(draftValue, { min: 8, max: 36 }), [draftValue]);

    const applyValue = (nextValue: string) => {
        setDraftValue(nextValue);
        const nextResult = validateConfigNumberInput(nextValue, { min: 8, max: 36 });
        if (nextResult.error != null) {
            return;
        }
        onValueChange(nextResult.value);
    };

    const sampleFontSize = result.value ?? value ?? 13;

    return (
        <ConfigFieldFrame
            {...frameProps}
            fieldId={fieldId}
            hint={hint ?? "Useful for float-based font size settings"}
            message={result.error}
            messageTone={result.error ? "error" : "muted"}
            clearable={clearable}
            onClear={onClear}
        >
            <div className="flex flex-col gap-3">
                <input
                    id={fieldId}
                    type="number"
                    value={draftValue}
                    onChange={(event) => applyValue(event.target.value)}
                    onBlur={() => {
                        if (result.error == null) {
                            setDraftValue(result.value == null ? "" : String(result.value));
                        }
                    }}
                    min={8}
                    max={36}
                    step={0.5}
                    className={cn(
                        "w-full rounded-md border bg-panel px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/60",
                        result.error ? "border-error" : "border-border"
                    )}
                />
                <div className="flex flex-wrap gap-2">
                    {presets.map((preset) => (
                        <button
                            key={preset}
                            type="button"
                            onClick={() => applyValue(String(preset))}
                            className={cn(
                                "rounded border px-2.5 py-1 text-xs transition-colors cursor-pointer",
                                sampleFontSize === preset
                                    ? "border-accent bg-accent/15 text-accent"
                                    : "border-border text-muted hover:bg-hover"
                            )}
                        >
                            {preset}px
                        </button>
                    ))}
                </div>
                <div className="rounded-md border border-border bg-panel px-3 py-2 text-foreground" style={{ fontSize: sampleFontSize }}>
                    {sampleText}
                </div>
            </div>
        </ConfigFieldFrame>
    );
}
