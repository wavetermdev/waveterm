// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { getApi } from "@/app/store/global";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { shouldIncludeWidgetForWorkspace } from "@/app/workspace/widgetfilter";
import { modalsModel } from "@/store/modalmodel";
import { fireAndForget, isBlank, makeIconClass } from "@/util/util";
import {
    autoUpdate,
    FloatingPortal,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";

export type WidgetsEnv = WaveEnvSubset<{
    isDev: WaveEnv["isDev"];
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        hasConfigErrors: WaveEnv["atoms"]["hasConfigErrors"];
        workspaceId: WaveEnv["atoms"]["workspaceId"];
        hasCustomAIPresetsAtom: WaveEnv["atoms"]["hasCustomAIPresetsAtom"];
    };
    createBlock: WaveEnv["createBlock"];
    showContextMenu: WaveEnv["showContextMenu"];
}>;

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

type WidgetPropsType = {
    widget: WidgetConfigType;
    mode: "normal" | "compact" | "supercompact";
    env: WidgetsEnv;
};

async function handleWidgetSelect(widget: WidgetConfigType, env: WidgetsEnv) {
    const blockDef = widget.blockdef;
    env.createBlock(blockDef, widget.magnified);
}

const Widget = memo(({ widget, mode, env }: WidgetPropsType) => {
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
            divOnClick={() => handleWidgetSelect(widget, env)}
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

function SettingsTooltipContent({ hasConfigErrors }: { hasConfigErrors: boolean }) {
    if (!hasConfigErrors) {
        return "Settings & Help";
    }
    return (
        <div className="flex flex-col p-1">
            <div className="mb-1">Settings &amp; Help</div>
            <div className="flex items-center gap-1 mt-0.5 text-error">
                <i className="fa fa-solid fa-circle-exclamation"></i>
                <span>Config Errors</span>
            </div>
        </div>
    );
}

type FloatingWindowPropsType = {
    isOpen: boolean;
    onClose: () => void;
    referenceElement: HTMLElement;
    hasConfigErrors?: boolean;
};

const SettingsFloatingWindow = memo(
    ({ isOpen, onClose, referenceElement, hasConfigErrors }: FloatingWindowPropsType) => {
        const env = useWaveEnv<WidgetsEnv>();
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
                hasError: hasConfigErrors,
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "waveconfig",
                        },
                    };
                    env.createBlock(blockDef, false, true);
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
                    env.createBlock(blockDef, true, true);
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
                    env.createBlock(blockDef, false, true);
                    onClose();
                },
            },
            {
                icon: "book-open",
                label: "Release Notes",
                onClick: () => {
                    modalsModel.pushModal("UpgradeOnboardingPatch", { isReleaseNotes: true });
                    onClose();
                },
            },
            {
                icon: "circle-question",
                label: "Help",
                onClick: () => {
                    getApi().openExternal("https://docs.waveterm.dev/?ref=app");
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
                            {item.hasError && (
                                <i className="fa fa-solid fa-circle-exclamation text-error text-[14px] ml-auto"></i>
                            )}
                        </div>
                    ))}
                </div>
            </FloatingPortal>
        );
    }
);

SettingsFloatingWindow.displayName = "SettingsFloatingWindow";

const Widgets = memo(() => {
    const env = useWaveEnv<WidgetsEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const hasConfigErrors = useAtomValue(env.atoms.hasConfigErrors);
    const workspaceId = useAtomValue(env.atoms.workspaceId);
    const [mode, setMode] = useState<"normal" | "compact" | "supercompact">("normal");
    const containerRef = useRef<HTMLDivElement>(null);
    const measurementRef = useRef<HTMLDivElement>(null);

    const widgetsMap = fullConfig?.widgets ?? {};
    const filteredWidgets = Object.fromEntries(
        Object.entries(widgetsMap).filter(([_key, widget]) => shouldIncludeWidgetForWorkspace(widget, workspaceId))
    );
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
                        await env.createBlock(blockDef, false, true);
                    });
                },
            },
        ];
        env.showContextMenu(menu, e);
    };

    return (
        <>
            <div
                ref={containerRef}
                className="flex flex-col w-12 overflow-hidden py-1 -ml-1 select-none shrink-0"
                onContextMenu={handleWidgetsBarContextMenu}
            >
                {mode === "supercompact" ? (
                    <>
                        <div className="grid grid-cols-2 gap-0 w-full">
                            {widgets?.map((data, idx) => (
                                <Widget key={`widget-${idx}`} widget={data} mode={mode} env={env} />
                            ))}
                        </div>
                        <div className="flex-grow" />
                        <div className="grid grid-cols-2 gap-0 w-full">
                            <div
                                ref={settingsButtonRef}
                                className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                            >
                                <Tooltip
                                    content={<SettingsTooltipContent hasConfigErrors={hasConfigErrors} />}
                                    placement="left"
                                    disable={isSettingsOpen}
                                >
                                    <div className="relative">
                                        <i className={makeIconClass("gear", true)}></i>
                                        {hasConfigErrors && (
                                            <i className="fa fa-solid fa-circle-exclamation text-error absolute top-0 right-0 text-[10px] pointer-events-none"></i>
                                        )}
                                    </div>
                                </Tooltip>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        {widgets?.map((data, idx) => (
                            <Widget key={`widget-${idx}`} widget={data} mode={mode} env={env} />
                        ))}
                        <div className="flex-grow" />
                        <div
                            ref={settingsButtonRef}
                            className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                        >
                            <Tooltip
                                content={<SettingsTooltipContent hasConfigErrors={hasConfigErrors} />}
                                placement="left"
                                disable={isSettingsOpen}
                            >
                                <div className="flex flex-col items-center w-full">
                                    <div className="relative">
                                        <i className={makeIconClass("gear", true)}></i>
                                        {hasConfigErrors && (
                                            <i
                                                className={`fa fa-solid fa-circle-exclamation text-error absolute top-0 right-[-4px] pointer-events-none ${mode === "normal" ? "text-[14px]" : "text-[12px]"}`}
                                            ></i>
                                        )}
                                    </div>
                                    {mode === "normal" && (
                                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                            settings
                                        </div>
                                    )}
                                </div>
                            </Tooltip>
                        </div>
                    </>
                )}
                {env.isDev() ? (
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
                    hasConfigErrors={hasConfigErrors}
                />
            )}

            <div
                ref={measurementRef}
                className="flex flex-col w-12 py-1 -ml-1 select-none absolute -z-10 opacity-0 pointer-events-none"
            >
                {widgets?.map((data, idx) => (
                    <Widget key={`measurement-widget-${idx}`} widget={data} mode="normal" env={env} />
                ))}
                <div className="flex-grow" />
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass("gear", true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">settings</div>
                </div>
                {env.isDev() ? (
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
