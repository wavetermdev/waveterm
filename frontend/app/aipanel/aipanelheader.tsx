// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo, useState } from "react";

interface AIPanelHeaderProps {
    onClose?: () => void;
}

export const AIPanelHeader = memo(({ onClose }: AIPanelHeaderProps) => {
    const [widgetAccess, setWidgetAccess] = useState(true);

    return (
        <div className="p-2 pl-4 border-b border-gray-600 flex items-center justify-between">
            <h2 className="text-white text-lg font-semibold flex items-center gap-2">
                <i className="fa fa-sparkles text-accent"></i>
                Wave AI
            </h2>

            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-300">Widget Access</span>
                    <button
                        onClick={() => setWidgetAccess(!widgetAccess)}
                        className={`relative inline-flex h-6 w-14 items-center rounded-full transition-colors cursor-pointer ${
                            widgetAccess ? "bg-accent-500" : "bg-gray-600"
                        }`}
                        title={`Widget Access ${widgetAccess ? "ON" : "OFF"}`}
                    >
                        <span
                            className={`absolute inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                widgetAccess ? "translate-x-8" : "translate-x-1"
                            }`}
                        />
                        <span
                            className={`relative z-10 text-xs text-white transition-all ${
                                widgetAccess ? "ml-2.5 mr-6 text-left font-bold" : "ml-6 mr-1 text-right"
                            }`}
                        >
                            {widgetAccess ? "ON" : "OFF"}
                        </span>
                    </button>
                </div>

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
        </div>
    );
});

AIPanelHeader.displayName = "AIPanelHeader";
