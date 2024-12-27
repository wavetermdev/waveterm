// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { boundNumber } from "@/util/util";
import "./progressbar.scss";

type ProgressBarProps = {
    progress: number;
    label?: string;
};

const ProgressBar = ({ progress, label = "Progress" }: ProgressBarProps) => {
    const progressWidth = boundNumber(progress, 0, 100);

    return (
        <div
            className="progress-bar-container"
            role="progressbar"
            aria-valuenow={progressWidth}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
        >
            <div className="outer">
                <div className="progress-bar-fill" style={{ width: `${progressWidth}%` }}></div>
            </div>
            <span className="progress-bar-label">{progressWidth}%</span>
        </div>
    );
};

export { ProgressBar };
