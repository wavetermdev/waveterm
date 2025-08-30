// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import clsx from "clsx";

import "./typingindicator.scss";

export interface TypingIndicatorProps {
    style?: React.CSSProperties;
    className?: string;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ style, className }) => {
    return (
        <div className={`typing-indicator ${className || ""}`} style={style}>
            <div className="typing-indicator-bubble">
                <div className="typing-indicator-dot"></div>
                <div className="typing-indicator-dot"></div>
                <div className="typing-indicator-dot"></div>
            </div>
        </div>
    );
};
