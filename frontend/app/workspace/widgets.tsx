// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { atoms, createBlock, globalStore, isDev } from "@/store/global";
import { fireAndForget, isBlank, makeIconClass } from "@/util/util";
import {
    FloatingPortal,
    autoUpdate,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";

function sortByDisplayOrder(wmap: { [key: string]: WidgetConfigType }): WidgetConfigType[] {
    if (wmap == null) {
        return [];
    }
    const wlist = Object.values(wmap);
    wlist.sort((a, b) => {
        return (a["display:order"] ?? 0) - (b["display:order"] ?? 0);
    });
    return wlist;
}

async function handleWidgetSelect(widget: WidgetConfigType) {
    // Clone blockdef to avoid mutating the cached widget configuration
    const blockDef: BlockDef = {
        ...widget.blockdef,
        meta: { ...widget.blockdef?.meta },
    };

    // ===== Tab Base Directory Inheritance for Widgets =====
    // When launching widgets from the sidebar, inherit the tab's base directory.
    // This applies to:
    // - Terminal widgets: Sets cmd:cwd to tab:basedir
    // - File preview widgets: Sets default browse path to tab:basedir (if currently "~")
    //
    // This ensures all blocks within a tab share the same project context,
    // enabling project-centric workflows where users set tab = project root.
    const tabData = globalStore.get(atoms.activeTab);
    let tabBaseDir = tabData?.meta?.["tab:basedir"];

    // Pre-use validation: quickly validate tab basedir before using it
    if (tabBaseDir && tabBaseDir.trim() !== "") {
        try {
            const { validateTabBasedir } = await import("@/store/tab-basedir-validator");
            const validationResult = await validateTabBasedir(tabData.oid, tabBaseDir);
            if (!validationResult.valid) {
                console.warn(
                    `[widgets] Tab basedir validation failed at use-time: ${tabBaseDir} (${validationResult.reason}). Not using for widget.`
                );
                tabBaseDir = null; // Don't use invalid basedir
            }
        } catch (error) {
            console.error("[widgets] Failed to validate tab basedir:", error);
            tabBaseDir = null; // Don't use basedir on error
        }
    }

    if (tabBaseDir) {
        // For terminal blocks, set the working directory
        if (blockDef?.meta?.view === "term" && !blockDef.meta["cmd:cwd"]) {
            blockDef.meta["cmd:cwd"] = tabBaseDir;
        }
        // For file preview blocks, set the default file path (only if currently set to home)
        if (blockDef?.meta?.view === "preview" && blockDef.meta.file === "~") {
            blockDef.meta.file = tabBaseDir;
        }
    }

    createBlock(blockDef, widget.magnified);
}

const Widget = memo(({ widget, mode }: { widget: WidgetConfigType; mode: "normal" | "compact" | "supercompact" }) => {
    const [isTruncated, setIsTruncated] = useState(false);
    const labelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (mode === "normal" && labelRef.current) {
            const element = labelRef.current;
            setIsTruncated(element.scrollWidth > element.clientWidth);
        }
    }, [mode, widget.label]);

    const shouldDisableTooltip = mode !== "normal" ? false : !isTruncated;

    return (
        <Tooltip
            content={widget.description || widget.label}
            placement="left"
            disable={shouldDisableTooltip}
            divClassName={clsx(
                "flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer",
                mode === "supercompact" ? "text-sm" : "text-lg",
                widget["display:hidden"] && "hidden"
            )}
            divOnClick={() => handleWidgetSelect(widget)}
        >
            <div style={{ color: widget.color }}>
                <i className={makeIconClass(widget.icon, true, { defaultIcon: "browser" })}></i>
            </div>
            {mode === "normal" && !isBlank(widget.label) ? (
                <div
                    ref={labelRef}
                    className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis"
                >
                    {widget.label}
                </div>
            ) : null}
        </Tooltip>
    );
});

const SettingsFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
    }: {
        isOpen: boolean;
        onClose: () => void;
        referenceElement: HTMLElement;
    }) => {
        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "left-start",
            middleware: [offset(-2), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: referenceElement,
            },
        });

        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);

        if (!isOpen) return null;

        const menuItems = [
            {
                icon: "gear",
                label: "Settings",
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "waveconfig",
                        },
                    };
                    createBlock(blockDef, false, true);
                    onClose();
                },
            },
            {
                icon: "lightbulb",
                label: "Tips",
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "tips",
                        },
                    };
                    createBlock(blockDef, true, true);
                    onClose();
                },
            },
            {
                icon: "lock",
                label: "Secrets",
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "waveconfig",
                            file: "secrets",
                        },
                    };
                    createBlock(blockDef, false, true);
                    onClose();
                },
            },
            {
                icon: "circle-question",
                label: "Help",
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "help",
                        },
                    };
                    createBlock(blockDef);
                    onClose();
                },
            },
        ];

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl p-2 z-50"
                >
                    {menuItems.map((item, idx) => (
                        <div
                            key={idx}
                            className="flex items-center gap-3 px-3 py-2 rounded hover:bg-hoverbg cursor-pointer transition-colors text-secondary hover:text-white"
                            onClick={item.onClick}
                        >
                            <div className="text-lg w-5 flex justify-center">
                                <i className={makeIconClass(item.icon, false)}></i>
                            </div>
                            <div className="text-sm whitespace-nowrap">{item.label}</div>
                        </div>
                    ))}
                </div>
            </FloatingPortal>
        );
    }
);

