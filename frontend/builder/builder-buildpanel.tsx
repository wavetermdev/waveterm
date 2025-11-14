// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { BuilderAppPanelModel } from "@/builder/store/builder-apppanel-model";
import { BuilderBuildPanelModel } from "@/builder/store/builder-buildpanel-model";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef } from "react";
import { debounce } from "throttle-debounce";

function handleBuildPanelContextMenu(e: React.MouseEvent, selectedText: string): void {
    e.preventDefault();
    e.stopPropagation();

    if (!selectedText) {
        return;
    }

    const menu: ContextMenuItem[] = [
        { role: "copy" },
        { type: "separator" },
        {
            label: "Add to Context",
            click: () => {
                const model = WaveAIModel.getInstance();
                const formattedText = `from builder output:\n\`\`\`\n${selectedText}\n\`\`\``;
                model.appendText(formattedText, true);
                model.focusInput();
            },
        },
    ];
    ContextMenuModel.showContextMenu(menu, e);
}

const BuilderBuildPanel = memo(() => {
    const model = BuilderBuildPanelModel.getInstance();
    const outputLines = useAtomValue(model.outputLines);
    const showDebug = useAtomValue(model.showDebug);
    const scrollRef = useRef<HTMLDivElement>(null);
    const preRef = useRef<HTMLPreElement>(null);

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

    const debouncedCopyOnSelect = useCallback(
        debounce(50, () => {
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                navigator.clipboard.writeText(selection.toString());
            }
        }),
        []
    );

    const handleMouseUp = useCallback(() => {
        debouncedCopyOnSelect();
    }, [debouncedCopyOnSelect]);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        const selection = window.getSelection();
        const selectedText = selection ? selection.toString() : "";
        handleBuildPanelContextMenu(e, selectedText);
    }, []);

    const handleDebugToggle = useCallback(() => {
        globalStore.set(model.showDebug, !showDebug);
    }, [model, showDebug]);

    const handleRestart = useCallback(() => {
        BuilderAppPanelModel.getInstance().restartBuilder();
    }, []);

    const filteredLines = showDebug ? outputLines : outputLines.filter((line) => !line.startsWith("[debug]") && line.trim().length > 0);

    return (
        <div className="w-full h-full flex flex-col bg-black">
            <div className="flex-shrink-0 px-3 py-2 border-b border-gray-700 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-300">Build Output</span>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showDebug}
                            onChange={handleDebugToggle}
                            className="cursor-pointer"
                        />
                        Debug
                    </label>
                    <button
                        className="px-3 py-1 text-sm font-medium rounded transition-colors bg-accent/80 text-white hover:bg-accent cursor-pointer"
                        onClick={handleRestart}
                    >
                        Restart App
                    </button>
                </div>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto p-2">
                <pre
                    ref={preRef}
                    className="font-mono text-xs text-gray-100 whitespace-pre"
                    onMouseUp={handleMouseUp}
                    onContextMenu={handleContextMenu}
                >
                    {/* this comment fixes JSX blank line in pre tag */}
                    {filteredLines.length === 0 ? (
                        <span className="text-secondary">Waiting for output...</span>
                    ) : (
                        filteredLines.join("\n")
                    )}
                </pre>
            </div>
        </div>
    );
});

BuilderBuildPanel.displayName = "BuilderBuildPanel";

export { BuilderBuildPanel };
