// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderAppPanelModel } from "@/builder/store/builder-apppanel-model";
import { useAtomValue } from "jotai";
import { memo } from "react";

const BuilderPreviewTab = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const isLoading = useAtomValue(model.isLoadingAtom);
    const originalContent = useAtomValue(model.originalContentAtom);

    const fileExists = originalContent.length > 0;

    if (isLoading) {
        return null;
    }

    if (!fileExists) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-main-bg">
                <div className="flex flex-col items-center gap-6 max-w-md text-center px-8">
                    <div className="text-6xl">🏗️</div>
                    <div className="flex flex-col gap-3">
                        <h2 className="text-2xl font-semibold text-main-text">No App to Preview</h2>
                        <p className="text-base text-secondary leading-relaxed">
                            Get started by using the AI chat interface on the left to create your WaveApp. Describe what
                            you want to build, and the AI will help you generate the code.
                        </p>
                    </div>
                    <div className="text-sm text-tertiary mt-2">
                        Your app will appear here once <span className="font-mono">app.go</span> is created
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex items-center justify-center">
            <h1 className="text-4xl">Preview Tab</h1>
        </div>
    );
});

BuilderPreviewTab.displayName = "BuilderPreviewTab";

export { BuilderPreviewTab };
