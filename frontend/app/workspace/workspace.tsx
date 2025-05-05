// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { NotificationPopover } from "@/app/notification/notificationpopover";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { atoms, createBlock, getApi, isDev } from "@/store/global";
import { fireAndForget, isBlank, makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo } from "react";

const iconRegex = /^[a-z0-9-]+$/;

function keyLen(obj: Object): number {
    if (obj == null) {
        return 0;
    }
    return Object.keys(obj).length;
}

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

const Widgets = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
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
        <div
            className="flex flex-col w-12 overflow-hidden py-1 -ml-1 select-none"
            onContextMenu={handleWidgetsBarContextMenu}
        >
            {widgets?.map((data, idx) => <Widget key={`widget-${idx}`} widget={data} />)}
            <div className="flex-grow" />
            {showHelp ? (
                <>
                    <Widget key="tips" widget={tipsWidget} />
                    <Widget key="help" widget={helpWidget} />
                </>
            ) : null}
            {isDev() ? <NotificationPopover /> : null}
        </div>
    );
});

async function handleWidgetSelect(widget: WidgetConfigType) {
    const blockDef = widget.blockdef;
    createBlock(blockDef, widget.magnified);
}

const Widget = memo(({ widget }: { widget: WidgetConfigType }) => {
    return (
        <div
            className={clsx(
                "flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer",
                widget["display:hidden"] && "hidden"
            )}
            onClick={() => handleWidgetSelect(widget)}
            title={widget.description || widget.label}
        >
            <div style={{ color: widget.color }}>
                <i className={makeIconClass(widget.icon, true, { defaultIcon: "browser" })}></i>
            </div>
            {!isBlank(widget.label) ? (
                <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden">
                    {widget.label}
                </div>
            ) : null}
        </div>
    );
});

const WorkspaceElem = memo(() => {
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const settings = useAtomValue(atoms.settingsAtom);
    const tabBarPosition = settings?.["window:tabbarposition"];

    return (
        <div className={clsx("flex flex-col w-full flex-grow overflow-hidden", tabBarPosition === "bottom" && "flex-col-reverse")}>
            <TabBar key={ws.oid} workspace={ws} />
            <div className="flex flex-row flex-grow overflow-hidden">
                <ErrorBoundary key={tabId}>
                    {tabId === "" ? (
                        <CenteredDiv>No Active Tab</CenteredDiv>
                    ) : (
                        <>
                            <TabContent key={tabId} tabId={tabId} />
                            <Widgets />
                            <ModalsRenderer />
                        </>
                    )}
                </ErrorBoundary>
            </div>
        </div>
    );
});

export { WorkspaceElem as Workspace };
