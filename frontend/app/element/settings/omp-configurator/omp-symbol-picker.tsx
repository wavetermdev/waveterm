// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * OMP Symbol & Nerd Font Pickers
 *
 * Symbol strip for powerline/diamond character selection.
 * Nerd Font picker for inserting icons into templates.
 */

import { cn } from "@/util/util";
import { memo, useCallback, useState } from "react";

interface SymbolOption {
    char: string;
    label: string;
}

// Right-pointing powerline symbols (for trailing_diamond, powerline_symbol)
// Covers Powerline (E0B0-E0B7) and Powerline Extra (E0B8-E0D4) ranges
const RIGHT_SYMBOLS: SymbolOption[] = [
    // Basic powerline
    { char: "\ue0b0", label: "Arrow" },
    { char: "\ue0b1", label: "Arrow thin" },
    // Semicircle / round
    { char: "\ue0b4", label: "Semicircle" },
    { char: "\ue0b5", label: "Semicircle thin" },
    // Triangles / diagonals
    { char: "\ue0b8", label: "Lower-left triangle" },
    { char: "\ue0b9", label: "Backslash thin" },
    { char: "\ue0bc", label: "Upper-left triangle" },
    { char: "\ue0bd", label: "Slash thin" },
    // Decorative
    { char: "\ue0c0", label: "Flame" },
    { char: "\ue0c1", label: "Flame thin" },
    { char: "\ue0c4", label: "Pixels bottom" },
    { char: "\ue0c5", label: "Pixels thin" },
    { char: "\ue0c8", label: "Ice" },
    { char: "\ue0cc", label: "Honeycomb" },
    // Trapezoid / rounded
    { char: "\ue0d1", label: "Trapezoid" },
    { char: "\ue0d2", label: "Rounded" },
];

// Left-pointing powerline symbols (for leading_diamond)
const LEFT_SYMBOLS: SymbolOption[] = [
    // Basic powerline
    { char: "\ue0b2", label: "Arrow" },
    { char: "\ue0b3", label: "Arrow thin" },
    // Semicircle / round
    { char: "\ue0b6", label: "Semicircle" },
    { char: "\ue0b7", label: "Semicircle thin" },
    // Triangles / diagonals
    { char: "\ue0ba", label: "Lower-right triangle" },
    { char: "\ue0bb", label: "Slash thin" },
    { char: "\ue0be", label: "Upper-right triangle" },
    { char: "\ue0bf", label: "Backslash thin" },
    // Decorative
    { char: "\ue0c2", label: "Flame" },
    { char: "\ue0c3", label: "Flame thin" },
    { char: "\ue0c6", label: "Pixels bottom" },
    { char: "\ue0c7", label: "Pixels thin" },
    { char: "\ue0ca", label: "Ice" },
    { char: "\ue0ce", label: "Honeycomb" },
    // Trapezoid / rounded
    { char: "\ue0d4", label: "Rounded" },
];

// Nerd Font icon categories
interface NerdFontCategory {
    name: string;
    faIcon: string;
    symbols: SymbolOption[];
}

