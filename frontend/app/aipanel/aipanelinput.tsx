// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useRef, useEffect } from "react";

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
        <div className="@container border-t border-gray-600 p-2 @xs:p-4">
            <form onSubmit={onSubmit} className="flex gap-1 @xs:gap-2 items-end">
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask Wave AI anything..."
                    className="flex-1 bg-gray-700 text-white px-2 @xs:px-4 py-2 rounded-lg border border-gray-600 focus:border-accent focus:outline-none min-w-0 resize-none overflow-hidden"
                    style={{ fontSize: '13px' }}
                    disabled={status !== "ready"}
                    rows={1}
                />
                <button
                    type="submit"
                    disabled={status !== "ready" || !input.trim()}
                    className={cn(
                        "px-2 @xs:px-4 py-2 rounded-lg cursor-pointer transition-colors flex-shrink-0",
                        status !== "ready" || !input.trim()
                            ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                            : "bg-accent text-white hover:bg-accent/80"
                    )}
                >
                    {status === "streaming" ? (
                        <i className="fa fa-spinner fa-spin"></i>
                    ) : (
                        <i className="fa fa-paper-plane"></i>
                    )}
                </button>
            </form>
        </div>
    );
});

AIPanelInput.displayName = "AIPanelInput";