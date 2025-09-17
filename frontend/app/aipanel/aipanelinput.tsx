// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo } from "react";

interface AIPanelInputProps {
    input: string;
    setInput: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    status: string;
}

export const AIPanelInput = memo(({ input, setInput, onSubmit, status }: AIPanelInputProps) => {
    return (
        <div className="border-t border-gray-600 p-4">
            <form onSubmit={onSubmit} className="flex gap-2">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask Wave AI anything..."
                    className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-accent focus:outline-none"
                    disabled={status !== "ready"}
                />
                <button
                    type="submit"
                    disabled={status !== "ready" || !input.trim()}
                    className={cn(
                        "px-4 py-2 rounded-lg cursor-pointer transition-colors",
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