// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * macOS-style "Colors" picker popup.
 * Title bar with eyedropper + close, segmented tab bar (Grid / Spectrum / Sliders),
 * hex input, opacity slider, and recent colors row with large current-color square.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./color-picker-popup.scss";

// --- Types ---

interface RGBA {
    r: number;
    g: number;
    b: number;
    a: number;
}

interface HSV {
    h: number;
    s: number;
    v: number;
}

type PickerTab = "grid" | "spectrum" | "sliders";

interface ColorPickerPopupProps {
    initialColor: string;
    defaultColor?: string;
    anchorRect: DOMRect;
    onChange: (color: string) => void;
    onCommit: (color: string) => void;
    onCancel: () => void;
}

// --- Color Helpers ---

function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
}

function rgbToHsv(r: number, g: number, b: number): HSV {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s, v };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
    h = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0,
        g = 0,
        b = 0;
    if (h < 60) {
        r = c;
        g = x;
    } else if (h < 120) {
        r = x;
        g = c;
    } else if (h < 180) {
        g = c;
        b = x;
    } else if (h < 240) {
        g = x;
        b = c;
    } else if (h < 300) {
        r = x;
        b = c;
    } else {
        r = c;
        b = x;
    }
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
    };
}

function parseColor(color: string): RGBA {
    if (!color) return { r: 0, g: 0, b: 0, a: 1 };
    const hexMatch = /^#([0-9a-f]{3,8})$/i.exec(color);
    if (hexMatch) {
        const hex = hexMatch[1];
        if (hex.length === 3) {
            return {
                r: Number.parseInt(hex[0] + hex[0], 16),
                g: Number.parseInt(hex[1] + hex[1], 16),
                b: Number.parseInt(hex[2] + hex[2], 16),
                a: 1,
            };
        }
        if (hex.length === 6) {
            return {
                r: Number.parseInt(hex.slice(0, 2), 16),
                g: Number.parseInt(hex.slice(2, 4), 16),
                b: Number.parseInt(hex.slice(4, 6), 16),
                a: 1,
            };
        }
        if (hex.length === 8) {
            return {
                r: Number.parseInt(hex.slice(0, 2), 16),
                g: Number.parseInt(hex.slice(2, 4), 16),
                b: Number.parseInt(hex.slice(4, 6), 16),
                a: Number.parseInt(hex.slice(6, 8), 16) / 255,
            };
        }
    }
    const rgbaMatch = /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?))?\s*\)/.exec(color);
    if (rgbaMatch) {
        return {
            r: Math.round(parseFloat(rgbaMatch[1])),
            g: Math.round(parseFloat(rgbaMatch[2])),
            b: Math.round(parseFloat(rgbaMatch[3])),
            a: rgbaMatch[4] != null ? parseFloat(rgbaMatch[4]) : 1,
        };
    }
    try {
        const ctx = document.createElement("canvas").getContext("2d");
        if (ctx) {
            ctx.fillStyle = color;
            return parseColor(ctx.fillStyle);
        }
    } catch {
        // ignore
    }
    return { r: 0, g: 0, b: 0, a: 1 };
}

