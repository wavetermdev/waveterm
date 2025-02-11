// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg"; // Your SVG logo
import { atoms, replaceBlock } from "@/app/store/global";
import { isBlank, makeIconClass } from "@/util/util";
import clsx from "clsx";
import { atom, useAtomValue } from "jotai";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";

function sortByDisplayOrder(wmap: { [key: string]: WidgetConfigType } | null | undefined): WidgetConfigType[] {
    if (!wmap) return [];
    const wlist = Object.values(wmap);
    wlist.sort((a, b) => (a["display:order"] ?? 0) - (b["display:order"] ?? 0));
    return wlist;
}

export class LauncherViewModel implements ViewModel {
    viewType = "launcher";
    viewIcon = atom("shapes");
    viewName = atom("Widget Launcher");
    viewComponent = LauncherView;
    noHeader = atom(true);
}

const LauncherView: React.FC<ViewComponentProps<LauncherViewModel>> = ({ blockId, model }) => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const widgetMap = fullConfig?.widgets || {};
    const widgets = sortByDisplayOrder(widgetMap);
    const widgetCount = widgets.length;

    // Container measurement
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                setContainerSize({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height,
                });
            }
        });
        resizeObserver.observe(containerRef.current);
        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    // Layout constants
    const GAP = 16; // gap between grid items (px)
    const LABEL_THRESHOLD = 60; // if tile height is below this, hide the label
    const MARGIN_BOTTOM = 24; // space below the logo
    const MAX_TILE_SIZE = 120; // max widget box size

    // Dynamic logo sizing: 30% of container width, clamped between 100 and 300.
    const calculatedLogoWidth = containerSize.width * 0.3;
    const logoWidth = containerSize.width >= 100 ? Math.min(Math.max(calculatedLogoWidth, 100), 300) : 0;
    const showLogo = logoWidth >= 100;

    // Available height for the grid (after subtracting logo space)
    const availableHeight = containerSize.height - (showLogo ? logoWidth + MARGIN_BOTTOM : 0);

    // Determine optimal grid layout based on container dimensions and widget count.
    const gridLayout = useMemo(() => {
        if (containerSize.width === 0 || availableHeight <= 0 || widgetCount === 0) {
            return { columns: 1, tileWidth: 90, tileHeight: 90, showLabel: true };
        }
        let bestColumns = 1;
        let bestTileSize = 0;
        let bestTileWidth = 90;
        let bestTileHeight = 90;
        let showLabel = true;
        for (let cols = 1; cols <= widgetCount; cols++) {
            const rows = Math.ceil(widgetCount / cols);
            const tileWidth = (containerSize.width - (cols - 1) * GAP) / cols;
            const tileHeight = (availableHeight - (rows - 1) * GAP) / rows;
            const currentTileSize = Math.min(tileWidth, tileHeight);
            if (currentTileSize > bestTileSize) {
                bestTileSize = currentTileSize;
                bestColumns = cols;
                bestTileWidth = tileWidth;
                bestTileHeight = tileHeight;
                showLabel = tileHeight >= LABEL_THRESHOLD;
            }
        }
        return { columns: bestColumns, tileWidth: bestTileWidth, tileHeight: bestTileHeight, showLabel };
    }, [containerSize, availableHeight, widgetCount]);

    // Clamp tile sizes so they don't exceed MAX_TILE_SIZE.
    const finalTileWidth = Math.min(gridLayout.tileWidth, MAX_TILE_SIZE);
    const finalTileHeight = gridLayout.showLabel ? Math.min(gridLayout.tileHeight, MAX_TILE_SIZE) : finalTileWidth;

    const handleWidgetSelect = async (widget: WidgetConfigType) => {
        try {
            await replaceBlock(blockId, widget.blockdef);
        } catch (error) {
            console.error("Error replacing block:", error);
        }
    };

    return (
        <div ref={containerRef} className="w-full h-full p-4 box-border flex flex-col items-center justify-center">
            {/* Logo wrapped in a div for proper scaling */}
            {showLogo && (
                <div className="mb-6" style={{ width: logoWidth, maxWidth: 300 }}>
                    <Logo className="w-full h-auto filter grayscale brightness-90 opacity-90" />
                </div>
            )}

            {/* Grid of widgets */}
            <div
                className="grid gap-4 justify-center"
                style={{
                    gridTemplateColumns: `repeat(${gridLayout.columns}, ${finalTileWidth}px)`,
                }}
            >
                {widgets.map((widget, index) => {
                    if (widget["display:hidden"]) return null;
                    return (
                        <div
                            key={index}
                            onClick={() => handleWidgetSelect(widget)}
                            title={widget.description || widget.label}
                            className={clsx(
                                "flex flex-col items-center justify-center cursor-pointer rounded-md p-2 text-center",
                                "bg-white/5 hover:bg-white/10",
                                "text-secondary hover:text-white"
                            )}
                            style={{
                                width: finalTileWidth,
                                height: finalTileHeight,
                            }}
                        >
                            <div style={{ color: widget.color }}>
                                <i
                                    className={makeIconClass(widget.icon, true, {
                                        defaultIcon: "browser",
                                    })}
                                />
                            </div>
                            {gridLayout.showLabel && !isBlank(widget.label) && (
                                <div className="mt-1 w-full text-[11px] leading-4 overflow-hidden text-ellipsis whitespace-nowrap">
                                    {widget.label}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default LauncherView;
