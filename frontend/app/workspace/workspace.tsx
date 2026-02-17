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
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import {
    ImperativePanelGroupHandle,
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";

const InnerContent = memo(({ tabId }: { tabId: string }) => {
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const innerContainerWidth = workspaceLayoutModel.getInnerContainerWidth();
    const initialWidgetsPercentage = workspaceLayoutModel.getWidgetsPercentage(innerContainerWidth);
    const innerPanelGroupRef = useRef<ImperativePanelGroupHandle>(null);

    useEffect(() => {
        if (innerPanelGroupRef.current) {
            workspaceLayoutModel.registerInnerPanelGroupRef(innerPanelGroupRef.current);
        }
    }, []);

    const widgetsMinSize = workspaceLayoutModel.getWidgetsMinPercentage(innerContainerWidth);
    const widgetsMaxSize = workspaceLayoutModel.getWidgetsMaxPercentage(innerContainerWidth);

    return (
        <PanelGroup
            direction="horizontal"
            onLayout={workspaceLayoutModel.handleInnerPanelLayout}
            ref={innerPanelGroupRef}
        >
            <Panel order={1} defaultSize={100 - initialWidgetsPercentage}>
                <TabContent key={tabId} tabId={tabId} />
            </Panel>
            <PanelResizeHandle className="w-0.5 bg-transparent hover:bg-zinc-500/20 transition-colors" />
            <Panel
                order={2}
                defaultSize={initialWidgetsPercentage}
                minSize={widgetsMinSize}
                maxSize={widgetsMaxSize}
            >
                <Widgets />
            </Panel>
        </PanelGroup>
    );
});

InnerContent.displayName = "InnerContent";

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
                                <InnerContent tabId={tabId} />
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
