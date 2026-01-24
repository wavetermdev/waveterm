// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";

import { ColorControl } from "./color-control";
import { FontControl } from "./font-control";
import { NumberControl } from "./number-control";
import { PathControl } from "./path-control";
import { SelectControl } from "./select-control";
import { SettingControl } from "./setting-control";
import { SliderControl } from "./slider-control";
import { StringListControl } from "./stringlist-control";
import { TextControl } from "./text-control";
import { ToggleControl } from "./toggle-control";

interface ControlFactoryProps {
    metadata: SettingMetadata;
    value: boolean | number | string | string[] | null;
    onChange: (value: boolean | number | string | string[] | null) => void;
    disabled?: boolean;
    /** Callback for path browser (for path controls) */
    onBrowsePath?: () => void;
    /** Dynamic options for select controls (overrides metadata options) */
    dynamicOptions?: SelectOption[];
}

/**
 * Renders the appropriate control for a setting based on its metadata.
 */
const ControlFactory = memo(
    ({ metadata, value, onChange, disabled, onBrowsePath, dynamicOptions }: ControlFactoryProps) => {
        const isModified = value !== metadata.defaultValue && value !== undefined && value !== null;

        const renderControl = () => {
            switch (metadata.controlType) {
                case "toggle":
                    return (
                        <ToggleControl
                            value={value as boolean}
                            onChange={onChange as (v: boolean) => void}
                            disabled={disabled}
                        />
                    );

                case "number":
                    return (
                        <NumberControl
                            value={value as number}
                            onChange={onChange as (v: number) => void}
                            min={metadata.validation?.min}
                            max={metadata.validation?.max}
                            step={metadata.validation?.step}
                            disabled={disabled}
                        />
                    );

                case "slider":
                    return (
                        <SliderControl
                            value={value as number}
                            onChange={onChange as (v: number) => void}
                            min={metadata.validation?.min}
                            max={metadata.validation?.max}
                            step={metadata.validation?.step}
                            disabled={disabled}
                        />
                    );

                case "text":
                    return (
                        <TextControl
                            value={value as string}
                            onChange={onChange as (v: string) => void}
                            pattern={metadata.validation?.pattern}
                            disabled={disabled}
                        />
                    );

                case "select": {
                    const options = dynamicOptions ?? metadata.validation?.options ?? [];
                    return (
                        <SelectControl
                            value={value as string}
                            onChange={onChange as (v: string) => void}
                            options={options}
                            disabled={disabled}
                        />
                    );
                }

                case "color":
                    return (
                        <ColorControl
                            value={value as string}
                            onChange={onChange as (v: string) => void}
                            disabled={disabled}
                        />
                    );

                case "font":
                    return (
                        <FontControl
                            value={value as string}
                            onChange={onChange as (v: string) => void}
                            disabled={disabled}
                        />
                    );

                case "path":
                    return (
                        <PathControl
                            value={value as string}
                            onChange={onChange as (v: string) => void}
                            disabled={disabled}
                            onBrowse={onBrowsePath}
                        />
                    );

                case "stringlist":
                    return (
                        <StringListControl
                            value={value as string[]}
                            onChange={onChange as (v: string[]) => void}
                            disabled={disabled}
                        />
                    );

                default:
                    // Fallback to text control for unknown types
                    return (
                        <TextControl
                            value={String(value ?? "")}
                            onChange={onChange as (v: string) => void}
                            disabled={disabled}
                        />
                    );
            }
        };

        return (
            <SettingControl
                settingKey={metadata.key}
                label={metadata.label}
                description={metadata.description}
                value={value}
                defaultValue={metadata.defaultValue}
                onChange={onChange}
                isModified={isModified}
                disabled={disabled}
                requiresRestart={metadata.requiresRestart}
            >
                {renderControl()}
            </SettingControl>
        );
    }
);

ControlFactory.displayName = "ControlFactory";

/**
 * Standalone function to render a setting control based on metadata.
 * Useful when you don't need the wrapper component.
 */
function renderSettingControl(
    controlType: SettingControlType,
    value: boolean | number | string | string[] | null,
    onChange: (value: boolean | number | string | string[] | null) => void,
    options?: {
        disabled?: boolean;
        min?: number;
        max?: number;
        step?: number;
        pattern?: string;
        selectOptions?: SelectOption[];
        onBrowsePath?: () => void;
    }
): JSX.Element {
    const { disabled, min, max, step, pattern, selectOptions, onBrowsePath } = options ?? {};

    switch (controlType) {
        case "toggle":
            return (
                <ToggleControl
                    value={value as boolean}
                    onChange={onChange as (v: boolean) => void}
                    disabled={disabled}
                />
            );

        case "number":
            return (
                <NumberControl
                    value={value as number}
                    onChange={onChange as (v: number) => void}
                    min={min}
                    max={max}
                    step={step}
                    disabled={disabled}
                />
            );

        case "slider":
            return (
                <SliderControl
                    value={value as number}
                    onChange={onChange as (v: number) => void}
                    min={min}
                    max={max}
                    step={step}
                    disabled={disabled}
                />
            );

        case "text":
            return (
                <TextControl
                    value={value as string}
                    onChange={onChange as (v: string) => void}
                    pattern={pattern}
                    disabled={disabled}
                />
            );

        case "select":
            return (
                <SelectControl
                    value={value as string}
                    onChange={onChange as (v: string) => void}
                    options={selectOptions ?? []}
                    disabled={disabled}
                />
            );

        case "color":
            return (
                <ColorControl
                    value={value as string}
                    onChange={onChange as (v: string) => void}
                    disabled={disabled}
                />
            );

        case "font":
            return (
                <FontControl
                    value={value as string}
                    onChange={onChange as (v: string) => void}
                    disabled={disabled}
                />
            );

        case "path":
            return (
                <PathControl
                    value={value as string}
                    onChange={onChange as (v: string) => void}
                    disabled={disabled}
                    onBrowse={onBrowsePath}
                />
            );

        case "stringlist":
            return (
                <StringListControl
                    value={value as string[]}
                    onChange={onChange as (v: string[]) => void}
                    disabled={disabled}
                />
            );

        default:
            return (
                <TextControl
                    value={String(value ?? "")}
                    onChange={onChange as (v: string) => void}
                    disabled={disabled}
                />
            );
    }
}

export { ControlFactory, renderSettingControl };
export type { ControlFactoryProps };
