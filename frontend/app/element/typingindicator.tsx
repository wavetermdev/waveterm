// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";

import "./typingindicator.scss";

type TypingIndicatorProps = {
    className?: string;
};
const TypingIndicator = ({ className }: TypingIndicatorProps) => {
    return (
        <div className={clsx("typing", className)}>
            <span></span>
            <span></span>
            <span></span>
        </div>
    );
};

export { TypingIndicator };
