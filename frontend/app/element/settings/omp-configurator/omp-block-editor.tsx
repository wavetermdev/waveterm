// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * OMP Block Editor
 *
 * Editor for OMP configuration blocks and segments.
 */

import { cn } from "@/util/util";
import { memo, useCallback } from "react";

import { NerdFontPicker, SymbolStrip } from "./omp-symbol-picker";

interface OmpBlockEditorProps {
    config: OmpConfigData | null;
    selectedBlockIndex: number;
    selectedSegmentIndex: number;
    onBlockSelect: (blockIndex: number) => void;
    onSegmentSelect: (blockIndex: number, segmentIndex: number) => void;
    onConfigUpdate: (config: OmpConfigData) => void;
}

/**
 * Get display name for a segment type
 */
function getSegmentDisplayName(type: string): string {
    const displayNames: Record<string, string> = {
        os: "OS",
        path: "Path",
        git: "Git",
        session: "Session",
        time: "Time",
        battery: "Battery",
        shell: "Shell",
        text: "Text",
        exit: "Exit Code",
        root: "Root",
        node: "Node.js",
        python: "Python",
        go: "Go",
        rust: "Rust",
        java: "Java",
        ruby: "Ruby",
        php: "PHP",
        dotnet: ".NET",
        kubectl: "Kubectl",
        aws: "AWS",
        az: "Azure",
        gcp: "GCP",
        docker: "Docker",
        terraform: "Terraform",
        executiontime: "Execution Time",
        status: "Status",
    };
    return displayNames[type] || type;
}

/**
 * Get segment type icon class string (includes fa-solid or fa-brands prefix)
 */
function getSegmentIconClass(type: string): string {
    // Brand icons require fa-brands instead of fa-solid
    const brandIcons: Record<string, string> = {
        node: "fa-node-js",
        python: "fa-python",
        go: "fa-golang",
        rust: "fa-rust",
        java: "fa-java",
        php: "fa-php",
        dotnet: "fa-microsoft",
        aws: "fa-aws",
        az: "fa-microsoft",
        gcp: "fa-google",
        docker: "fa-docker",
    };

    // Solid icons use fa-solid
    const solidIcons: Record<string, string> = {
        os: "fa-desktop",
        path: "fa-folder",
        git: "fa-code-branch",
        session: "fa-user",
        time: "fa-clock",
        battery: "fa-battery-full",
        shell: "fa-terminal",
        text: "fa-font",
        exit: "fa-circle-xmark",
        root: "fa-hashtag",
        ruby: "fa-gem",
        kubectl: "fa-cloud",
        terraform: "fa-cubes",
        executiontime: "fa-stopwatch",
        status: "fa-circle-check",
        cmake: "fa-gears",
    };

    if (brandIcons[type]) {
        return `fa-brands ${brandIcons[type]}`;
    }
    if (solidIcons[type]) {
        return `fa-solid ${solidIcons[type]}`;
    }
    return "fa-solid fa-puzzle-piece";
}

/**
 * Segment badge component
 */
const SegmentBadge = memo(
    ({
        segment,
        selected,
        onClick,
    }: {
        segment: OmpSegmentData;
        selected: boolean;
        onClick: () => void;
    }) => {
        const handleKeyDown = useCallback(
            (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onClick();
                }
            },
            [onClick]
        );

        return (
            <div
                className={cn("omp-segment-badge", { selected })}
                onClick={(e) => {
                    e.stopPropagation();
                    onClick();
                }}
                onKeyDown={handleKeyDown}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`${getSegmentDisplayName(segment.type)} segment${selected ? " (selected)" : ""}`}
            >
                <i className={`${getSegmentIconClass(segment.type)} segment-icon`} />
                <span className="segment-name">{getSegmentDisplayName(segment.type)}</span>
                {segment.background && segment.background !== "transparent" && (
                    <span
                        className="segment-color"
                        style={{ backgroundColor: segment.background }}
                        title={`Background: ${segment.background}`}
                    />
                )}
            </div>
        );
    }
);

