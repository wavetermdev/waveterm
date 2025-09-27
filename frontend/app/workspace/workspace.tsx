// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIPanel } from "@/app/aipanel/aipanel";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { Widgets } from "@/app/workspace/widgets";
import { workspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import {
    ImperativePanelGroupHandle,
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";

const WorkspaceElem = memo(() => {
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const initialAiPanelPercentage = workspaceLayoutModel.getAIPanelPercentage(window.innerWidth);
    const panelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const aiPanelRef = useRef<ImperativePanelHandle>(null);

    useEffect(() => {
        if (aiPanelRef.current && panelGroupRef.current) {
            workspaceLayoutModel.registerRefs(aiPanelRef.current, panelGroupRef.current);
        }
    }, []);

    useEffect(() => {
        const handleResize = () => {
            if (!panelGroupRef.current) {
                return;
            }
            const newWindowWidth = window.innerWidth;
            const aiPanelPercentage = workspaceLayoutModel.getAIPanelPercentage(newWindowWidth);
            const mainContentPercentage = workspaceLayoutModel.getMainContentPercentage(newWindowWidth);
            workspaceLayoutModel.inResize = true;
            const layout = [aiPanelPercentage, mainContentPercentage];
            panelGroupRef.current.setLayout(layout);
            workspaceLayoutModel.inResize = false;
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const handlePanelLayout = (sizes: number[]) => {
        if (workspaceLayoutModel.inResize) {
            return;
        }
        const currentWindowWidth = window.innerWidth;
        const aiPanelPixelWidth = (sizes[0] / 100) * currentWindowWidth;
        workspaceLayoutModel.handleAIPanelResize(aiPanelPixelWidth, currentWindowWidth);
        const newPercentage = workspaceLayoutModel.getAIPanelPercentage(currentWindowWidth);
        const mainContentPercentage = 100 - newPercentage;
        workspaceLayoutModel.inResize = true;
        const layout = [newPercentage, mainContentPercentage];
        panelGroupRef.current.setLayout(layout);
        workspaceLayoutModel.inResize = false;
    };

    const handleCloseAIPanel = () => {
        workspaceLayoutModel.setAIPanelVisible(false);
    };

    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden">
            <TabBar key={ws.oid} workspace={ws} />
            <div className="flex flex-row flex-grow overflow-hidden">
                <ErrorBoundary key={tabId}>
                    <PanelGroup direction="horizontal" onLayout={handlePanelLayout} ref={panelGroupRef}>
                        <Panel ref={aiPanelRef} collapsible defaultSize={initialAiPanelPercentage} order={1}>
                            <AIPanel onClose={handleCloseAIPanel} />
                        </Panel>
                        <PanelResizeHandle className="w-0.5 bg-transparent hover:bg-gray-500/20 transition-colors" />
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
