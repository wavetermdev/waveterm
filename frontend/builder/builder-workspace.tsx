// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

const BuilderWorkspace = memo(() => {
    return (
        <div className="flex-1 overflow-hidden">
            <PanelGroup direction="horizontal">
                <Panel defaultSize={50} minSize={20}>
                    <div className="w-full h-full flex items-center justify-center bg-gray-900 border-r border-border">
                        <span className="text-2xl">Chat Panel</span>
                    </div>
                </Panel>
                <PanelResizeHandle className="w-0.5 bg-transparent hover:bg-gray-500/20 transition-colors" />
                <Panel defaultSize={50} minSize={20}>
                    <PanelGroup direction="vertical">
                        <Panel defaultSize={66} minSize={20}>
                            <div className="w-full h-full flex items-center justify-center border-b border-border">
                                <span className="text-2xl">App Panel</span>
                            </div>
                        </Panel>
                        <PanelResizeHandle className="h-0.5 bg-transparent hover:bg-gray-500/20 transition-colors" />
                        <Panel defaultSize={34} minSize={20}>
                            <div className="w-full h-full flex items-center justify-center">
                                <span className="text-2xl">Build Panel</span>
                            </div>
                        </Panel>
                    </PanelGroup>
                </Panel>
            </PanelGroup>
        </div>
    );
});

BuilderWorkspace.displayName = "BuilderWorkspace";

export { BuilderWorkspace };