SettingsFloatingWindow.displayName = "SettingsFloatingWindow";

const Widgets = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const hasCustomAIPresets = useAtomValue(atoms.hasCustomAIPresetsAtom);
    const [mode, setMode] = useState<"normal" | "compact" | "supercompact">("normal");
    const containerRef = useRef<HTMLDivElement>(null);
    const measurementRef = useRef<HTMLDivElement>(null);

    const widgetsMap = fullConfig?.widgets ?? {};
    const filteredWidgets = hasCustomAIPresets
        ? widgetsMap
        : Object.fromEntries(Object.entries(widgetsMap).filter(([key]) => key !== "defwidget@ai"));
    const widgets = sortByDisplayOrder(filteredWidgets);

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const settingsButtonRef = useRef<HTMLDivElement>(null);

    const checkModeNeeded = useCallback(() => {
        if (!containerRef.current || !measurementRef.current) return;

        const containerHeight = containerRef.current.clientHeight;
        const normalHeight = measurementRef.current.scrollHeight;
        const gracePeriod = 10;

        let newMode: "normal" | "compact" | "supercompact" = "normal";

        if (normalHeight > containerHeight - gracePeriod) {
            newMode = "compact";

            // Calculate total widget count for supercompact check
            const totalWidgets = (widgets?.length || 0) + 1;
            const minHeightPerWidget = 32;
            const requiredHeight = totalWidgets * minHeightPerWidget;

            if (requiredHeight > containerHeight) {
                newMode = "supercompact";
            }
        }

        if (newMode !== mode) {
            setMode(newMode);
        }
    }, [mode, widgets]);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            checkModeNeeded();
        });

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [checkModeNeeded]);

    useEffect(() => {
        checkModeNeeded();
    }, [widgets, checkModeNeeded]);

    const handleWidgetsBarContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const menu: ContextMenuItem[] = [
            {
                label: "Edit widgets.json",
                click: () => {
                    fireAndForget(async () => {
                        const blockDef: BlockDef = {
                            meta: {
                                view: "waveconfig",
                                file: "widgets.json",
                            },
                        };
                        await createBlock(blockDef, false, true);
                    });
                },
            },
        ];
        ContextMenuModel.showContextMenu(menu, e);
    };

    return (
        <>
            <div
                ref={containerRef}
                className="flex flex-col w-12 overflow-hidden py-1 -ml-1 select-none"
                onContextMenu={handleWidgetsBarContextMenu}
            >
                {mode === "supercompact" ? (
                    <>
                        <div className="grid grid-cols-2 gap-0 w-full">
                            {widgets?.map((data, idx) => (
                                <Widget key={`widget-${idx}`} widget={data} mode={mode} />
                            ))}
                        </div>
                        <div className="flex-grow" />
                        <div
                            ref={settingsButtonRef}
                            className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        >
                            <Tooltip content="Settings & Help" placement="left" disable={isSettingsOpen}>
                                <div>
                                    <i className={makeIconClass("gear", true)}></i>
                                </div>
                            </Tooltip>
                        </div>
                    </>
                ) : (
                    <>
                        {widgets?.map((data, idx) => (
                            <Widget key={`widget-${idx}`} widget={data} mode={mode} />
                        ))}
                        <div className="flex-grow" />
                        <div
                            ref={settingsButtonRef}
                            className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        >
                            <Tooltip content="Settings & Help" placement="left" disable={isSettingsOpen}>
                                <div>
                                    <i className={makeIconClass("gear", true)}></i>
                                </div>
                            </Tooltip>
                        </div>
                    </>
                )}
                {isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title="Running Wave Dev Build"
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
            {settingsButtonRef.current && (
                <SettingsFloatingWindow
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                    referenceElement={settingsButtonRef.current}
                />
            )}

            <div
                ref={measurementRef}
                className="flex flex-col w-12 py-1 -ml-1 select-none absolute -z-10 opacity-0 pointer-events-none"
            >
                {widgets?.map((data, idx) => (
                    <Widget key={`measurement-widget-${idx}`} widget={data} mode="normal" />
                ))}
                <div className="flex-grow" />
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass("gear", true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">settings</div>
                </div>
                {isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title="Running Wave Dev Build"
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
        </>
    );
});

export { Widgets };