SegmentBadge.displayName = "SegmentBadge";

/**
 * Block item component
 */
const BlockItem = memo(
    ({
        block,
        blockIndex,
        selected,
        selectedSegmentIndex,
        onBlockSelect,
        onSegmentSelect,
    }: {
        block: OmpBlockData;
        blockIndex: number;
        selected: boolean;
        selectedSegmentIndex: number;
        onBlockSelect: () => void;
        onSegmentSelect: (segmentIndex: number) => void;
    }) => {
        const handleKeyDown = useCallback(
            (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onBlockSelect();
                }
            },
            [onBlockSelect]
        );

        return (
            <div
                className={cn("omp-block-item", { selected })}
                onClick={onBlockSelect}
                onKeyDown={handleKeyDown}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`${block.type} block (${block.alignment})${selected ? " - selected" : ""}`}
            >
                <div className="block-header">
                    <span className="block-type">
                        <i
                            className={cn("fa fa-solid", {
                                "fa-terminal": block.type === "prompt",
                                "fa-align-right": block.type === "rprompt",
                            })}
                        />
                        {block.type}
                        {block.newline && (
                            <i
                                className="fa-solid fa-arrow-turn-down newline-badge"
                                title="Starts on new line"
                            />
                        )}
                    </span>
                    <span className="block-alignment">{block.alignment}</span>
                </div>
                <div className="block-segments">
                    {block.segments?.map((segment, segIndex) => (
                        <SegmentBadge
                            key={segIndex}
                            segment={segment}
                            selected={selected && segIndex === selectedSegmentIndex}
                            onClick={() => {
                                onSegmentSelect(segIndex);
                            }}
                        />
                    ))}
                    {(!block.segments || block.segments.length === 0) && (
                        <div className="block-empty">No segments</div>
                    )}
                </div>
            </div>
        );
    }
);

BlockItem.displayName = "BlockItem";

/**
 * Segment properties panel
 */
