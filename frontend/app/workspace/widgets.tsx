// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { shouldIncludeWidgetForWorkspace } from "@/app/workspace/widgetfilter";
import { atoms, createBlock, getApi, isDev } from "@/store/global";
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

type WidgetMode = "normal" | "compact" | "supercompact";
type CreateWidgetBlockFn = (blockDef: BlockDef, magnified?: boolean, ephemeral?: boolean) => void | Promise<void>;
type LoadWidgetAppsFn = () => Promise<AppInfo[]>;

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

export function getWidgetsMode(containerHeight: number, normalHeight: number, widgetCount: number): WidgetMode {
    const gracePeriod = 10;
    if (normalHeight <= containerHeight - gracePeriod) {
        return "normal";
    }
    const minHeightPerWidget = 32;
    const requiredHeight = widgetCount * minHeightPerWidget;
    if (requiredHeight > containerHeight) {
        return "supercompact";
    }
    return "compact";
}

const Widget = memo(
    ({
        widget,
        mode,
        onSelectWidget,
    }: {
        widget: WidgetConfigType;
        mode: WidgetMode;
        onSelectWidget: (widget: WidgetConfigType) => void;
    }) => {
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
                divOnClick={() => onSelectWidget(widget)}
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
    }
);

function calculateGridSize(appCount: number): number {
    if (appCount <= 4) return 2;
    if (appCount <= 9) return 3;
    if (appCount <= 16) return 4;
    if (appCount <= 25) return 5;
    return 6;
}

const AppsFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
        loadApps,
        onCreateBlock,
        onOpenBuilder,
    }: {
        isOpen: boolean;
        onClose: () => void;
        referenceElement: HTMLElement;
        loadApps: LoadWidgetAppsFn;
        onCreateBlock: CreateWidgetBlockFn;
        onOpenBuilder: () => void;
    }) => {
        const [apps, setApps] = useState<AppInfo[]>([]);
        const [loading, setLoading] = useState(true);

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
        const handleOpenBuilder = useCallback(() => {
            onOpenBuilder();
            onClose();
        }, [onClose, onOpenBuilder]);

        useEffect(() => {
            if (!isOpen) return;

            const fetchApps = async () => {
                setLoading(true);
                try {
                    setApps(await loadApps());
                } catch (error) {
                    console.error("Failed to fetch apps:", error);
                    setApps([]);
                } finally {
                    setLoading(false);
                }
            };

            fetchApps();
        }, [isOpen, loadApps]);

        if (!isOpen) return null;

        const gridSize = calculateGridSize(apps.length);

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl z-50 overflow-hidden"
                >
                    <div className="p-4">
                        {loading ? (
                            <div className="flex items-center justify-center p-8">
                                <i className="fa fa-solid fa-spinner fa-spin text-2xl text-muted"></i>
                            </div>
                        ) : apps.length === 0 ? (
                            <div className="text-muted text-sm p-4 text-center">No local apps found</div>
                        ) : (
                            <div
                                className="grid gap-3"
                                style={{
                                    gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                                    maxWidth: `${gridSize * 80}px`,
                                }}
                            >
                                {apps.map((app) => {
                                    const appMeta = app.manifest?.appmeta;
                                    const displayName = app.appid.replace(/^local\//, "");
                                    const icon = appMeta?.icon || "cube";
                                    const iconColor = appMeta?.iconcolor || "white";

                                    return (
                                        <div
                                            key={app.appid}
                                            className="flex flex-col items-center justify-center p-2 rounded hover:bg-hoverbg cursor-pointer transition-colors"
                                            onClick={() => {
                                                const blockDef: BlockDef = {
                                                    meta: {
                                                        view: "tsunami",
                                                        controller: "tsunami",
                                                        "tsunami:appid": app.appid,
                                                    },
                                                };
                                                onCreateBlock(blockDef);
                                                onClose();
                                            }}
                                        >
                                            <div style={{ color: iconColor }} className="text-3xl mb-1">
                                                <i className={makeIconClass(icon, false)}></i>
                                            </div>
                                            <div className="text-xxs text-center text-secondary break-words w-full px-1">
                                                {displayName}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        className="w-full px-4 py-2 border-t border-border text-xs text-secondary text-center hover:bg-hoverbg hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-2"
                        onClick={handleOpenBuilder}
                    >
                        <i className="fa fa-solid fa-hammer"></i>
                        Build/Edit Apps
                    </button>
                </div>
            </FloatingPortal>
        );
    }
);

const SettingsFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
        onCreateBlock,
    }: {
        isOpen: boolean;
        onClose: () => void;
        referenceElement: HTMLElement;
        onCreateBlock: CreateWidgetBlockFn;
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
                    onCreateBlock(blockDef, false, true);
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
                    onCreateBlock(blockDef, true, true);
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
                    onCreateBlock(blockDef, false, true);
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
                    onCreateBlock(blockDef);
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

type WidgetsVProps = {
    widgets: WidgetConfigType[];
    showAppsButton: boolean;
    showDevIndicator?: boolean;
    loadApps: LoadWidgetAppsFn;
    onCreateBlock: CreateWidgetBlockFn;
    onOpenBuilder: () => void;
    onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
    rootClassName?: string;
    className?: string;
};

const WidgetsV = memo(
    ({
        widgets,
        showAppsButton,
        showDevIndicator = false,
        loadApps,
        onCreateBlock,
        onOpenBuilder,
        onContextMenu,
        rootClassName,
        className,
    }: WidgetsVProps) => {
        const [mode, setMode] = useState<WidgetMode>("normal");
        const containerRef = useRef<HTMLDivElement>(null);
        const measurementRef = useRef<HTMLDivElement>(null);

        const [isAppsOpen, setIsAppsOpen] = useState(false);
        const appsButtonRef = useRef<HTMLDivElement>(null);
        const [isSettingsOpen, setIsSettingsOpen] = useState(false);
        const settingsButtonRef = useRef<HTMLDivElement>(null);
        const totalWidgetButtons = widgets.length + 1 + (showAppsButton ? 1 : 0) + (showDevIndicator ? 1 : 0);

        const handleWidgetSelect = useCallback(
            (widget: WidgetConfigType) => {
                onCreateBlock(widget.blockdef, widget.magnified);
            },
            [onCreateBlock]
        );

        const checkModeNeeded = useCallback(() => {
            if (!containerRef.current || !measurementRef.current) return;

            const containerHeight = containerRef.current.clientHeight;
            const normalHeight = measurementRef.current.scrollHeight;
            const newMode = getWidgetsMode(containerHeight, normalHeight, totalWidgetButtons);

            if (newMode !== mode) {
                setMode(newMode);
            }
        }, [mode, totalWidgetButtons]);

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

        return (
            <div className={clsx("relative", rootClassName)}>
                <div
                    ref={containerRef}
                    className={clsx("flex flex-col w-12 overflow-hidden py-1 -ml-1 select-none", className)}
                    onContextMenu={onContextMenu}
                >
                    {mode === "supercompact" ? (
                        <>
                            <div className="grid grid-cols-2 gap-0 w-full">
                                {widgets?.map((data, idx) => (
                                    <Widget
                                        key={`widget-${idx}`}
                                        widget={data}
                                        mode={mode}
                                        onSelectWidget={handleWidgetSelect}
                                    />
                                ))}
                            </div>
                            <div className="flex-grow" />
                            <div className="grid grid-cols-2 gap-0 w-full">
                                {showAppsButton ? (
                                    <div
                                        ref={appsButtonRef}
                                        className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                        onClick={() => setIsAppsOpen(!isAppsOpen)}
                                    >
                                        <Tooltip content="Local WaveApps" placement="left" disable={isAppsOpen}>
                                            <div>
                                                <i className={makeIconClass("cube", true)}></i>
                                            </div>
                                        </Tooltip>
                                    </div>
                                ) : null}
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
                            </div>
                        </>
                    ) : (
                        <>
                            {widgets?.map((data, idx) => (
                                <Widget
                                    key={`widget-${idx}`}
                                    widget={data}
                                    mode={mode}
                                    onSelectWidget={handleWidgetSelect}
                                />
                            ))}
                            <div className="flex-grow" />
                            {showAppsButton ? (
                                <div
                                    ref={appsButtonRef}
                                    className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                    onClick={() => setIsAppsOpen(!isAppsOpen)}
                                >
                                    <Tooltip content="Local WaveApps" placement="left" disable={isAppsOpen}>
                                        <div className="flex flex-col items-center w-full">
                                            <div>
                                                <i className={makeIconClass("cube", true)}></i>
                                            </div>
                                            {mode === "normal" && (
                                                <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                                    apps
                                                </div>
                                            )}
                                        </div>
                                    </Tooltip>
                                </div>
                            ) : null}
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
                    {showDevIndicator ? (
                        <div
                            className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                            title="Running Wave Dev Build"
                        >
                            <i className="fa fa-brands fa-dev fa-fw" />
                        </div>
                    ) : null}
                </div>
                {showAppsButton && appsButtonRef.current && (
                    <AppsFloatingWindow
                        isOpen={isAppsOpen}
                        onClose={() => setIsAppsOpen(false)}
                        referenceElement={appsButtonRef.current}
                        loadApps={loadApps}
                        onCreateBlock={onCreateBlock}
                        onOpenBuilder={onOpenBuilder}
                    />
                )}
                {settingsButtonRef.current && (
                    <SettingsFloatingWindow
                        isOpen={isSettingsOpen}
                        onClose={() => setIsSettingsOpen(false)}
                        referenceElement={settingsButtonRef.current}
                        onCreateBlock={onCreateBlock}
                    />
                )}

                <div
                    ref={measurementRef}
                    className="flex flex-col w-12 py-1 -ml-1 select-none absolute -z-10 opacity-0 pointer-events-none"
                >
                    {widgets?.map((data, idx) => (
                        <Widget
                            key={`measurement-widget-${idx}`}
                            widget={data}
                            mode="normal"
                            onSelectWidget={handleWidgetSelect}
                        />
                    ))}
                    <div className="flex-grow" />
                    <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                        <div>
                            <i className={makeIconClass("gear", true)}></i>
                        </div>
                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center">settings</div>
                    </div>
                    {showAppsButton ? (
                        <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                            <div>
                                <i className={makeIconClass("cube", true)}></i>
                            </div>
                            <div className="text-xxs mt-0.5 w-full px-0.5 text-center">apps</div>
                        </div>
                    ) : null}
                    {showDevIndicator ? (
                        <div
                            className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                            title="Running Wave Dev Build"
                        >
                            <i className="fa fa-brands fa-dev fa-fw" />
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }
);

WidgetsV.displayName = "WidgetsV";

const Widgets = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const workspace = useAtomValue(atoms.workspace);
    const hasCustomAIPresets = useAtomValue(atoms.hasCustomAIPresetsAtom);

    const featureWaveAppBuilder = fullConfig?.settings?.["feature:waveappbuilder"] ?? false;
    const widgetsMap = fullConfig?.widgets ?? {};
    const filteredWidgets = Object.fromEntries(
        Object.entries(widgetsMap).filter(([key, widget]) => {
            if (!hasCustomAIPresets && key === "defwidget@ai") {
                return false;
            }
            return shouldIncludeWidgetForWorkspace(widget, workspace?.oid);
        })
    );
    const widgets = sortByDisplayOrder(filteredWidgets);
    const showAppsButton = isDev() || featureWaveAppBuilder;

    const loadApps = useCallback(async () => {
        const allApps = await RpcApi.ListAllAppsCommand(TabRpcClient);
        return allApps
            .filter((app) => !app.appid.startsWith("draft/"))
            .sort((a, b) => {
                const aName = a.appid.replace(/^local\//, "");
                const bName = b.appid.replace(/^local\//, "");
                return aName.localeCompare(bName);
            });
    }, []);

    const handleWidgetsBarContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
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
        ContextMenuModel.getInstance().showContextMenu(menu, e);
    }, []);

    return (
        <WidgetsV
            widgets={widgets}
            showAppsButton={showAppsButton}
            showDevIndicator={isDev()}
            loadApps={loadApps}
            onCreateBlock={createBlock}
            onOpenBuilder={() => getApi().openBuilder(null)}
            onContextMenu={handleWidgetsBarContextMenu}
        />
    );
});

export { Widgets, WidgetsV };
