// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * OMP Config Preview
 *
 * Displays a visual preview of the OMP configuration with color swatches.
 */

import { cn } from "@/util/util";
import { memo } from "react";

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
 * Get segment type icon
 */
function getSegmentIcon(type: string): string {
    const iconMap: Record<string, string> = {
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
        node: "fa-node-js",
        python: "fa-python",
        go: "fa-golang",
        rust: "fa-rust",
        java: "fa-java",
        ruby: "fa-gem",
        php: "fa-php",
        dotnet: "fa-microsoft",
        kubectl: "fa-cloud",
        aws: "fa-aws",
        az: "fa-microsoft",
        gcp: "fa-google",
        docker: "fa-docker",
        terraform: "fa-cubes",
        executiontime: "fa-stopwatch",
        status: "fa-circle-check",
    };

    return iconMap[type] || "fa-puzzle-piece";
}

/**
 * Segment preview component
 */
const SegmentPreview = memo(
    ({
        segment,
        palette,
        isLast,
    }: {
        segment: OmpSegmentData;
        palette?: Record<string, string>;
        isLast: boolean;
    }) => {
        const bg = resolveColor(segment.background, palette);
        const fg = resolveColor(segment.foreground, palette);

        // Determine if background is transparent
        const isTransparent = bg === "transparent" || !bg;

        return (
            <div
                className={cn("segment-preview", segment.style, { transparent: isTransparent })}
                style={{
                    backgroundColor: isTransparent ? undefined : bg,
                    color: fg,
                }}
                title={`${segment.type} (${segment.style})`}
            >
                <span className="segment-content">
                    <i className={`fa fa-solid ${getSegmentIcon(segment.type)}`} />
                    <span className="segment-type">{segment.type}</span>
                </span>
                {segment.style === "powerline" && !isLast && (
                    <span className="powerline-arrow" style={{ color: bg }}>
                        &#xe0b0;
                    </span>
                )}
            </div>
        );
    }
);

SegmentPreview.displayName = "SegmentPreview";

/**
 * Block preview component
 */
const BlockPreview = memo(
    ({
        block,
        palette,
        blockIndex,
    }: {
        block: OmpBlockData;
        palette?: Record<string, string>;
        blockIndex: number;
    }) => {
        return (
            <div className={cn("block-preview", block.type, block.alignment)}>
                <div className="block-label">
                    <span className="block-type">{block.type}</span>
                    <span className="block-alignment">{block.alignment}</span>
                </div>
                <div className="block-segments">
                    {block.segments?.map((segment, segIndex) => (
                        <SegmentPreview
                            key={`${blockIndex}-${segIndex}`}
                            segment={segment}
                            palette={palette}
                            isLast={segIndex === block.segments.length - 1}
                        />
                    ))}
                </div>
            </div>
        );
    }
);

BlockPreview.displayName = "BlockPreview";

export const OmpConfigPreview = memo(({ config, previewBackground }: OmpConfigPreviewProps) => {
    if (!config) {
        return null;
    }

    // Determine background color based on preview mode
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

    return (
        <div className={cn("omp-config-preview", getBgClass())}>
            <div className="preview-container">
                {config.blocks?.map((block, blockIndex) => (
                    <BlockPreview
                        key={blockIndex}
                        block={block}
                        palette={config.palette}
                        blockIndex={blockIndex}
                    />
                ))}
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

export { OmpConfigPreview };
