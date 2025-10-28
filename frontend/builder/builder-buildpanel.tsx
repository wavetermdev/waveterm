// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderBuildPanelModel } from "@/builder/store/builder-buildpanel-model";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";

const BuilderBuildPanel = memo(() => {
    const model = BuilderBuildPanelModel.getInstance();
    const outputLines = useAtomValue(model.outputLines);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        model.initialize();
        return () => {
            model.dispose();
        };
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [outputLines]);

    return (
        <div className="w-full h-full flex flex-col bg-black">
            <div className="flex-shrink-0 px-3 py-2 border-b border-gray-700">
                <span className="text-sm font-semibold text-gray-300">Build Output</span>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto p-2">
                <pre className="font-mono text-xs text-gray-100 whitespace-pre">
                    {outputLines.length === 0 ? (
                        <span className="text-secondary">Waiting for output...</span>
                    ) : (
                        outputLines.join("\n")
                    )}
                </pre>
            </div>
        </div>
    );
});

BuilderBuildPanel.displayName = "BuilderBuildPanel";

export { BuilderBuildPanel };
