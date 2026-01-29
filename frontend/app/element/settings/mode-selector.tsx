// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";
import { SegmentedToggle } from "./segmented-toggle";
import type { SegmentedToggleOption } from "./segmented-toggle";

interface ModeSelectorProps {
    value: string;
    onChange: (value: string) => void;
}

const MODE_OPTIONS: SegmentedToggleOption[] = [
    { value: "dark", label: "Dark", icon: "moon" },
    { value: "light", label: "Light", icon: "sun" },
    { value: "system", label: "System", icon: "desktop" },
];

const ModeSelector = memo(({ value, onChange }: ModeSelectorProps) => (
    <SegmentedToggle options={MODE_OPTIONS} value={value} onChange={onChange} ariaLabel="Theme mode" />
));

ModeSelector.displayName = "ModeSelector";

export { ModeSelector };
export type { ModeSelectorProps };
