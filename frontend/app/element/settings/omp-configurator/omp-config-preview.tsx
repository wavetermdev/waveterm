// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * OMP Config Preview
 *
 * Displays a visual preview of the OMP configuration with color swatches.
 */

import { cn } from "@/util/util";
import React, { memo } from "react";

import type { PreviewBackground } from "../preview-background-toggle";

interface OmpConfigPreviewProps {
    config: OmpConfigData | null;
    previewBackground: PreviewBackground;
}

/**
 * Resolve a color value that might be a palette reference
 */
function resolveColor(color: string | undefined, palette: Record<string, string> | undefined): string {
    if (!color) return "transparent";

    // Palette reference (e.g., "p:blue")
    if (color.startsWith("p:")) {
        const paletteName = color.slice(2);
        const resolved = palette?.[paletteName];
        if (resolved) {
            return resolveColor(resolved, palette);
        }
        return color; // Unresolved
    }

    // Transparent
    if (color.toLowerCase() === "transparent" || color === "") {
        return "transparent";
    }

    return color;
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
 * Realistic sample data for each OMP segment type.
 * Used in the preview to approximate what the terminal actually renders.
 */
const SEGMENT_SAMPLE_DATA: Record<string, string> = {
    os: "\uf17a",
    shell: "\uf489 pwsh",
    path: "\uf07b ~/project",
    git: "\ue725 main",
    time: "\uf017 12:00:00",
    executiontime: "\uf64f 0.5s",
    status: "\uf00c",
    exit: "\uf00c",
    text: "\uf192",
    root: "#",
    session: "\uf007 user@host",
    battery: "\uf240 100%",
    node: "\ue718 v20.0",
    python: "\ue73c 3.12",
    go: "\ue627 1.22",
    rust: "\ue7a8 1.78",
    java: "\ue738 21",
    ruby: "\ue739 3.3",
    php: "\ue73d 8.3",
    dotnet: "\ue77f 8.0",
    docker: "\ue7b0 24.0",
    kubectl: "\uf0ac ctx",
    terraform: "\uf1b3 ws",
    cmake: "\uf085 3.28",
    aws: "\uf0ac us-east-1",
    az: "\uf0ac sub",
    gcp: "\uf0ac proj",
};

/**
 * Get sample display text for a segment.
 * Extracts literal chars from the template first; if nothing useful remains,
 * falls back to type-specific sample data, then to the type name.
 */
function getSegmentSample(segment: OmpSegmentData): string {
    // Try extracting literal text from template (Nerd Font chars, prompt symbols)
    if (segment.template) {
        const literal = segment.template
            .replace(/\{\{[^}]*\}\}/g, "") // Strip Go template expressions
            .replace(/<\/?[^>]*>/g, "") // Strip OMP color tags
            .replace(/\s{2,}/g, " ")
            .trim();
        if (literal.length > 0) {
            return literal;
        }
    }
    return SEGMENT_SAMPLE_DATA[segment.type] || segment.type;
}

/**
 * Segment preview component.
 * - Powerline/diamond segments: icon + type name (readable labels for editing).
 * - Plain segments: sample data approximating the actual terminal output.
 */
const SegmentPreview = memo(
    ({
        segment,
        palette,
    }: {
        segment: OmpSegmentData;
        palette?: Record<string, string>;
    }) => {
        const bg = resolveColor(segment.background, palette);
        const fg = resolveColor(segment.foreground, palette);
        const isTransparent = bg === "transparent" || !bg;
        const isStyled = segment.style === "powerline" || segment.style === "diamond";

        return (
            <div
                className={cn("segment-preview", segment.style, { transparent: isTransparent })}
                style={{
                    backgroundColor: isTransparent ? undefined : bg,
                    color: fg,
                }}
                title={`${segment.type}: ${segment.template || "(no template)"}`}
            >
                {isStyled ? (
                    <span className="segment-content">
                        <i className={getSegmentIconClass(segment.type)} />
                        <span className="segment-type">{segment.type}</span>
                    </span>
                ) : (
                    <span className="segment-template-preview">{getSegmentSample(segment)}</span>
                )}
            </div>
        );
    }
);

SegmentPreview.displayName = "SegmentPreview";

/**
 * Powerline/diamond separator rendered BETWEEN segments.
 * Must be outside the segment div so the arrow color is visible
 * against the preview background (not hidden by the segment's own BG).
 */
