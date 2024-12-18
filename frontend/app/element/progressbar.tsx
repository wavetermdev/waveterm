// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";

import "./progressbar.scss";

type ProgressBarProps = {
    progress: number;
    label?: string;
};

const ProgressBar: React.FC<ProgressBarProps> = ({ progress, label = "Progress" }) => {
    const progressWidth = Math.min(Math.max(progress, 0), 100);

    return (
        <div
            className="progress-bar-container"
            role="progressbar"
            aria-valuenow={progressWidth}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
        >
            <div className="progress-bar-fill" style={{ width: `${progressWidth}%` }}></div>
            <span className="progress-bar-label">{progressWidth}%</span>
        </div>
    );
};

export { ProgressBar };
