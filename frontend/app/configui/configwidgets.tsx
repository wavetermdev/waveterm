// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useState } from "react";
import {
    ConfigNumberValidationOptions,
    ConfigStringValidationOptions,
    isConfigValueOverridden,
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

type ConfigValueFormatter<T> = (value: T) => string;

type ConfigFieldFrameProps = {
    fieldId?: string;
    configKey: string;
    label: string;
    description?: string;
    hint?: string;
    message?: string;
    messageTone?: ConfigFieldTone;
    defaultText?: string;
    isOverridden?: boolean;
    showUseDefault?: boolean;
    onUseDefault?: () => void;
    children: ReactNode;
};

type ConfigBooleanFieldProps = Omit<ConfigFieldFrameProps, "children" | "fieldId" | "message" | "messageTone" | "defaultText" | "isOverridden" | "showUseDefault" | "onUseDefault"> & {
    value?: boolean;
    defaultValue?: boolean;
    onValueChange: (value: boolean | undefined) => void;
    trueLabel?: string;
    falseLabel?: string;
};

type ConfigSelectFieldProps = Omit<ConfigFieldFrameProps, "children" | "fieldId" | "message" | "messageTone" | "defaultText" | "isOverridden" | "showUseDefault" | "onUseDefault"> & {
    value?: string;
    defaultValue?: string;
    options: ConfigSelectOption[];
    placeholder?: string;
    valueFormatter?: ConfigValueFormatter<string>;
    onValueChange: (value: string | undefined) => void;
};

type ConfigStringFieldProps = Omit<ConfigFieldFrameProps, "children" | "fieldId" | "message" | "messageTone" | "defaultText" | "isOverridden" | "showUseDefault" | "onUseDefault"> & {
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    blankValue?: string;
    valueFormatter?: ConfigValueFormatter<string>;
    onValueChange: (value: string | undefined) => void;
    validation?: ConfigStringValidationOptions;
};

type ConfigNumberFieldProps = Omit<ConfigFieldFrameProps, "children" | "fieldId" | "message" | "messageTone" | "defaultText" | "isOverridden" | "showUseDefault" | "onUseDefault"> & {
    value?: number;
    defaultValue?: number;
    placeholder?: string;
    step?: number;
    valueFormatter?: ConfigValueFormatter<number>;
    onValueChange: (value: number | undefined) => void;
    validation?: ConfigNumberValidationOptions;
};

type ConfigFontSizeFieldProps = Omit<ConfigNumberFieldProps, "step"> & {
    sampleText?: string;
    presets?: number[];
};

function formatBooleanLabel(value: boolean, trueLabel = "True", falseLabel = "False"): string {
    return value ? trueLabel : falseLabel;
}

function formatDefaultText<T>(defaultValue: T | undefined, valueFormatter?: ConfigValueFormatter<T>): string | undefined {
    if (defaultValue == null) {
        return;
    }
    if (valueFormatter != null) {
        return valueFormatter(defaultValue);
    }
    return String(defaultValue);
}

function formatDefaultSelectLabel(defaultText?: string): string {
    if (defaultText == null) {
        return "Default";
    }
    return `Default (${defaultText})`;
}

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
    defaultText,
    isOverridden,
    showUseDefault,
    onUseDefault,
    children,
}: ConfigFieldFrameProps) {
    const messageClassName = messageTone === "error" ? "text-error" : "text-muted";

    return (
        <div className="grid gap-3 rounded-lg border border-border/80 bg-background/40 p-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
            <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
                        {label}
                    </label>
                    <span
                        className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            isOverridden
                                ? "border-accent/40 bg-accent/10 text-accent"
                                : "border-border bg-panel text-muted"
                        )}
                    >
                        {isOverridden ? "Overridden" : "Using default"}
                    </span>
                </div>
                <div className="font-mono text-[11px] text-accent">{configKey}</div>
                {description && <p className="text-xs leading-5 text-muted">{description}</p>}
            </div>
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">{children}</div>
                    {showUseDefault && (
                        <button
                            type="button"
                            onClick={onUseDefault}
                            className="rounded border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-hover cursor-pointer"
                        >
                            Use Default
                        </button>
                    )}
                </div>
                {defaultText != null && <div className="text-xs text-muted">Default: {defaultText}</div>}
                {(message || hint) && <div className={cn("text-xs", message ? messageClassName : "text-muted")}>{message ?? hint}</div>}
            </div>
        </div>
    );
}

export function ConfigBooleanField({
    value,
    defaultValue,
    onValueChange,
    hint,
    configKey,
    label,
    description,
    trueLabel = "True",
    falseLabel = "False",
}: ConfigBooleanFieldProps) {
    const fieldId = useId();
    const isOverridden = isConfigValueOverridden(value);
    const defaultText = formatDefaultText(defaultValue, (defaultBool) => formatBooleanLabel(defaultBool, trueLabel, falseLabel));

    return (
        <ConfigFieldFrame
            fieldId={fieldId}
            configKey={configKey}
            label={label}
            description={description}
            hint={hint ?? "Default is a first-class state; booleans can inherit, or be explicitly set true/false"}
            defaultText={defaultText}
            isOverridden={isOverridden}
        >
            <select
                id={fieldId}
                value={value == null ? "default" : value ? "true" : "false"}
                onChange={(event) => {
                    if (event.target.value === "default") {
                        onValueChange(undefined);
                        return;
                    }
                    onValueChange(event.target.value === "true");
                }}
                className="w-full rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground cursor-pointer"
            >
                <option value="default">{formatDefaultSelectLabel(defaultText)}</option>
                <option value="true">{trueLabel}</option>
                <option value="false">{falseLabel}</option>
            </select>
        </ConfigFieldFrame>
    );
}

