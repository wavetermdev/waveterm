// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIPanel } from "@/app/aipanel/aipanel";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { Widgets } from "@/app/workspace/widgets";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { atoms, getApi } from "@/store/global";
import * as WOS from "@/store/wos";
import { useAtomValue } from "jotai";
import React, { memo, useEffect, useMemo, useRef } from "react";
import "./workspace.scss";
import {
    ImperativePanelGroupHandle,
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";

/**
 * Formats a file path as breadcrumb segments.
 * Handles both Unix and Windows paths.
 *
 * @param path - Absolute file path
 * @returns Array of path segments for breadcrumb display
 *
 * @example
 * formatPathAsSegments("/home/user/projects") // ["home", "user", "projects"]
 * formatPathAsSegments("G:\\Code\\waveterm") // ["G:", "Code", "waveterm"]
 */
function formatPathAsSegments(path: string): string[] {
    if (!path) return [];

    // Handle Windows drive letters (e.g., "G:\Code\waveterm")
    // and Unix paths (e.g., "/home/user/projects")
    const segments = path.split(/[\/\\]/).filter((s) => s.length > 0);

    return segments;
}

/**
 * Breadcrumb bar showing the active tab's base directory with app menu button.
 * Positioned below the tab bar and spans full window width.
 * Always renders to show the menu button, breadcrumbs only when tab:basedir is set.
 */
const TabBreadcrumb = memo(() => {
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const tabAtom = useMemo(() => WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)), [tabId]);
    const tabData = useAtomValue(tabAtom);
    const baseDir = tabData?.meta?.["tab:basedir"];

    const segments = baseDir ? formatPathAsSegments(baseDir) : [];

    const handleMenuClick = () => {
        getApi().showWorkspaceAppMenu(ws.oid);
    };

    return (
        <div className="tab-breadcrumb">
            <div className="breadcrumb-content">
                {segments.map((seg, i) => (
                    <React.Fragment key={i}>
                        {i > 0 && <span className="separator">›</span>}
                        <span className="segment">{seg}</span>
                    </React.Fragment>
                ))}
            </div>
            <div className="breadcrumb-actions">
                <button
                    type="button"
                    className="menu-button"
                    onClick={handleMenuClick}
                    title="Menu"
                    aria-label="Open workspace menu"
                >
                    <i className="fa fa-ellipsis" />
                </button>
            </div>
        </div>
    );
});

TabBreadcrumb.displayName = "TabBreadcrumb";

const WorkspaceElem = memo(() => {
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const initialAiPanelPercentage = workspaceLayoutModel.getAIPanelPercentage(window.innerWidth);
    const panelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const aiPanelRef = useRef<ImperativePanelHandle>(null);
    const panelContainerRef = useRef<HTMLDivElement>(null);
    const aiPanelWrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (aiPanelRef.current && panelGroupRef.current && panelContainerRef.current && aiPanelWrapperRef.current) {
            workspaceLayoutModel.registerRefs(
                aiPanelRef.current,
                panelGroupRef.current,
                panelContainerRef.current,
                aiPanelWrapperRef.current
            );
        }
    }, []);

    useEffect(() => {
        const isVisible = workspaceLayoutModel.getAIPanelVisible();
        getApi().setWaveAIOpen(isVisible);
    }, []);

    useEffect(() => {
        window.addEventListener("resize", workspaceLayoutModel.handleWindowResize);
        return () => window.removeEventListener("resize", workspaceLayoutModel.handleWindowResize);
    }, []);

    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden">
            <TabBar key={ws.oid} workspace={ws} />
            <TabBreadcrumb />
            <div ref={panelContainerRef} className="flex flex-row flex-grow overflow-hidden">
                <ErrorBoundary key={tabId}>
                    <PanelGroup
                        direction="horizontal"
                        onLayout={workspaceLayoutModel.handlePanelLayout}
                        ref={panelGroupRef}
                    >
                        <Panel
                            ref={aiPanelRef}
                            collapsible
                            defaultSize={initialAiPanelPercentage}
                            order={1}
                            className="overflow-hidden"
                        >
                            <div ref={aiPanelWrapperRef} className="w-full h-full">
                                {tabId !== "" && <AIPanel />}
                            </div>
                        </Panel>
                        <PanelResizeHandle className="w-0.5 bg-transparent hover:bg-zinc-500/20 transition-colors" />
                        <Panel order={2} defaultSize={100 - initialAiPanelPercentage}>
                            {tabId === "" ? (
                                <CenteredDiv>No Active Tab</CenteredDiv>
                            ) : (
                                <div className="flex flex-row h-full">
                                    <TabContent key={tabId} tabId={tabId} />
                                    <Widgets />
                                </div>
                            )}
                        </Panel>
                    </PanelGroup>
                    <ModalsRenderer />
                </ErrorBoundary>
            </div>
        </div>
    );
});

WorkspaceElem.displayName = "WorkspaceElem";

export { WorkspaceElem as Workspace };
