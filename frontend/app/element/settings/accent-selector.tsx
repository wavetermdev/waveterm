// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import "./accent-selector.scss";

export type AccentSelectorProps = {
    value: string;
    onChange: (value: string) => void;
};

interface AccentOption {
    value: string;
    label: string;
    darkColor: string;
    lightColor: string;
}

const ACCENT_OPTIONS: AccentOption[] = [
    { value: "green", label: "Green", darkColor: "rgb(88, 193, 66)", lightColor: "rgb(46, 160, 67)" },
    { value: "warm", label: "Warm", darkColor: "rgb(200, 145, 60)", lightColor: "rgb(140, 100, 40)" },
    { value: "blue", label: "Blue", darkColor: "rgb(70, 140, 220)", lightColor: "rgb(30, 100, 180)" },
    { value: "purple", label: "Purple", darkColor: "rgb(160, 100, 220)", lightColor: "rgb(120, 70, 180)" },
    { value: "teal", label: "Teal", darkColor: "rgb(50, 190, 180)", lightColor: "rgb(20, 150, 140)" },
];

function getSwatchColor(option: AccentOption): string {
    const theme = document.documentElement.getAttribute("data-theme");
    return theme === "light" ? option.lightColor : option.darkColor;
}

const AccentSelector = memo(({ value, onChange }: AccentSelectorProps) => {
    const handleSelect = useCallback(
        (accent: string) => {
            onChange(accent);
        },
        [onChange]
    );

    // Re-render swatches when data-theme changes so colors match the current mode
    const [, setThemeTick] = useState(0);
    const observerRef = useRef<MutationObserver | null>(null);
    useEffect(() => {
        observerRef.current = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.attributeName === "data-theme") {
                    setThemeTick((t) => t + 1);
                    break;
                }
            }
        });
        observerRef.current.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        return () => observerRef.current?.disconnect();
    }, []);

    return (
        <div className="accent-selector" role="radiogroup" aria-label="Accent color">
            {ACCENT_OPTIONS.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    className={cn("accent-card", { selected: value === option.value })}
                    onClick={() => handleSelect(option.value)}
                    role="radio"
                    aria-checked={value === option.value}
                    aria-label={`${option.label} accent color`}
                >
                    <div className="accent-swatch" style={{ backgroundColor: getSwatchColor(option) }} />
                    <span className="accent-label">{option.label}</span>
                    {value === option.value && (
                        <span className="accent-check">
                            <i className="fa fa-solid fa-check" />
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
});

AccentSelector.displayName = "AccentSelector";

export { AccentSelector };