const SegmentPropertiesPanel = memo(
    ({
        segment,
        onUpdate,
    }: {
        segment: OmpSegmentData | null;
        onUpdate: (updates: Partial<OmpSegmentData>) => void;
    }) => {
        // All hooks must be called before any early returns (React Rules of Hooks)
        const handleForegroundChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                onUpdate({ foreground: e.target.value });
            },
            [onUpdate]
        );

        const handleBackgroundChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                onUpdate({ background: e.target.value });
            },
            [onUpdate]
        );

        const handleStyleChange = useCallback(
            (e: React.ChangeEvent<HTMLSelectElement>) => {
                onUpdate({ style: e.target.value });
            },
            [onUpdate]
        );

        const handleTemplateChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                onUpdate({ template: e.target.value });
            },
            [onUpdate]
        );

        const handleLeadingDiamondChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                onUpdate({ leading_diamond: e.target.value });
            },
            [onUpdate]
        );

        const handleTrailingDiamondChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                onUpdate({ trailing_diamond: e.target.value });
            },
            [onUpdate]
        );

        const handlePowerlineSymbolChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                onUpdate({ powerline_symbol: e.target.value });
            },
            [onUpdate]
        );

        const handleInvertPowerlineChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                onUpdate({ invert_powerline: e.target.checked });
            },
            [onUpdate]
        );

        if (!segment) {
            return (
                <div className="omp-segment-properties empty">
                    <div className="properties-placeholder">
                        <i className="fa fa-solid fa-hand-pointer" />
                        <span>Select a segment to edit its properties</span>
                    </div>
                </div>
            );
        }

        return (
            <div className="omp-segment-properties">
                <div className="properties-header">
                    <span className="segment-title">{getSegmentDisplayName(segment.type)}</span>
                    <span className="segment-type-badge">{segment.type}</span>
                </div>

                <div className="property-group">
                    <div className="group-title">Appearance</div>

                    <div className="property-row">
                        <label className="property-label">Style</label>
                        <select
                            className="property-value property-select"
                            value={segment.style || "plain"}
                            onChange={handleStyleChange}
                        >
                            <option value="plain">Plain</option>
                            <option value="powerline">Powerline</option>
                            <option value="diamond">Diamond</option>
                            <option value="accordion">Accordion</option>
                        </select>
                    </div>

                    {segment.style === "diamond" && (
                        <>
                            <div className="property-row full-width">
                                <label className="property-label">Leading</label>
                                <div className="property-value">
                                    <input
                                        type="text"
                                        className="property-template"
                                        value={segment.leading_diamond || ""}
                                        onChange={handleLeadingDiamondChange}
                                        placeholder="Pick a left-pointing symbol"
                                    />
                                    <SymbolStrip
                                        value={segment.leading_diamond || ""}
                                        direction="left"
                                        onChange={(char) => onUpdate({ leading_diamond: char })}
                                    />
                                </div>
                            </div>
                            <div className="property-row full-width">
                                <label className="property-label">Trailing</label>
                                <div className="property-value">
                                    <input
                                        type="text"
                                        className="property-template"
                                        value={segment.trailing_diamond || ""}
                                        onChange={handleTrailingDiamondChange}
                                        placeholder="Pick a right-pointing symbol"
                                    />
                                    <SymbolStrip
                                        value={segment.trailing_diamond || ""}
                                        direction="right"
                                        onChange={(char) => onUpdate({ trailing_diamond: char })}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {segment.style === "powerline" && (
                        <>
                            <div className="property-row full-width">
                                <label className="property-label">Symbol</label>
                                <div className="property-value">
                                    <input
                                        type="text"
                                        className="property-template"
                                        value={segment.powerline_symbol || ""}
                                        onChange={handlePowerlineSymbolChange}
                                        placeholder="Default: arrow (pick below)"
                                    />
                                    <SymbolStrip
                                        value={segment.powerline_symbol || ""}
                                        direction="right"
                                        onChange={(char) => onUpdate({ powerline_symbol: char })}
                                    />
                                </div>
                            </div>
                            <div className="property-row">
                                <label className="property-label">Invert</label>
                                <div className="property-value checkbox-input">
                                    <input
                                        type="checkbox"
                                        checked={segment.invert_powerline ?? false}
                                        onChange={handleInvertPowerlineChange}
                                        id="segment-invert-powerline"
                                    />
                                    <label htmlFor="segment-invert-powerline">
                                        Swap foreground/background colors
                                    </label>
                                </div>
                            </div>
                        </>
                    )}

                    <div className="property-row">
                        <label className="property-label">Foreground</label>
                        <div className="property-value color-input">
                            <input
                                type="text"
                                value={segment.foreground || ""}
                                onChange={handleForegroundChange}
                                placeholder="#ffffff or p:colorname"
                            />
                            {segment.foreground && !segment.foreground.startsWith("p:") && (
                                <span
                                    className="color-preview"
                                    style={{ backgroundColor: segment.foreground }}
                                />
                            )}
                        </div>
                    </div>

                    <div className="property-row">
                        <label className="property-label">Background</label>
                        <div className="property-value color-input">
                            <input
                                type="text"
                                value={segment.background || ""}
                                onChange={handleBackgroundChange}
                                placeholder="#000000 or p:colorname"
                            />
                            {segment.background &&
                                segment.background !== "transparent" &&
                                !segment.background.startsWith("p:") && (
                                    <span
                                        className="color-preview"
                                        style={{ backgroundColor: segment.background }}
                                    />
                                )}
                        </div>
                    </div>
                </div>

                <div className="property-group">
                    <div className="group-title">Template</div>
                    <div className="property-row full-width">
                        <input
                            type="text"
                            className="property-value property-template"
                            value={segment.template || ""}
                            onChange={handleTemplateChange}
                            placeholder="{{ .SegmentTemplate }}"
                        />
                    </div>
                    <NerdFontPicker
                        onInsert={(char) => {
                            onUpdate({ template: (segment.template || "") + char });
                        }}
                    />
                </div>
            </div>
        );
    }
);

SegmentPropertiesPanel.displayName = "SegmentPropertiesPanel";

