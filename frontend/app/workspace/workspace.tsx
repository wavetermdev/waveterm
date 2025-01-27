// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { atoms, createBlock, isDev } from "@/store/global";
import { isBlank, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { NotificationPopover } from "../notification/notificationpopover";

import "./workspace.scss";

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
    return (
        <div className="workspace-widgets">
            {widgets?.map((data, idx) => <Widget key={`widget-${idx}`} widget={data} />)}
            {showHelp ? (
                <>
                    <div className="widget-spacer" />
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
        <div className="widget" onClick={() => handleWidgetSelect(widget)} title={widget.description || widget.label}>
            <div className="widget-icon" style={{ color: widget.color }}>
                <i className={makeIconClass(widget.icon, true, { defaultIcon: "browser" })}></i>
            </div>
            {!isBlank(widget.label) ? <div className="widget-label">{widget.label}</div> : null}
        </div>
    );
});

const WorkspaceElem = memo(() => {
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    return (
        <div className="workspace">
            <TabBar key={ws.oid} workspace={ws} />
            <div className="workspace-tabcontent">
                <ErrorBoundary key={tabId}>
                    {tabId == "" ? (
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
