// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn, makeIconClass } from "@/util/util";
import * as React from "react";
import "./zeroai-header.scss";

export interface ZeroAIHeaderProps {
    showSettings?: boolean;
    onToggleSettings?: () => void;
    className?: string;
}

export const ZeroAIHeader = React.memo(({ showSettings = false, onToggleSettings, className }: ZeroAIHeaderProps) => {
    return (
        <div className={cn("zeroai-header", className)}>
            <div className="zeroai-header-title">
                <i className={makeIconClass("fa-solid fa-robot", false)} />
                <span>ZeroAI</span>
            </div>
            <button
                className={cn("zeroai-header-btn", showSettings && "active")}
                onClick={onToggleSettings}
                title="Custom Providers"
            >
                <i className={makeIconClass("fa-solid fa-plug", false)} />
                <span>Providers</span>
            </button>
        </div>
    );
});

ZeroAIHeader.displayName = "ZeroAIHeader";
