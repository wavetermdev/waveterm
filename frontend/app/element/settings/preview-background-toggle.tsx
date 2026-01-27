// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Preview Background Toggle Component
 *
 * Allows users to preview theme cards on different background colors:
 * - Dark: Preview all themes on dark background (#1a1a1a)
 * - Light: Preview all themes on light background (#fafafa)
 * - Split: Show each theme card split 50/50 (left dark, right light)
 */

import { memo } from "react";
import { SegmentedToggle } from "./segmented-toggle";
import type { SegmentedToggleOption } from "./segmented-toggle";

import "./preview-background-toggle.scss";

export type PreviewBackground = "dark" | "light" | "split";

export interface PreviewBackgroundToggleProps {
    value: PreviewBackground;
    onChange: (value: PreviewBackground) => void;
    disabled?: boolean;
}

const PREVIEW_OPTIONS: SegmentedToggleOption[] = [
    { value: "dark", label: "Dark", icon: "moon", ariaLabel: "Preview on dark background" },
    { value: "light", label: "Light", icon: "sun", ariaLabel: "Preview on light background" },
    { value: "split", label: "Split", icon: "circle-half-stroke", ariaLabel: "Preview on split dark/light background" },
];

export const PreviewBackgroundToggle = memo(({ value, onChange, disabled }: PreviewBackgroundToggleProps) => (
    <SegmentedToggle
        options={PREVIEW_OPTIONS}
        value={value}
        onChange={onChange as (value: string) => void}
        label="Preview Background:"
        disabled={disabled}
        ariaLabel="Preview background mode"
    />
));

PreviewBackgroundToggle.displayName = "PreviewBackgroundToggle";
