// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    type Placement,
    type VirtualElement,
    useFloating,
} from "@floating-ui/react";
import { cn } from "@/util/util";
import { memo, useEffect, useMemo, useRef, useState } from "react";

type PreviewContextMenuState = {
    items: ContextMenuItem[];
    x: number;
    y: number;
};

type PreviewContextMenuPanelProps = {
    items: ContextMenuItem[];
    point?: { x: number; y: number };
    referenceElement?: HTMLElement;
    placement: Placement;
    depth: number;
    parentPath: number[];
    openPath: number[];
    setOpenPath: (path: number[]) => void;
    closeMenu: () => void;
};

type PreviewContextMenuItemProps = {
    item: ContextMenuItem;
    itemPath: number[];
    depth: number;
    parentPath: number[];
    openPath: number[];
    setOpenPath: (path: number[]) => void;
    closeMenu: () => void;
};

let previewContextMenuListener: ((state: PreviewContextMenuState) => void) | null = null;
const previewContextMenuItemIds = new WeakMap<ContextMenuItem, string>();

function makeVirtualElement(x: number, y: number): VirtualElement {
    return {
        getBoundingClientRect() {
            return {
                x,
                y,
                width: 0,
                height: 0,
                top: y,
                right: x,
                bottom: y,
                left: x,
                toJSON: () => ({}),
            } as DOMRect;
        },
    };
}

function isPathOpen(openPath: number[], path: number[]): boolean {
    if (path.length > openPath.length) {
        return false;
    }
    return path.every((segment, index) => openPath[index] === segment);
}

function getVisibleItems(items: ContextMenuItem[]): ContextMenuItem[] {
    return items.filter((item) => item.visible !== false);
}

function activateItem(item: ContextMenuItem, closeMenu: () => void): void {
    closeMenu();
    item.click?.();
}

function getPreviewContextMenuItemId(item: ContextMenuItem): string {
    const existingId = previewContextMenuItemIds.get(item);
    if (existingId != null) {
        return existingId;
    }
    const newId = crypto.randomUUID();
    previewContextMenuItemIds.set(item, newId);
    return newId;
}

const PreviewContextMenuItem = memo(
    ({ item, itemPath, depth, parentPath, openPath, setOpenPath, closeMenu }: PreviewContextMenuItemProps) => {
        const rowRef = useRef<HTMLDivElement>(null);
        const submenuItems = getVisibleItems(item.submenu ?? []);
        const hasSubmenu = submenuItems.length > 0;
        const isDisabled = item.enabled === false;
        const isHeader = item.type === "header";
        const isSeparator = item.type === "separator";
        const isChecked = item.type === "checkbox" || item.type === "radio" ? item.checked === true : false;
        const isSubmenuOpen = hasSubmenu && isPathOpen(openPath, itemPath);

        if (isSeparator) {
            return <div className="my-1 border-t border-border" role="separator" />;
        }

        const handleMouseEnter = () => {
            if (hasSubmenu) {
                setOpenPath(itemPath);
                return;
            }
            setOpenPath(parentPath);
        };

        const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
            e.stopPropagation();
            if (isDisabled || isHeader) {
                return;
            }
            if (hasSubmenu) {
                setOpenPath(itemPath);
                return;
            }
            activateItem(item, closeMenu);
        };

        return (
            <>
                <div
                    ref={rowRef}
                    role={item.type === "checkbox" ? "menuitemcheckbox" : item.type === "radio" ? "menuitemradio" : "menuitem"}
                    aria-disabled={isDisabled}
                    aria-checked={item.type === "checkbox" || item.type === "radio" ? isChecked : undefined}
                    data-context-menu-item={item.label ?? item.type ?? "item"}
                    className={cn(
                        "flex min-h-8 items-center gap-3 px-3 text-sm text-foreground select-none",
                        !isHeader && "cursor-pointer",
                        isHeader && "px-3 py-1 text-xxs uppercase tracking-[0.08em] text-muted",
                        !isHeader && !isDisabled && "hover:bg-hoverbg",
                        isDisabled && "text-muted",
                        isSubmenuOpen && "bg-hoverbg"
                    )}
                    onMouseEnter={handleMouseEnter}
                    onClick={handleClick}
                >
                    {isHeader ? (
                        <span className="truncate">{item.label}</span>
                    ) : (
                        <>
                            <span className="flex w-4 items-center justify-center text-center text-xs">
                                {isChecked ? <i className="fa fa-check" /> : null}
                            </span>
                            <div className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate">{item.label}</span>
                                {item.sublabel ? <span className="truncate text-xxs text-muted">{item.sublabel}</span> : null}
                            </div>
                            {hasSubmenu ? (
                                <span className="ml-3 text-xs text-muted">
                                    <i className="fa fa-chevron-right" />
                                </span>
                            ) : null}
                        </>
                    )}
                </div>
                {hasSubmenu && isSubmenuOpen && rowRef.current != null ? (
                    <PreviewContextMenuPanel
                        items={submenuItems}
                        referenceElement={rowRef.current}
                        placement="right-start"
                        depth={depth + 1}
                        parentPath={itemPath}
                        openPath={openPath}
                        setOpenPath={setOpenPath}
                        closeMenu={closeMenu}
                    />
                ) : null}
            </>
        );
    }
);

