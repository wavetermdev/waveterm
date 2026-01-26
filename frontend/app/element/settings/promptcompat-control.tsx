// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Prompt Compatibility Control
 *
 * Provides documentation and configuration help for custom shell prompts.
 * This is a special "informational" control that doesn't actually manage a setting value.
 */

import { PromptCompatibilityHelp } from "@/app/view/waveconfig/prompt-compatibility-help";
import { memo } from "react";

export interface PromptCompatControlProps {
    value: string | null;
    onChange: (value: string | null) => void;
    disabled?: boolean;
}

/**
 * Control component that renders the prompt compatibility help interface.
 * Note: This control doesn't actually use the value/onChange props as it's purely informational.
 */
export const PromptCompatControl = memo(({ value, onChange, disabled }: PromptCompatControlProps) => {
    // This control is purely informational and doesn't manage state
    return <PromptCompatibilityHelp />;
});

PromptCompatControl.displayName = "PromptCompatControl";
