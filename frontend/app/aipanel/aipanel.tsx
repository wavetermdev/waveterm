// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";

interface AIPanelProps {
    className?: string;
    onClose?: () => void;
}

const AIPanelComponent = memo(({ className, onClose }: AIPanelProps) => {
    return (
        <div className={`bg-gray-800 border-t border-gray-600 flex flex-col ${className || ""}`} style={{borderRight: '1px solid rgb(75, 85, 99)', borderTopRightRadius: 'var(--block-border-radius)', borderBottomRightRadius: 'var(--block-border-radius)'}}>
            <div className="p-4 border-b border-gray-600 flex items-center justify-between">
                <h2 className="text-white text-lg font-semibold flex items-center gap-2">
                    <i className="fa fa-sparkles text-accent"></i>
                    Wave AI
                </h2>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white cursor-pointer transition-colors p-1 rounded"
                        title="Close AI Panel"
                    >
                        <i className="fa fa-xmark"></i>
                    </button>
                )}
            </div>
            <div className="flex-1 p-4">
                <div className="text-gray-300">
                    <p>Wave AI content goes here...</p>
                    <p className="mt-2 text-sm text-gray-400">This is a placeholder for the AI assistant interface.</p>
                </div>
            </div>
        </div>
    );
});

AIPanelComponent.displayName = "AIPanel";

export { AIPanelComponent as AIPanel };
