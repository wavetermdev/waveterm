// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { BuilderAppPanelModel } from "@/builder/store/builder-apppanel-model";
import { BuilderBuildPanelModel } from "@/builder/store/builder-buildpanel-model";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { memo, useState } from "react";

const EmptyStateView = memo(() => {
    return (
        <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 max-w-[500px] text-center px-8">
                <div className="text-6xl">🏗️</div>
                <div className="flex flex-col gap-3">
                    <h2 className="text-2xl font-semibold text-primary">No App to Preview</h2>
                    <p className="text-base text-secondary leading-relaxed">
                        Get started by using the AI chat interface on the left to create your WaveApp. Describe what you
                        want to build, and the AI will help you generate the code.
                    </p>
                </div>
                <div className="text-base text-secondary mt-2">
                    Your app will appear here once <span className="font-mono">app.go</span> is created
                </div>
            </div>
        </div>
    );
});

EmptyStateView.displayName = "EmptyStateView";

const ErrorStateView = memo(({ errorMsg }: { errorMsg: string }) => {
    const displayMsg = errorMsg && errorMsg.trim() ? errorMsg : "Unknown Error";
    const waveAIModel = WaveAIModel.getInstance();
    const buildPanelModel = BuilderBuildPanelModel.getInstance();
    const outputLines = useAtomValue(buildPanelModel.outputLines);
    const isStreaming = useAtomValue(waveAIModel.isAIStreaming);

    const getBuildContext = () => {
        const filteredLines = outputLines.filter((line) => !line.startsWith("[debug]"));
        const buildOutput = filteredLines.join("\n").trim();
        return `Build Error:\n\`\`\`\n${displayMsg}\n\`\`\`\n\nBuild Output:\n\`\`\`\n${buildOutput}\n\`\`\``;
    };

    const handleAddToContext = () => {
        const context = getBuildContext();
        waveAIModel.appendText(context, true);
        waveAIModel.focusInput();
    };

    const handleAskAIToFix = async () => {
        const context = getBuildContext();
        waveAIModel.appendText("Please help me fix this build error:\n\n" + context, true);
        await waveAIModel.handleSubmit();
    };

    return (
        <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 max-w-2xl text-center px-8">
                <div className="flex flex-col gap-3">
                    <h2 className="text-2xl font-semibold text-error">Build Error</h2>
                    <div className="text-left bg-panel border border-error/30 rounded-lg p-4 max-h-96 overflow-auto">
                        <pre className="text-sm text-secondary whitespace-pre-wrap font-mono">{displayMsg}</pre>
                    </div>
                    {!isStreaming && (
                        <div className="flex gap-3 mt-2 justify-center">
                            <button
                                onClick={handleAddToContext}
                                className="px-4 py-2 bg-panel text-primary border border-border rounded hover:bg-panel/80 transition-colors cursor-pointer"
                            >
                                Add Error to AI Context
                            </button>
                            <button
                                onClick={handleAskAIToFix}
                                className="px-4 py-2 bg-accent/80 text-primary font-semibold rounded hover:bg-accent transition-colors cursor-pointer"
                            >
                                Ask AI to Fix
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

ErrorStateView.displayName = "ErrorStateView";

const BuildingStateView = memo(() => {
    return (
        <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 max-w-[500px] text-center px-8">
                <div className="text-6xl">⚙️</div>
                <div className="flex flex-col gap-3">
                    <h2 className="text-2xl font-semibold text-primary">App is Building...</h2>
                    <p className="text-base text-secondary leading-relaxed">
                        Your WaveApp is being compiled and prepared. This may take a few moments.
                    </p>
                </div>
            </div>
        </div>
    );
});

BuildingStateView.displayName = "BuildingStateView";

const StoppedStateView = memo(({ onStart }: { onStart: () => void }) => {
    const [isStarting, setIsStarting] = useState(false);

    const handleStart = () => {
        setIsStarting(true);
        onStart();
        setTimeout(() => setIsStarting(false), 2000);
    };

    return (
        <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 max-w-[500px] text-center px-8">
                <div className="flex flex-col gap-3">
                    <h2 className="text-2xl font-semibold text-primary">App is Not Running</h2>
                    <p className="text-base text-secondary leading-relaxed">
                        Your WaveApp is currently not running. Click the button below to start it.
                    </p>
                </div>
                {!isStarting && (
                    <button
                        onClick={handleStart}
                        className="px-6 py-2 bg-accent text-primary font-semibold rounded hover:bg-accent/80 transition-colors cursor-pointer"
                    >
                        Start App
                    </button>
                )}
                {isStarting && <div className="text-base text-success">Starting...</div>}
            </div>
        </div>
    );
});

StoppedStateView.displayName = "StoppedStateView";

const BuilderPreviewTab = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const isLoading = useAtomValue(model.isLoadingAtom);
    const originalContent = useAtomValue(model.originalContentAtom);
    const builderStatus = useAtomValue(model.builderStatusAtom);
    const builderId = useAtomValue(atoms.builderId);

    const fileExists = originalContent.length > 0;

    if (isLoading) {
        return null;
    }

    if (builderStatus?.status === "error") {
        return <ErrorStateView errorMsg={builderStatus?.errormsg || ""} />;
    }

    if (!fileExists) {
        return <EmptyStateView />;
    }

    const status = builderStatus?.status || "init";

    if (status === "init") {
        return null;
    }

    if (status === "building") {
        return <BuildingStateView />;
    }

    if (status === "stopped") {
        return <StoppedStateView onStart={() => model.startBuilder()} />;
    }

    const shouldShowWebView = status === "running" && builderStatus?.port && builderStatus.port !== 0;

    if (shouldShowWebView) {
        const previewUrl = `http://localhost:${builderStatus.port}/?clientid=wave:${builderId}`;
        return (
            <div className="w-full h-full">
                <webview src={previewUrl} className="w-full h-full" />
            </div>
        );
    }

    return null;
});

BuilderPreviewTab.displayName = "BuilderPreviewTab";

export { BuilderPreviewTab };