/**
 * Block properties panel - shows block-level settings (newline, filler)
 */
const BlockPropertiesPanel = memo(
    ({
        block,
        blockIndex,
        onUpdate,
    }: {
        block: OmpBlockData | null;
        blockIndex: number;
        onUpdate: (updates: Partial<OmpBlockData>) => void;
    }) => {
        const handleNewlineChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                onUpdate({ newline: e.target.checked });
            },
            [onUpdate]
        );

        if (!block || blockIndex === 0) {
            return null;
        }

        return (
            <div className="omp-block-properties">
                <div className="property-group">
                    <div className="group-title">Block</div>
                    <div className="property-row">
                        <label className="property-label">Newline</label>
                        <div className="property-value checkbox-input">
                            <input
                                type="checkbox"
                                checked={block.newline ?? false}
                                onChange={handleNewlineChange}
                                id={`block-newline-${blockIndex}`}
                            />
                            <label htmlFor={`block-newline-${blockIndex}`}>
                                Start this block on a new line
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
);

BlockPropertiesPanel.displayName = "BlockPropertiesPanel";

export const OmpBlockEditor = memo(
    ({
        config,
        selectedBlockIndex,
        selectedSegmentIndex,
        onBlockSelect,
        onSegmentSelect,
        onConfigUpdate,
    }: OmpBlockEditorProps) => {
        const selectedBlock = config?.blocks?.[selectedBlockIndex] ?? null;
        const selectedSegment = selectedBlock?.segments?.[selectedSegmentIndex] ?? null;

        const handleSegmentUpdate = useCallback(
            (updates: Partial<OmpSegmentData>) => {
                if (!config) return;

                const newConfig = structuredClone(config);
                const segment = newConfig.blocks?.[selectedBlockIndex]?.segments?.[selectedSegmentIndex];
                if (segment) {
                    Object.assign(segment, updates);
                    onConfigUpdate(newConfig);
                }
            },
            [config, selectedBlockIndex, selectedSegmentIndex, onConfigUpdate]
        );

        const handleBlockUpdate = useCallback(
            (updates: Partial<OmpBlockData>) => {
                if (!config) return;

                const newConfig = structuredClone(config);
                const block = newConfig.blocks?.[selectedBlockIndex];
                if (block) {
                    Object.assign(block, updates);
                    onConfigUpdate(newConfig);
                }
            },
            [config, selectedBlockIndex, onConfigUpdate]
        );

        if (!config) {
            return null;
        }

        return (
            <div className="omp-block-editor">
                <div className="editor-layout">
                    <div className="blocks-column">
                        <div className="column-header">
                            <i className="fa fa-solid fa-layer-group" />
                            <span>Blocks</span>
                            <span className="count">{config.blocks?.length ?? 0}</span>
                        </div>
                        <div className="omp-block-list">
                            {config.blocks?.map((block, blockIndex) => (
                                <BlockItem
                                    key={blockIndex}
                                    block={block}
                                    blockIndex={blockIndex}
                                    selected={blockIndex === selectedBlockIndex}
                                    selectedSegmentIndex={selectedSegmentIndex}
                                    onBlockSelect={() => onBlockSelect(blockIndex)}
                                    onSegmentSelect={(segIndex) => onSegmentSelect(blockIndex, segIndex)}
                                />
                            ))}
                            {(!config.blocks || config.blocks.length === 0) && (
                                <div className="blocks-empty">
                                    <i className="fa fa-solid fa-cubes" />
                                    <span>No blocks configured</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="properties-column">
                        <div className="column-header">
                            <i className="fa fa-solid fa-sliders" />
                            <span>Properties</span>
                        </div>
                        <BlockPropertiesPanel
                            block={selectedBlock}
                            blockIndex={selectedBlockIndex}
                            onUpdate={handleBlockUpdate}
                        />
                        <SegmentPropertiesPanel segment={selectedSegment} onUpdate={handleSegmentUpdate} />
                    </div>
                </div>
            </div>
        );
    }
);

OmpBlockEditor.displayName = "OmpBlockEditor";
