// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { IconButton } from "@/app/element/iconbutton";
import { useAtomValue } from "jotai";
import { memo, useEffect, useState } from "react";
import { SavedCommand } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

const formatCommandPreview = (text: string): string => {
    const firstLine = text.trim().split("\n")[0] ?? "";
    return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
};

const SavedCommandCard = memo(({ command }: { command: SavedCommand }) => {
    const model = WaveAIModel.getInstance();

    return (
        <div className="rounded-md border border-white/10 bg-black/30 p-2">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="truncate text-[11px] uppercase tracking-[0.18em] text-white/45">
                    {formatCommandPreview(command.text || "Untitled command")}
                </div>
                <div className="flex items-center gap-1">
                    <IconButton
                        decl={{
                            elemtype: "iconbutton",
                            icon: "regular@square-terminal",
                            title: "Run in focused terminal",
                            click: () => void model.runSavedCommand(command.text),
                            disabled: command.text.trim().length === 0,
                        }}
                    />
                    <IconButton
                        decl={{
                            elemtype: "iconbutton",
                            icon: "plus",
                            title: "Insert into prompt",
                            click: () => model.appendText(command.text, true, { scrollToBottom: true }),
                            disabled: command.text.trim().length === 0,
                        }}
                    />
                    <IconButton
                        decl={{
                            elemtype: "iconbutton",
                            icon: "trash",
                            title: "Remove saved command",
                            click: () => model.removeSavedCommand(command.id),
                        }}
                    />
                </div>
            </div>
            <textarea
                value={command.text}
                onChange={(e) => model.updateSavedCommand(command.id, e.target.value)}
                spellCheck={false}
                rows={Math.min(Math.max(command.text.split("\n").length || 1, 2), 6)}
                placeholder="Enter a command..."
                className="w-full resize-y rounded-md border border-white/10 bg-zinc-900 px-2 py-2 font-mono text-xs text-primary outline-none focus:border-accent"
            />
        </div>
    );
});

SavedCommandCard.displayName = "SavedCommandCard";

export const SavedCommandsPanel = memo(() => {
    const model = WaveAIModel.getInstance();
    const commands = useAtomValue(model.savedCommandsAtom);
    const [isOpen, setIsOpen] = useState(commands.length > 0);

    useEffect(() => {
        if (commands.length > 0) {
            setIsOpen(true);
        }
    }, [commands.length]);

    return (
        <div className="mx-2 mb-2 rounded-lg border border-white/10 bg-zinc-950/70">
            <button
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left cursor-pointer"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <i
                        className={`fa-solid ${isOpen ? "fa-chevron-down" : "fa-chevron-right"} text-[11px] text-white/60`}
                    />
                    <span className="text-sm font-medium text-primary">Saved Commands</span>
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-secondary">
                        {commands.length}
                    </span>
                </div>
                <div className="text-[11px] text-secondary">Reusable command snippets</div>
            </button>
            {isOpen && (
                <div className="border-t border-white/10 px-3 py-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-xs text-secondary">
                            Save shell commands from AI replies, edit them here, and insert them back into the prompt.
                        </div>
                        <button
                            className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-primary hover:bg-white/5 cursor-pointer"
                            onClick={() => model.addSavedCommand("")}
                        >
                            Add Command
                        </button>
                    </div>
                    {commands.length === 0 ? (
                        <div className="rounded-md border border-dashed border-white/10 px-3 py-4 text-sm text-secondary">
                            No saved commands yet.
                        </div>
                    ) : (
                        <div className="flex max-h-56 flex-col gap-3 overflow-y-auto pr-1">
                            {commands.map((command) => (
                                <SavedCommandCard key={command.id} command={command} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

SavedCommandsPanel.displayName = "SavedCommandsPanel";
