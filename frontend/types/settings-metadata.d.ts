// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Metadata Types
 *
 * This file defines the type system for the settings GUI registry.
 * It enables dynamic GUI generation based on setting metadata.
 */

declare global {
    /**
     * Control types that determine how a setting is rendered in the GUI.
     */
    type SettingControlType =
        | "toggle" // Boolean on/off switch
        | "number" // Numeric input field
        | "slider" // Range slider with min/max
        | "text" // Single-line text input
        | "select" // Dropdown selection
        | "color" // Color picker
        | "font" // Font family picker
        | "path" // File/directory path input
        | "stringlist" // List of strings
        | "termtheme" // Terminal color scheme picker
        | "omptheme" // Oh-My-Posh theme selector
        | "omppalette" // Oh-My-Posh palette export
        | "promptcompat"; // Prompt compatibility help and configuration

    /**
     * The underlying JavaScript/TypeScript type for a setting value.
     */
    type SettingValueType = "boolean" | "number" | "string" | "string[]" | "object" | "null";

    /**
     * Option for select controls.
     */
    interface SelectOption {
        value: string;
        label: string;
    }

    /**
     * Validation rules applied to setting values.
     */
    interface ValidationRules {
        /** Minimum value for numbers/sliders */
        min?: number;
        /** Maximum value for numbers/sliders */
        max?: number;
        /** Step increment for sliders */
        step?: number;
        /** Regex pattern for text validation */
        pattern?: string;
        /** Available options for select controls */
        options?: SelectOption[];
    }

    /**
     * Complete metadata for a single setting.
     */
    interface SettingMetadata {
        /** The setting key (e.g., "term:fontsize") */
        key: string;
        /** Human-readable label for display */
        label: string;
        /** Detailed description of what the setting does */
        description: string;
        /** Primary category for grouping (e.g., "Terminal", "Window") */
        category: string;
        /** Optional subcategory for nested grouping */
        subcategory?: string;
        /** The GUI control type to render */
        controlType: SettingControlType;
        /** Default value when not set by user */
        defaultValue: boolean | number | string | string[] | object | null;
        /** The JavaScript type of the value */
        type: SettingValueType;
        /** Optional validation rules */
        validation?: ValidationRules;
        /** If true, app restart is required for changes to take effect */
        requiresRestart?: boolean;
        /** Platform-specific setting (only shown on this platform) */
        platform?: "darwin" | "win32" | "linux" | "all";
        /** If true, this setting is deprecated and may be removed */
        deprecated?: boolean;
        /** Search tags for finding this setting */
        tags?: string[];
        /** If true, this is a sensitive setting (e.g., API tokens) */
        sensitive?: boolean;
        /**
         * Links to related settings within the description text.
         * Maps display text (case-insensitive) to setting keys.
         * Example: { "window transparency": "window:transparent" }
         */
        links?: Record<string, string>;
        /** If true, control spans full width below the label/description */
        fullWidth?: boolean;
        /** If true, this setting is hidden from the generic settings panel
         *  (it will be rendered by a custom panel instead) */
        hideFromSettings?: boolean;
    }

    /**
     * Configuration for how a category is displayed.
     */
    interface CategoryConfig {
        /** Display order (lower = higher in list) */
        order: number;
        /** Icon identifier for the category */
        icon: string;
        /** Optional description of the category */
        description?: string;
    }
}

export {};
