// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { NotificationPopover } from "@/app/notification/notificationpopover";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, createBlock, getApi, isDev } from "@/store/global";
import { fireAndForget, isBlank, makeIconClass } from "@/util/util";
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
    const blockDef = widget.blockdef;
    createBlock(blockDef, widget.magnified);
}

const Widget = memo(({ widget, compact = false }: { widget: WidgetConfigType; compact?: boolean }) => {
    const [isTruncated, setIsTruncated] = useState(false);
    const labelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!compact && labelRef.current) {
            const element = labelRef.current;
            setIsTruncated(element.scrollWidth > element.clientWidth);
        }
    }, [compact, widget.label]);

    const shouldDisableTooltip = compact ? false : !isTruncated;

    return (
        <Tooltip
            content={widget.description || widget.label}
            placement="left"
            disable={shouldDisableTooltip}
            divClassName={clsx(
                "flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer",
                widget["display:hidden"] && "hidden"
            )}
            divOnClick={() => handleWidgetSelect(widget)}
        >
            <div style={{ color: widget.color }}>
                <i className={makeIconClass(widget.icon, true, { defaultIcon: "browser" })}></i>
            </div>
            {!compact && !isBlank(widget.label) ? (
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

const Widgets = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const [isCompact, setIsCompact] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const measurementRef = useRef<HTMLDivElement>(null);

    const helpWidget: WidgetConfigType = {
        icon: "circle-question",
        label: "help",
        blockdef: {
            meta: {
                view: "help",
            },
        },
    };
    const tipsWidget: WidgetConfigType = {
        icon: "lightbulb",
        label: "tips",
        blockdef: {
            meta: {
                view: "tips",
            },
        },
    };
    const showHelp = fullConfig?.settings?.["widget:showhelp"] ?? true;
    const widgets = sortByDisplayOrder(fullConfig?.widgets);

    const checkIfCompactNeeded = useCallback(() => {
        if (!containerRef.current || !measurementRef.current) return;

        const containerHeight = containerRef.current.clientHeight;
        const measurementHeight = measurementRef.current.scrollHeight;
        const gracePeriod = 10;

        const shouldBeCompact = measurementHeight > containerHeight - gracePeriod;

        if (shouldBeCompact !== isCompact) {
            setIsCompact(shouldBeCompact);
        }
    }, [isCompact]);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            checkIfCompactNeeded();
        });

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [checkIfCompactNeeded]);

    useEffect(() => {
        checkIfCompactNeeded();
    }, [widgets, showHelp, checkIfCompactNeeded]);

    const handleWidgetsBarContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const menu: ContextMenuItem[] = [
            {
                label: "Edit widgets.json",
                click: () => {
                    fireAndForget(async () => {
                        const path = `${getApi().getConfigDir()}/widgets.json`;
                        const blockDef: BlockDef = {
                            meta: { view: "preview", file: path },
                        };
                        await createBlock(blockDef, false, true);
                    });
                },
            },
            {
                label: "Show Help Widgets",
                submenu: [
                    {
                        label: "On",
                        type: "checkbox",
                        checked: showHelp,
                        click: () => {
                            fireAndForget(async () => {
                                await RpcApi.SetConfigCommand(TabRpcClient, { "widget:showhelp": true });
                            });
                        },
                    },
                    {
                        label: "Off",
                        type: "checkbox",
                        checked: !showHelp,
                        click: () => {
                            fireAndForget(async () => {
                                await RpcApi.SetConfigCommand(TabRpcClient, { "widget:showhelp": false });
                            });
                        },
                    },
                ],
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
                {widgets?.map((data, idx) => <Widget key={`widget-${idx}`} widget={data} compact={isCompact} />)}
                <div className="flex-grow" />
                {showHelp ? (
                    <>
                        <Widget key="tips" widget={tipsWidget} compact={isCompact} />
                        <Widget key="help" widget={helpWidget} compact={isCompact} />
                    </>
                ) : null}
                {isDev() ? <NotificationPopover /> : null}
            </div>

            <div
                ref={measurementRef}
                className="flex flex-col w-12 py-1 -ml-1 select-none absolute -z-10 opacity-0 pointer-events-none"
            >
                {widgets?.map((data, idx) => (
                    <Widget key={`measurement-widget-${idx}`} widget={data} compact={false} />
                ))}
                <div className="flex-grow" />
                {showHelp ? (
                    <>
                        <Widget key="measurement-tips" widget={tipsWidget} compact={false} />
                        <Widget key="measurement-help" widget={helpWidget} compact={false} />
                    </>
                ) : null}
                {isDev() ? <NotificationPopover /> : null}
            </div>
        </>
    );
});

export { Widgets };