PreviewContextMenuItem.displayName = "PreviewContextMenuItem";

const PreviewContextMenuPanel = memo(
    ({ items, point, referenceElement, placement, depth, parentPath, openPath, setOpenPath, closeMenu }: PreviewContextMenuPanelProps) => {
        const visibleItems = getVisibleItems(items);
        const virtualReference = useMemo(() => {
            if (point == null) {
                return null;
            }
            return makeVirtualElement(point.x, point.y);
        }, [point]);
        const { refs, floatingStyles } = useFloating({
            open: true,
            placement,
            strategy: "fixed",
            whileElementsMounted: autoUpdate,
            middleware: [
                offset(depth === 0 ? 4 : { mainAxis: -4, crossAxis: -4 }),
                flip({ padding: 8 }),
                shift({ padding: 8 }),
            ],
        });

        useEffect(() => {
            if (referenceElement != null) {
                refs.setReference(referenceElement);
                return;
            }
            refs.setPositionReference(virtualReference);
        }, [referenceElement, refs, virtualReference]);

        if (visibleItems.length === 0) {
            return null;
        }

        return (
            <div
                ref={refs.setFloating}
                style={floatingStyles}
                className="min-w-[220px] overflow-hidden rounded-md border border-border bg-modalbg py-1 shadow-2xl"
                role="menu"
            >
                {visibleItems.map((item, index) => (
                    <PreviewContextMenuItem
                        key={getPreviewContextMenuItemId(item)}
                        item={item}
                        itemPath={[...parentPath, index]}
                        depth={depth}
                        parentPath={parentPath}
                        openPath={openPath}
                        setOpenPath={setOpenPath}
                        closeMenu={closeMenu}
                    />
                ))}
            </div>
        );
    }
);

PreviewContextMenuPanel.displayName = "PreviewContextMenuPanel";

export function showPreviewContextMenu(menu: ContextMenuItem[], e: React.MouseEvent): void {
    e.stopPropagation();
    e.preventDefault();
    previewContextMenuListener?.({
        items: menu,
        x: e.clientX,
        y: e.clientY,
    });
}

export const PreviewContextMenu = memo(() => {
    const [menuState, setMenuState] = useState<PreviewContextMenuState | null>(null);
    const [openPath, setOpenPath] = useState<number[]>([]);
    const portalRef = useRef<HTMLDivElement>(null);

    const closeMenu = () => {
        setMenuState(null);
        setOpenPath([]);
    };

    useEffect(() => {
        previewContextMenuListener = (state) => {
            setMenuState(state);
            setOpenPath([]);
        };
        return () => {
            previewContextMenuListener = null;
        };
    }, []);

    useEffect(() => {
        if (menuState == null) {
            return;
        }

        const handlePointerDown = (event: PointerEvent) => {
            if (portalRef.current?.contains(event.target as Node)) {
                return;
            }
            closeMenu();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closeMenu();
            }
        };

        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown);
        window.addEventListener("blur", closeMenu);
        window.addEventListener("resize", closeMenu);
        window.addEventListener("scroll", closeMenu, true);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("blur", closeMenu);
            window.removeEventListener("resize", closeMenu);
            window.removeEventListener("scroll", closeMenu, true);
        };
    }, [menuState]);

    if (menuState == null) {
        return null;
    }

    return (
        <FloatingPortal>
            <div ref={portalRef}>
                <PreviewContextMenuPanel
                    items={menuState.items}
                    point={{ x: menuState.x, y: menuState.y }}
                    placement="bottom-start"
                    depth={0}
                    parentPath={[]}
                    openPath={openPath}
                    setOpenPath={setOpenPath}
                    closeMenu={closeMenu}
                />
            </div>
        </FloatingPortal>
    );
});

PreviewContextMenu.displayName = "PreviewContextMenu";