const SegmentSeparator = memo(
    ({
        segment,
        nextSegment,
        palette,
    }: {
        segment: OmpSegmentData;
        nextSegment: OmpSegmentData | null;
        palette?: Record<string, string>;
    }) => {
        const bg = resolveColor(segment.background, palette);
        const nextBg = nextSegment ? resolveColor(nextSegment.background, palette) : undefined;
        const isNextTransparent = !nextBg || nextBg === "transparent";

        if (segment.style === "powerline") {
            const symbol = segment.powerline_symbol || "\ue0b0";
            return (
                <span
                    className="powerline-separator"
                    style={{
                        color: bg,
                        backgroundColor: isNextTransparent ? undefined : nextBg,
                    }}
                    title="Powerline separator"
                >
                    {symbol}
                </span>
            );
        }

        if (segment.style === "diamond" && segment.trailing_diamond) {
            return (
                <span className="diamond-separator" style={{ color: bg }} title="Diamond trailing">
                    {segment.trailing_diamond}
                </span>
            );
        }

        return null;
    }
);

SegmentSeparator.displayName = "SegmentSeparator";

/**
 * Diamond leading character rendered BEFORE a segment.
 */
const DiamondLeading = memo(
    ({
        segment,
        palette,
    }: {
        segment: OmpSegmentData;
        palette?: Record<string, string>;
    }) => {
        if (segment.style !== "diamond" || !segment.leading_diamond) {
            return null;
        }

        const bg = resolveColor(segment.background, palette);

        return (
            <span className="diamond-separator" style={{ color: bg }} title="Diamond leading">
                {segment.leading_diamond}
            </span>
        );
    }
);

DiamondLeading.displayName = "DiamondLeading";

/**
 * Render segments for a single block (used inside a line)
 */
const BlockSegments = memo(
    ({
        block,
        palette,
        blockKey,
    }: {
        block: OmpBlockData;
        palette?: Record<string, string>;
        blockKey: string;
    }) => {
        return (
            <div className={cn("block-segments-group", block.alignment)}>
                {block.segments?.map((segment, segIndex) => {
                    const isLast = segIndex === block.segments.length - 1;
                    const nextSegment = isLast ? null : block.segments[segIndex + 1];

                    return (
                        <React.Fragment key={`${blockKey}-${segIndex}`}>
                            <DiamondLeading segment={segment} palette={palette} />
                            <SegmentPreview segment={segment} palette={palette} />
                            {!isLast && (
                                <SegmentSeparator
                                    segment={segment}
                                    nextSegment={nextSegment}
                                    palette={palette}
                                />
                            )}
                            {isLast && segment.style === "diamond" && segment.trailing_diamond && (
                                <span
                                    className="diamond-separator"
                                    style={{ color: resolveColor(segment.background, palette) }}
                                >
                                    {segment.trailing_diamond}
                                </span>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        );
    }
);

BlockSegments.displayName = "BlockSegments";

/**
 * Group consecutive blocks into lines.
 * A new line starts when a block has newline: true (except the first block).
 */
function groupBlocksIntoLines(blocks: OmpBlockData[]): OmpBlockData[][] {
    const lines: OmpBlockData[][] = [];
    let currentLine: OmpBlockData[] = [];

    blocks.forEach((block, index) => {
        if (index > 0 && block.newline) {
            lines.push(currentLine);
            currentLine = [];
        }
        currentLine.push(block);
    });

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return lines;
}

export const OmpConfigPreview = memo(({ config, previewBackground }: OmpConfigPreviewProps) => {
    if (!config) {
        return null;
    }

    const getBgClass = () => {
        switch (previewBackground) {
            case "light":
                return "light-bg";
            case "dark":
                return "dark-bg";
            case "split":
                return "split-bg";
            default:
                return "dark-bg";
        }
    };

    const lines = config.blocks ? groupBlocksIntoLines(config.blocks) : [];

    return (
        <div className={cn("omp-config-preview", getBgClass())}>
            <div className="preview-container">
                {lines.map((lineBlocks, lineIndex) => {
                    const leftBlocks = lineBlocks.filter((b) => b.alignment === "left");
                    const rightBlocks = lineBlocks.filter((b) => b.alignment === "right");
                    const hasNewline = lineIndex > 0;

                    return (
                        <div
                            key={lineIndex}
                            className={cn("preview-line", { "has-newline": hasNewline })}
                        >
                            {leftBlocks.length > 0 && (
                                <div className="line-left">
                                    {leftBlocks.map((block, idx) => (
                                        <BlockSegments
                                            key={`l${lineIndex}-${idx}`}
                                            block={block}
                                            palette={config.palette}
                                            blockKey={`l${lineIndex}-${idx}`}
                                        />
                                    ))}
                                </div>
                            )}
                            {rightBlocks.length > 0 && (
                                <div className="line-right">
                                    {rightBlocks.map((block, idx) => (
                                        <BlockSegments
                                            key={`r${lineIndex}-${idx}`}
                                            block={block}
                                            palette={config.palette}
                                            blockKey={`r${lineIndex}-${idx}`}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            {!config.blocks || config.blocks.length === 0 ? (
                <div className="preview-empty">
                    <i className="fa fa-solid fa-terminal" />
                    <span>No blocks configured</span>
                </div>
            ) : null}
        </div>
    );
});

OmpConfigPreview.displayName = "OmpConfigPreview";