function rgbaToString(c: RGBA): string {
    if (c.a < 1) {
        return `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 100) / 100})`;
    }
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

function rgbaToHex6(c: RGBA): string {
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

// --- Recent Colors ---

const RECENT_COLORS_KEY = "wave:recent-picker-colors";
const MAX_RECENT_COLORS = 10;

function getRecentColors(): string[] {
    try {
        const stored = localStorage.getItem(RECENT_COLORS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function addRecentColor(color: string): void {
    const recent = getRecentColors().filter((c) => c !== color);
    recent.unshift(color);
    if (recent.length > MAX_RECENT_COLORS) recent.length = MAX_RECENT_COLORS;
    try {
        localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recent));
    } catch {
        // ignore
    }
}

// --- Color Grid ---

const COLOR_GRID: string[][] = (() => {
    const hues = [0, 30, 55, 90, 120, 165, 195, 230, 280, 325];
    const grid: string[][] = [];
    // Gray row
    const grays: string[] = [];
    for (let i = 0; i < hues.length; i++) {
        const v = Math.round((i / (hues.length - 1)) * 255);
        const hex = v.toString(16).padStart(2, "0");
        grays.push(`#${hex}${hex}${hex}`);
    }
    grid.push(grays);
    // Color rows at different saturation/brightness levels
    const levels = [
        { s: 0.15, v: 1.0 },
        { s: 0.3, v: 1.0 },
        { s: 0.5, v: 1.0 },
        { s: 1.0, v: 1.0 },
        { s: 1.0, v: 0.8 },
        { s: 1.0, v: 0.6 },
        { s: 0.8, v: 0.35 },
    ];
    for (const level of levels) {
        const row: string[] = [];
        for (const hue of hues) {
            const { r, g, b } = hsvToRgb(hue, level.s, level.v);
            row.push(rgbaToHex6({ r, g, b, a: 1 }));
        }
        grid.push(row);
    }
    return grid;
})();

// --- Slider Track ---

interface SliderTrackProps {
    value: number;
    onChange: (value: number) => void;
    className?: string;
    style?: React.CSSProperties;
}

function SliderTrack({ value, onChange, className, style }: SliderTrackProps) {
    const trackRef = useRef<HTMLDivElement>(null);

    const handleInteraction = useCallback(
        (clientX: number) => {
            const track = trackRef.current;
            if (!track) return;
            const rect = track.getBoundingClientRect();
            onChange(clamp((clientX - rect.left) / rect.width, 0, 1));
        },
        [onChange]
    );

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            handleInteraction(e.clientX);
            const onMove = (ev: MouseEvent) => handleInteraction(ev.clientX);
            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        },
        [handleInteraction]
    );

    return (
        <div
            ref={trackRef}
            className={`cp-slider-track ${className ?? ""}`}
            style={style}
            onMouseDown={handleMouseDown}
        >
            <div className="cp-slider-handle" style={{ left: `${value * 100}%` }} />
        </div>
    );
}

// --- Main Component ---

const SLIDER_CHANNELS = [
    { key: "r" as const, label: "Red" },
    { key: "g" as const, label: "Green" },
    { key: "b" as const, label: "Blue" },
];

const ColorPickerPopup = memo(({ initialColor, defaultColor, anchorRect, onChange, onCommit, onCancel }: ColorPickerPopupProps) => {
    const initial = useMemo(() => parseColor(initialColor), [initialColor]);
    const initialHsv = useMemo(() => rgbToHsv(initial.r, initial.g, initial.b), [initial]);
    const defaultRgba = useMemo(() => parseColor(defaultColor ?? initialColor), [defaultColor, initialColor]);
    const defaultHsv = useMemo(() => rgbToHsv(defaultRgba.r, defaultRgba.g, defaultRgba.b), [defaultRgba]);

    const [hsv, setHsv] = useState<HSV>(initialHsv);
    const [alpha, setAlpha] = useState(initial.a);
    const [tab, setTab] = useState<PickerTab>("grid");
    const [hexInput, setHexInput] = useState(rgbaToHex6(initial));
    const [recentColors, setRecentColors] = useState(() => getRecentColors());

    const mountedRef = useRef(false);

    // Current RGBA from HSV + alpha
    const currentRgba = useMemo((): RGBA => {
        const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
        return { r, g, b, a: alpha };
    }, [hsv, alpha]);

    const currentColorString = useMemo(() => rgbaToString(currentRgba), [currentRgba]);
    const currentHex = useMemo(() => rgbaToHex6(currentRgba), [currentRgba]);
    const currentRgb = useMemo(() => hsvToRgb(hsv.h, hsv.s, hsv.v), [hsv]);
    const defaultHex = useMemo(() => rgbaToHex6(defaultRgba), [defaultRgba]);
    const hasChanged = currentHex.toLowerCase() !== defaultHex.toLowerCase() || alpha !== defaultRgba.a;

    // Notify parent of live color changes (skip initial render)
    useEffect(() => {
        if (!mountedRef.current) {
            mountedRef.current = true;
            return;
        }
        onChange(currentColorString);
    }, [currentColorString, onChange]);

    // Sync hex input when color changes from non-text interaction
    useEffect(() => {
        setHexInput(currentHex);
    }, [currentHex]);

    // Escape = cancel, revert to initial
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onChange(initialColor);
                onCancel();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [initialColor, onChange, onCancel]);

    // Commit: save to recent and persist
    const handleCommit = useCallback(() => {
        addRecentColor(currentColorString);
        setRecentColors(getRecentColors());
        onCommit(currentColorString);
    }, [currentColorString, onCommit]);

    // Grid cell click
    const handleGridClick = useCallback((color: string) => {
        const rgba = parseColor(color);
        setHsv(rgbToHsv(rgba.r, rgba.g, rgba.b));
    }, []);

    // Spectrum area interaction (hue × brightness, saturation fixed at 1.0)
    const spectrumRef = useRef<HTMLDivElement>(null);
    const handleSpectrumInteraction = useCallback((clientX: number, clientY: number) => {
        const el = spectrumRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const h = clamp((clientX - rect.left) / rect.width, 0, 1) * 360;
        const v = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
        setHsv({ h, s: 1, v });
    }, []);

    const handleSpectrumMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            handleSpectrumInteraction(e.clientX, e.clientY);
            const onMove = (ev: MouseEvent) => handleSpectrumInteraction(ev.clientX, ev.clientY);
            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        },
        [handleSpectrumInteraction]
    );

    // Hue slider (used in Grid tab)
    const handleHueChange = useCallback((normalized: number) => {
        setHsv((prev) => ({ ...prev, h: normalized * 360 }));
    }, []);

    // RGB slider changes
    const handleRgbChange = useCallback(
        (channel: "r" | "g" | "b", value: number) => {
            const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
            rgb[channel] = Math.round(value);
            const newHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
            if (newHsv.s === 0) newHsv.h = hsv.h;
            setHsv(newHsv);
        },
        [hsv]
    );

    // Hex text input
    const handleHexInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const val = e.target.value;
            setHexInput(val);
            if (/^#[0-9a-f]{6}$/i.test(val)) {
                const rgba = parseColor(val);
                const newHsv = rgbToHsv(rgba.r, rgba.g, rgba.b);
                if (newHsv.s === 0) newHsv.h = hsv.h;
                setHsv(newHsv);
            }
        },
        [hsv.h]
    );

    // Recent color click
    const handleRecentClick = useCallback((color: string) => {
        const rgba = parseColor(color);
        setHsv(rgbToHsv(rgba.r, rgba.g, rgba.b));
        setAlpha(rgba.a);
    }, []);

    // Revert to theme default (click large current-color square or revert button)
    const handleRevert = useCallback(() => {
        setHsv(defaultHsv);
        setAlpha(defaultRgba.a);
    }, [defaultHsv, defaultRgba.a]);

    // Add current color to recent (+ button)
    const handleAddRecent = useCallback(() => {
        addRecentColor(currentColorString);
        setRecentColors(getRecentColors());
    }, [currentColorString]);

    // Eyedropper (EyeDropper API — Chromium only)
    const handleEyedropper = useCallback(async () => {
        if (!("EyeDropper" in window)) return;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dropper = new (window as any).EyeDropper();
            const result = await dropper.open();
            if (result?.sRGBHex) {
                const rgba = parseColor(result.sRGBHex);
                const newHsv = rgbToHsv(rgba.r, rgba.g, rgba.b);
                setHsv(newHsv);
            }
        } catch {
            // User cancelled or API not available
        }
    }, []);

    // Popup position
    const popupStyle = useMemo((): React.CSSProperties => {
        const popupWidth = 290;
        const popupHeight = 460;
        const margin = 8;
        let top = anchorRect.bottom + margin;
        let left = anchorRect.left;
        if (left + popupWidth > window.innerWidth - margin) {
            left = window.innerWidth - popupWidth - margin;
        }
        if (top + popupHeight > window.innerHeight - margin) {
            top = anchorRect.top - popupHeight - margin;
        }
        left = Math.max(margin, left);
        top = Math.max(margin, top);
        return { top, left };
    }, [anchorRect]);

    // Derived style values
    const opaqueColor = useMemo(
        () => `rgb(${currentRgba.r},${currentRgba.g},${currentRgba.b})`,
        [currentRgba]
    );

    return createPortal(
        <>
            <div className="cp-backdrop" onClick={handleCommit} />
            <div className="cp-popup" style={popupStyle}>
                {/* Title bar */}
                <div className="cp-titlebar">
                    <button
                        className="cp-titlebar-btn"
                        onClick={handleEyedropper}
                        title="Pick color from screen"
                    >
                        <i className="fa fa-solid fa-eye-dropper" />
                    </button>
                    <span className="cp-titlebar-title">Colors</span>
                    <div className="cp-titlebar-actions">
                        {hasChanged && (
                            <button
                                className="cp-titlebar-btn"
                                onClick={handleRevert}
                                title="Revert to original"
                            >
                                <i className="fa fa-solid fa-rotate-left" />
                            </button>
                        )}
                        <button className="cp-titlebar-btn" onClick={handleCommit} title="Close">
                            <i className="fa fa-solid fa-xmark" />
                        </button>
                    </div>
                </div>

                {/* Segmented tab bar */}
                <div className="cp-tabs">
                    {(["grid", "spectrum", "sliders"] as PickerTab[]).map((t) => (
                        <button
                            key={t}
                            className={`cp-tab${tab === t ? " cp-tab--active" : ""}`}
                            onClick={() => setTab(t)}
                        >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>

                {/* Tab content */}
                <div className="cp-content">
                    {tab === "grid" && (
                        <div className="cp-grid">
                            <div className="cp-grid-colors">
                                {COLOR_GRID.map((row, ri) => (
                                    <div key={ri} className="cp-grid-row">
                                        {row.map((color, ci) => (
                                            <button
                                                key={ci}
                                                className={`cp-grid-cell${color.toLowerCase() === currentHex.toLowerCase() ? " cp-grid-cell--selected" : ""}`}
                                                style={{ backgroundColor: color }}
                                                onClick={() => handleGridClick(color)}
                                                title={color}
                                            />
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {tab === "spectrum" && (
                        <div
                            ref={spectrumRef}
                            className="cp-spectrum-area"
                            onMouseDown={handleSpectrumMouseDown}
                        >
                            <div
                                className="cp-spectrum-cursor"
                                style={{
                                    left: `${(hsv.h / 360) * 100}%`,
                                    top: `${(1 - hsv.v) * 100}%`,
                                }}
                            />
                        </div>
                    )}

                    {tab === "sliders" && (
                        <div className="cp-sliders">
                            <div className="cp-slider-group">
                                <span className="cp-slider-label">Hue</span>
                                <div className="cp-slider-row">
                                    <SliderTrack
                                        className="cp-hue-slider"
                                        value={hsv.h / 360}
                                        onChange={handleHueChange}
                                    />
                                    <input
                                        type="number"
                                        className="cp-slider-number"
                                        min={0}
                                        max={360}
                                        value={Math.round(hsv.h)}
                                        onChange={(e) =>
                                            setHsv((prev) => ({
                                                ...prev,
                                                h: clamp(parseInt(e.target.value) || 0, 0, 360),
                                            }))
                                        }
                                    />
                                </div>
                            </div>
                            {SLIDER_CHANNELS.map(({ key: ch, label }) => {
                                const val = currentRgb[ch];
                                const from = { ...currentRgb, [ch]: 0 };
                                const to = { ...currentRgb, [ch]: 255 };
                                const gradient = `linear-gradient(to right, rgb(${from.r},${from.g},${from.b}), rgb(${to.r},${to.g},${to.b}))`;
                                return (
                                    <div key={ch} className="cp-slider-group">
                                        <span className="cp-slider-label">{label}</span>
                                        <div className="cp-slider-row">
                                            <SliderTrack
                                                className="cp-rgb-slider"
                                                value={val / 255}
                                                onChange={(v) => handleRgbChange(ch, v * 255)}
                                                style={{ background: gradient }}
                                            />
                                            <input
                                                type="number"
                                                className="cp-slider-number"
                                                min={0}
                                                max={255}
                                                value={val}
                                                onChange={(e) =>
                                                    handleRgbChange(ch, clamp(parseInt(e.target.value) || 0, 0, 255))
                                                }
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Hex input row */}
                <div className="cp-hex-row">
                    <span className="cp-hex-label">Hex Color #</span>
                    <input
                        type="text"
                        className="cp-hex-input"
                        value={hexInput}
                        onChange={handleHexInputChange}
                        spellCheck={false}
                    />
                </div>

                {/* Opacity slider */}
                <div className="cp-opacity-section">
                    <span className="cp-opacity-label">Opacity</span>
                    <div className="cp-opacity-track-wrapper">
                        <SliderTrack
                            className="cp-opacity-slider"
                            value={alpha}
                            onChange={setAlpha}
                            style={{
                                background: `linear-gradient(to right, transparent, ${opaqueColor})`,
                            }}
                        />
                    </div>
                    <span className="cp-opacity-value">{Math.round(alpha * 100)}%</span>
                </div>

                {/* Recent colors: large current square + circle swatches + add button */}
                <div className="cp-recent">
                    <div
                        className="cp-recent-current"
                        style={{ backgroundColor: currentColorString }}
                        title="Current color — click to revert to original"
                        onClick={handleRevert}
                    />
                    <div className="cp-recent-swatches">
                        {recentColors.map((color, i) => (
                            <button
                                key={i}
                                className="cp-recent-swatch"
                                style={{ backgroundColor: color }}
                                onClick={() => handleRecentClick(color)}
                                title={color}
                            />
                        ))}
                    </div>
                    <button
                        className="cp-recent-add"
                        onClick={handleAddRecent}
                        title="Save current color"
                    >
                        <i className="fa fa-solid fa-plus" />
                    </button>
                </div>
            </div>
        </>,
        document.body
    );
});

ColorPickerPopup.displayName = "ColorPickerPopup";

export { ColorPickerPopup };
export type { ColorPickerPopupProps };