export function ConfigSelectField({
    value,
    defaultValue,
    options,
    placeholder = "Select a value",
    valueFormatter,
    onValueChange,
    hint,
    configKey,
    label,
    description,
}: ConfigSelectFieldProps) {
    const fieldId = useId();
    const defaultText = formatDefaultText(defaultValue, valueFormatter);
    const isOverridden = isConfigValueOverridden(value);

    return (
        <ConfigFieldFrame
            fieldId={fieldId}
            configKey={configKey}
            label={label}
            description={description}
            hint={hint ?? "Choose an explicit override or fall back to the default value"}
            defaultText={defaultText}
            isOverridden={isOverridden}
        >
            <select
                id={fieldId}
                value={value ?? ""}
                onChange={(event) => onValueChange(event.target.value || undefined)}
                className="w-full rounded-md border border-border bg-panel px-3 py-2 text-sm text-foreground cursor-pointer"
            >
                <option value="">{defaultValue == null ? placeholder : formatDefaultSelectLabel(defaultText)}</option>
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
    defaultValue,
    placeholder,
    blankValue,
    valueFormatter,
    onValueChange,
    validation,
    hint,
    configKey,
    label,
    description,
}: ConfigStringFieldProps) {
    const fieldId = useId();
    const [draftValue, setDraftValue] = useState(value ?? "");
    const isOverridden = isConfigValueOverridden(value);
    const defaultText = formatDefaultText(defaultValue, valueFormatter);

    useEffect(() => {
        setDraftValue(value ?? "");
    }, [value]);

    const validationValue = useMemo(() => {
        if (isOverridden || defaultValue == null) {
            return draftValue;
        }
        return defaultValue;
    }, [defaultValue, draftValue, isOverridden]);
    const error = useMemo(() => validateConfigStringInput(validationValue, validation), [validationValue, validation]);

    const applyValue = (nextValue: string) => {
        setDraftValue(nextValue);
        const nextError = validateConfigStringInput(nextValue, validation);
        if (nextError != null) {
            return;
        }
        const normalizedValue = normalizeConfigStringInput(nextValue, validation);
        if (normalizedValue.length === 0) {
            if (blankValue != null) {
                onValueChange(blankValue);
                return;
            }
            onValueChange(undefined);
            return;
        }
        onValueChange(normalizedValue);
    };

    return (
        <ConfigFieldFrame
            fieldId={fieldId}
            configKey={configKey}
            label={label}
            description={description}
            hint={hint ?? "Blank means inherit the default unless this field explicitly allows an empty string override"}
            message={error}
            messageTone={error ? "error" : "muted"}
            defaultText={defaultText}
            isOverridden={isOverridden}
            showUseDefault={isOverridden}
            onUseDefault={() => onValueChange(undefined)}
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
                placeholder={placeholder ?? (defaultText == null ? undefined : `Default: ${defaultText}`)}
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
    defaultValue,
    placeholder,
    step = 1,
    valueFormatter,
    onValueChange,
    validation,
    hint,
    configKey,
    label,
    description,
}: ConfigNumberFieldProps) {
    const fieldId = useId();
    const [draftValue, setDraftValue] = useState(value == null ? "" : String(value));
    const isOverridden = isConfigValueOverridden(value);
    const defaultText = formatDefaultText(defaultValue, valueFormatter);

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
            fieldId={fieldId}
            configKey={configKey}
            label={label}
            description={description}
            hint={hint ?? "Numeric fields may still be overridden to the same value as the default; the override badge makes that visible"}
            message={result.error}
            messageTone={result.error ? "error" : "muted"}
            defaultText={defaultText}
            isOverridden={isOverridden}
            showUseDefault={isOverridden}
            onUseDefault={() => onValueChange(undefined)}
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
                placeholder={placeholder ?? (defaultText == null ? undefined : `Default: ${defaultText}`)}
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
    defaultValue,
    onValueChange,
    presets = [11, 12, 13, 14, 16, 18],
    sampleText = "Sphinx of black quartz, judge my vow.",
    valueFormatter,
    hint,
    configKey,
    label,
    description,
}: ConfigFontSizeFieldProps) {
    const fieldId = useId();
    const [draftValue, setDraftValue] = useState(value == null ? "" : String(value));
    const isOverridden = isConfigValueOverridden(value);
    const defaultText = formatDefaultText(defaultValue, valueFormatter ?? ((fontSize) => `${fontSize}px`));

    useEffect(() => {
        setDraftValue(value == null ? "" : String(value));
    }, [value]);

    const result = useMemo(() => validateConfigNumberInput(draftValue, { min: 8, max: 36 }), [draftValue]);
    const sampleFontSize = result.value ?? value ?? defaultValue ?? 13;

    const applyValue = (nextValue: string) => {
        setDraftValue(nextValue);
        const nextResult = validateConfigNumberInput(nextValue, { min: 8, max: 36 });
        if (nextResult.error != null) {
            return;
        }
        onValueChange(nextResult.value);
    };

    return (
        <ConfigFieldFrame
            fieldId={fieldId}
            configKey={configKey}
            label={label}
            description={description}
            hint={hint ?? "Preset buttons create explicit overrides; Use Default removes the key and inherits again"}
            message={result.error}
            messageTone={result.error ? "error" : "muted"}
            defaultText={defaultText}
            isOverridden={isOverridden}
            showUseDefault={isOverridden}
            onUseDefault={() => onValueChange(undefined)}
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
                    placeholder={defaultText == null ? undefined : `Default: ${defaultText}`}
                    className={cn(
                        "w-full rounded-md border bg-panel px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/60",
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
                                sampleFontSize === preset && isOverridden
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
