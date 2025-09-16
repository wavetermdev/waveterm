// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { Widgets } from "@/app/workspace/widgets";
import { workspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { AIPanel } from "@/app/aipanel/aipanel";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { memo, useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

const WorkspaceElem = memo(() => {
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const aiPanelVisible = useAtomValue(workspaceLayoutModel.aiPanelVisibleAtom);
    const aiPanelWidth = useAtomValue(workspaceLayoutModel.aiPanelWidthAtom);
    const [windowWidth, setWindowWidth] = useState(window.innerWidth);

    useEffect(() => {
        const handleResize = () => {
            setWindowWidth(window.innerWidth);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const handlePanelResize = (sizes: number[]) => {
        if (sizes.length >= 2 && aiPanelVisible) {
            const aiPanelPixelWidth = (sizes[0] / 100) * windowWidth;
            workspaceLayoutModel.handleAIPanelResize(aiPanelPixelWidth, windowWidth);
        }
    };

    const handleCloseAIPanel = () => {
        workspaceLayoutModel.setAIPanelVisible(false);
    };

    const aiPanelPercentage = aiPanelVisible ? Math.min((aiPanelWidth / windowWidth) * 100, 50) : 0;
    const mainContentPercentage = aiPanelVisible ? 100 - aiPanelPercentage : 100;

    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden">
            <TabBar key={ws.oid} workspace={ws} />
            <div className="flex flex-row flex-grow overflow-hidden">
                <ErrorBoundary key={tabId}>
                    {tabId === "" ? (
                        <CenteredDiv>No Active Tab</CenteredDiv>
                    ) : (
                        <PanelGroup direction="horizontal" onLayout={handlePanelResize}>
                            {aiPanelVisible && (
                                <>
                                    <Panel
                                        defaultSize={aiPanelPercentage}
                                        minSize={15}
                                        maxSize={50}
                                        order={1}
                                    >
                                        <AIPanel className="h-full" onClose={handleCloseAIPanel} />
                                    </Panel>
                                    <PanelResizeHandle className="w-0.5 bg-transparent hover:bg-gray-500/20 transition-colors" />
                                </>
                            )}
                            <Panel
                                defaultSize={mainContentPercentage}
                                order={2}
                            >
                                <div className="flex flex-row h-full">
                                    <TabContent key={tabId} tabId={tabId} />
                                    <Widgets />
                                </div>
                            </Panel>
                        </PanelGroup>
                    )}
                    <ModalsRenderer />
                </ErrorBoundary>
            </div>
        </div>
    );
});

WorkspaceElem.displayName = "WorkspaceElem";

export { WorkspaceElem as Workspace };
