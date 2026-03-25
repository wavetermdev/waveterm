// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { atom } from "jotai";
import { useCallback } from "react";

export class WaveAiModel implements ViewModel {
    viewType = "waveai";
    viewIcon = atom("sparkles");
    viewName = atom("Wave AI");
    noPadding = atom(true);
    viewComponent = WaveAiDeprecatedView;

    constructor(_: ViewModelInitType) {}
}

function WaveAiDeprecatedView() {
    const handleOpenAIPanel = useCallback(() => {
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(true);
    }, []);

    return (
        <div className="flex h-full items-center justify-center p-6">
            <div className="flex w-full max-w-[680px] flex-col items-center rounded-xl border border-border bg-panel px-8 py-10 text-center shadow-md">
                <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-accent/15 text-accent">
                    <i className="fa-sharp fa-solid fa-sparkles text-3xl" />
                </div>
                <h2 className="text-xl font-semibold text-primary">This legacy Wave AI block is no longer supported</h2>
                <p className="mt-3 text-sm leading-6 text-secondary">
                    This older AI widget has been retired. Please use the modern Wave AI panel for AI chats, terminal
                    context, tools, and uploads going forward.
                </p>
                <Button className="mt-6 cursor-pointer" onClick={handleOpenAIPanel}>
                    Open Wave AI panel
                </Button>
            </div>
        </div>
    );
}
