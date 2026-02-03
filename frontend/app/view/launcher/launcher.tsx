// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import logoUrl from "@/app/asset/logo.svg?url";
import { atoms, globalStore, replaceBlock } from "@/app/store/global";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { isBlank, makeIconClass } from "@/util/util";
import clsx from "clsx";
import { atom, useAtom, useAtomValue } from "jotai";
import React, { useEffect, useLayoutEffect, useRef } from "react";

function sortByDisplayOrder(wmap: { [key: string]: WidgetConfigType } | null | undefined): WidgetConfigType[] {
    if (!wmap) return [];
    const wlist = Object.values(wmap);
    wlist.sort((a, b) => (a["display:order"] ?? 0) - (b["display:order"] ?? 0));
    return wlist;
}

type GridLayoutType = { columns: number; tileWidth: number; tileHeight: number; showLabel: boolean };

export class LauncherViewModel implements ViewModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewType = "launcher";
    viewIcon = atom("shapes");
    viewName = atom("Widget Launcher");
    viewComponent = LauncherView;
    noHeader = atom(true);
    inputRef = { current: null } as React.RefObject<HTMLInputElement>;
    searchTerm = atom("");
    selectedIndex = atom(0);
    containerSize = atom({ width: 0, height: 0 });
    gridLayout: GridLayoutType = null;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
    }

    filteredWidgetsAtom = atom((get) => {
        const searchTerm = get(this.searchTerm);
        const widgets = sortByDisplayOrder(get(atoms.fullConfigAtom)?.widgets || {});
        return widgets.filter(
            (widget) =>
                !widget["display:hidden"] &&
                (!searchTerm || widget.label?.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    });

    giveFocus(): boolean {
        if (this.inputRef.current) {
            this.inputRef.current.focus();
            return true;
        }
        return false;
    }

    keyDownHandler(e: WaveKeyboardEvent): boolean {
        if (this.gridLayout == null) {
            return;
        }
        const gridLayout = this.gridLayout;
        const filteredWidgets = globalStore.get(this.filteredWidgetsAtom);
        const selectedIndex = globalStore.get(this.selectedIndex);
        const rows = Math.ceil(filteredWidgets.length / gridLayout.columns);
        const currentRow = Math.floor(selectedIndex / gridLayout.columns);
        const currentCol = selectedIndex % gridLayout.columns;
        if (checkKeyPressed(e, "ArrowUp")) {
            if (filteredWidgets.length == 0) {
                return true;
            }
            if (currentRow > 0) {
                const newIndex = selectedIndex - gridLayout.columns;
                if (newIndex >= 0) {
                    globalStore.set(this.selectedIndex, newIndex);
                }
            }
            return true;
        }
        if (checkKeyPressed(e, "ArrowDown")) {
            if (filteredWidgets.length == 0) {
                return true;
            }
            if (currentRow < rows - 1) {
                const newIndex = selectedIndex + gridLayout.columns;
                if (newIndex < filteredWidgets.length) {
                    globalStore.set(this.selectedIndex, newIndex);
                }
            }
            return true;
        }
        if (checkKeyPressed(e, "ArrowLeft")) {
            if (filteredWidgets.length == 0) {
                return true;
            }
            if (currentCol > 0) {
                globalStore.set(this.selectedIndex, selectedIndex - 1);
            }
            return true;
        }
        if (checkKeyPressed(e, "ArrowRight")) {
            if (filteredWidgets.length == 0) {
                return true;
            }
            if (currentCol < gridLayout.columns - 1 && selectedIndex + 1 < filteredWidgets.length) {
                globalStore.set(this.selectedIndex, selectedIndex + 1);
            }
            return true;
        }
        if (checkKeyPressed(e, "Enter")) {
            if (filteredWidgets.length == 0) {
                return true;
            }
            if (filteredWidgets[selectedIndex]) {
                this.handleWidgetSelect(filteredWidgets[selectedIndex]);
            }
            return true;
        }
        if (checkKeyPressed(e, "Escape")) {
            globalStore.set(this.searchTerm, "");
            globalStore.set(this.selectedIndex, 0);
            return true;
        }
        return false;
    }

    async handleWidgetSelect(widget: WidgetConfigType) {
        try {
            await replaceBlock(this.blockId, widget.blockdef, true);
        } catch (error) {
            console.error("Error replacing block:", error);
        }
    }
}

function LauncherView({ blockId, model }: ViewComponentProps<LauncherViewModel>) {
    // Search and selection state
    const [searchTerm, setSearchTerm] = useAtom(model.searchTerm);
    const [selectedIndex, setSelectedIndex] = useAtom(model.selectedIndex);
    const filteredWidgets = useAtomValue(model.filteredWidgetsAtom);

    // Container measurement
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useAtom(model.containerSize);

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
    const GAP = 16;
    const LABEL_THRESHOLD = 60;
    const MARGIN_BOTTOM = 24;
    const MAX_TILE_SIZE = 120;

    const calculatedLogoWidth = containerSize.width * 0.3;
    const logoWidth = containerSize.width >= 100 ? Math.min(Math.max(calculatedLogoWidth, 100), 300) : 0;
    const showLogo = logoWidth >= 100;
    const availableHeight = containerSize.height - (showLogo ? logoWidth + MARGIN_BOTTOM : 0);

    // Determine optimal grid layout
    const gridLayout: GridLayoutType = React.useMemo(() => {
        if (containerSize.width === 0 || availableHeight <= 0 || filteredWidgets.length === 0) {
            return { columns: 1, tileWidth: 90, tileHeight: 90, showLabel: true };
        }
        let bestColumns = 1;
        let bestTileSize = 0;
        let bestTileWidth = 90;
        let bestTileHeight = 90;
        let showLabel = true;
        for (let cols = 1; cols <= filteredWidgets.length; cols++) {
            const rows = Math.ceil(filteredWidgets.length / cols);
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
    }, [containerSize, availableHeight, filteredWidgets.length]);
    model.gridLayout = gridLayout;

    const finalTileWidth = Math.min(gridLayout.tileWidth, MAX_TILE_SIZE);
    const finalTileHeight = gridLayout.showLabel ? Math.min(gridLayout.tileHeight, MAX_TILE_SIZE) : finalTileWidth;

    // Reset selection when search term changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [searchTerm]);

    return (
        <div ref={containerRef} className="w-full h-full p-4 box-border flex flex-col items-center justify-center">
            {/* Hidden input for search */}
            <input
                ref={model.inputRef}
                type="text"
                value={searchTerm}
                onKeyDown={keydownWrapper(model.keyDownHandler.bind(model))}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="sr-only dummy"
                aria-label="Search widgets"
            />

            {/* Logo */}
            {showLogo && (
                <div className="mb-6" style={{ width: logoWidth, maxWidth: 300 }}>
                    <img src={logoUrl} className="w-full h-auto filter grayscale brightness-70 opacity-70" alt="Logo" />
                </div>
            )}

            {/* Grid of widgets */}
            <div
                className="grid gap-4 justify-center"
                style={{
                    gridTemplateColumns: `repeat(${gridLayout.columns}, ${finalTileWidth}px)`,
                }}
            >
                {filteredWidgets.map((widget, index) => (
                    <div
                        key={index}
                        onClick={() => model.handleWidgetSelect(widget)}
                        title={widget.description || widget.label}
                        className={clsx(
                            "flex flex-col items-center justify-center cursor-pointer rounded-md p-2 text-center",
                            "transition-colors duration-150",
                            index === selectedIndex
                                ? "bg-white/20 text-white"
                                : "bg-white/5 hover:bg-white/10 text-secondary hover:text-white"
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
                ))}
            </div>

            {/* Search instructions */}
            <div className="mt-4 text-secondary text-xs">
                {filteredWidgets.length === 0 ? (
                    <span>No widgets found. Press Escape to clear search.</span>
                ) : (
                    <span>
                        {searchTerm == "" ? "Type to Filter" : "Searching " + '"' + searchTerm + '"'}, Enter to Launch,
                        {searchTerm == "" ? "Arrow Keys to Navigate" : null}
                    </span>
                )}
            </div>
        </div>
    );
}

export default LauncherView;
