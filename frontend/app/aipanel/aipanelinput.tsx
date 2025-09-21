// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useEffect, useRef } from "react";

interface AIPanelInputProps {
    input: string;
    setInput: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    status: string;
}

export const AIPanelInput = memo(({ input, setInput, onSubmit, status }: AIPanelInputProps) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit(e as any);
        }
    };

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        textarea.style.height = "auto";
        const scrollHeight = textarea.scrollHeight;
        const maxHeight = 6 * 24; // 6 lines * approximate line height
        textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }, [input]);

    return (
        <div className="border-t border-gray-600">
            <form onSubmit={onSubmit}>
                <div className="relative">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask Wave AI anything..."
                        className="w-full bg-gray-800 text-white px-2 py-2 pr-6 focus:outline-none resize-none overflow-hidden"
                        style={{ fontSize: "13px" }}
                        disabled={status !== "ready"}
                        rows={2}
                    />
                    <button
                        type="submit"
                        disabled={status !== "ready" || !input.trim()}
                        className={cn(
                            "absolute bottom-2 right-1 w-3.5 h-3.5 transition-colors flex items-center justify-center",
                            status !== "ready" || !input.trim()
                                ? "text-gray-400"
                                : "text-accent/80 hover:text-accent cursor-pointer"
                        )}
                    >
                        {status === "streaming" ? (
                            <i className="fa fa-spinner fa-spin text-xs"></i>
                        ) : (
                            <i className="fa fa-paper-plane text-xs"></i>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
});

AIPanelInput.displayName = "AIPanelInput";