const NERD_FONT_CATEGORIES: NerdFontCategory[] = [
    {
        name: "OS",
        faIcon: "fa-solid fa-desktop",
        symbols: [
            { char: "\uf17a", label: "Windows" },
            { char: "\uf179", label: "Apple" },
            { char: "\uf17c", label: "Linux" },
            { char: "\ue712", label: "Ubuntu" },
            { char: "\uf31b", label: "Raspberry Pi" },
        ],
    },
    {
        name: "Dev",
        faIcon: "fa-solid fa-code",
        symbols: [
            { char: "\ue73c", label: "Python" },
            { char: "\ue627", label: "Go" },
            { char: "\ue7a8", label: "Rust" },
            { char: "\ue718", label: "Node.js" },
            { char: "\ue738", label: "Java" },
            { char: "\ue739", label: "Ruby" },
            { char: "\ue73d", label: "PHP" },
            { char: "\ue7b0", label: "Docker" },
            { char: "\ue77f", label: ".NET" },
            { char: "\ue635", label: "C" },
            { char: "\ue61d", label: "C++" },
            { char: "\ue781", label: "C#" },
        ],
    },
    {
        name: "Git",
        faIcon: "fa-solid fa-code-branch",
        symbols: [
            { char: "\ue725", label: "Git" },
            { char: "\ue726", label: "Branch" },
            { char: "\ue727", label: "Commit" },
            { char: "\ue728", label: "Merge" },
            { char: "\uf113", label: "GitHub" },
            { char: "\uf7a1", label: "GitLab" },
        ],
    },
    {
        name: "Shell",
        faIcon: "fa-solid fa-terminal",
        symbols: [
            { char: "\uf489", label: "Terminal" },
            { char: "\uf120", label: "Prompt" },
            { char: "\uf07b", label: "Folder" },
            { char: "\uf07c", label: "Folder open" },
            { char: "\uf015", label: "Home" },
            { char: "\uf15b", label: "File" },
            { char: "\uf292", label: "Root #" },
        ],
    },
    {
        name: "Status",
        faIcon: "fa-solid fa-circle-check",
        symbols: [
            { char: "\uf00c", label: "Check" },
            { char: "\uf00d", label: "Cross" },
            { char: "\uf071", label: "Warning" },
            { char: "\uf05a", label: "Info" },
            { char: "\uf06a", label: "Exclamation" },
            { char: "\uf0e7", label: "Lightning" },
        ],
    },
    {
        name: "Time",
        faIcon: "fa-solid fa-clock",
        symbols: [
            { char: "\uf017", label: "Clock" },
            { char: "\uf073", label: "Calendar" },
            { char: "\uf64f", label: "Stopwatch" },
        ],
    },
    {
        name: "Misc",
        faIcon: "fa-solid fa-icons",
        symbols: [
            { char: "\uf023", label: "Lock" },
            { char: "\uf09c", label: "Unlock" },
            { char: "\uf0ac", label: "Globe" },
            { char: "\uf1eb", label: "WiFi" },
            { char: "\uf240", label: "Battery" },
            { char: "\uf007", label: "User" },
            { char: "\uf21b", label: "Admin" },
            { char: "\uf233", label: "Server" },
            { char: "\uf1c0", label: "Database" },
            { char: "\uf13e", label: "Chain" },
        ],
    },
];

interface SymbolStripProps {
    value: string;
    direction: "left" | "right";
    onChange: (char: string) => void;
}

/**
 * Horizontal strip of clickable powerline symbols.
 * Used for leading_diamond, trailing_diamond, and powerline_symbol fields.
 */
export const SymbolStrip = memo(({ value, direction, onChange }: SymbolStripProps) => {
    const symbols = direction === "left" ? LEFT_SYMBOLS : RIGHT_SYMBOLS;

    return (
        <div className="omp-symbol-strip">
            <button
                className={cn("symbol-option", "symbol-none", { selected: !value })}
                onClick={() => onChange("")}
                title="None (clear)"
                type="button"
            >
                <i className="fa-solid fa-xmark" />
            </button>
            {symbols.map((sym) => (
                <button
                    key={sym.char}
                    className={cn("symbol-option", { selected: value === sym.char })}
                    onClick={() => onChange(sym.char)}
                    title={sym.label}
                    type="button"
                >
                    {sym.char}
                </button>
            ))}
        </div>
    );
});

SymbolStrip.displayName = "SymbolStrip";

interface NerdFontPickerProps {
    onInsert: (char: string) => void;
}

/**
 * Expandable Nerd Font icon picker.
 * Shows categorized icons that can be inserted into template fields.
 */
export const NerdFontPicker = memo(({ onInsert }: NerdFontPickerProps) => {
    const [isOpen, setIsOpen] = useState(false);

    const handleToggle = useCallback(() => {
        setIsOpen((prev) => !prev);
    }, []);

    const handleInsert = useCallback(
        (char: string) => {
            onInsert(char);
        },
        [onInsert]
    );

    return (
        <div className="omp-nerdfont-picker">
            <button
                className={cn("picker-toggle", { active: isOpen })}
                onClick={handleToggle}
                title={isOpen ? "Close icon picker" : "Insert Nerd Font icon"}
                type="button"
            >
                <i className="fa-solid fa-icons" />
                <span>Insert Icon</span>
            </button>
            {isOpen && (
                <div className="picker-panel">
                    {NERD_FONT_CATEGORIES.map((category) => (
                        <div key={category.name} className="picker-category">
                            <div className="category-header">
                                <i className={category.faIcon} />
                                <span>{category.name}</span>
                            </div>
                            <div className="category-icons">
                                {category.symbols.map((sym) => (
                                    <button
                                        key={sym.char}
                                        className="icon-option"
                                        onClick={() => handleInsert(sym.char)}
                                        title={sym.label}
                                        type="button"
                                    >
                                        {sym.char}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

NerdFontPicker.displayName = "NerdFontPicker";
