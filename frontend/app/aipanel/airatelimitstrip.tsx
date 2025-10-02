// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global";
import * as jotai from "jotai";
import { memo, useEffect, useState } from "react";

function formatTimeRemaining(expirationEpoch: number): string {
    const now = Math.floor(Date.now() / 1000);
    const secondsRemaining = expirationEpoch - now;

    if (secondsRemaining <= 0) {
        return "soon";
    }

    const hours = Math.floor(secondsRemaining / 3600);
    const minutes = Math.floor((secondsRemaining % 3600) / 60);

    if (hours > 0) {
        return `${hours}h`;
    }
    return `${minutes}m`;
}

const AIRateLimitStripComponent = memo(() => {
    let rateLimitInfo = jotai.useAtomValue(atoms.waveAIRateLimitInfoAtom);
    // rateLimitInfo = { req: 0, reqlimit: 200, preq: 0, preqlimit: 50, resetepoch: 1759374575 + 45 * 60 }; // testing
    const [, forceUpdate] = useState({});

    const shouldShow = rateLimitInfo && !rateLimitInfo.unknown && (rateLimitInfo.preq <= 5 || rateLimitInfo.req === 0);

    useEffect(() => {
        if (!shouldShow) {
            return;
        }

        const interval = setInterval(() => {
            forceUpdate({});
        }, 60000);

        return () => clearInterval(interval);
    }, [shouldShow]);

    if (!rateLimitInfo || rateLimitInfo.unknown || !shouldShow) {
        return null;
    }

    const { req, reqlimit, preq, preqlimit, resetepoch } = rateLimitInfo;
    const timeRemaining = formatTimeRemaining(resetepoch);
    const totalLimit = preqlimit + reqlimit;

    if (preq > 0 && preq <= 5) {
        return (
            <div className="bg-yellow-900/30 border-b border-yellow-700/50 px-2 py-1.5 flex items-center gap-1 text-[11px] text-yellow-200">
                <i className="fa fa-sparkles text-yellow-400"></i>
                <span>
                    {preqlimit - preq}/{preqlimit} Premium Used
                </span>
                <div className="flex-1"></div>
                <span className="text-yellow-300/80">Resets in {timeRemaining}</span>
            </div>
        );
    }

    if (preq === 0 && req > 0) {
        return (
            <div className="bg-yellow-900/30 border-b border-yellow-700/50 px-2 pr-1 py-1.5 flex items-center gap-1 text-[11px] text-yellow-200">
                <i className="fa fa-check text-yellow-400"></i>
                <span>
                    {preqlimit}/{preqlimit} Premium
                </span>
                <span className="text-yellow-400">•</span>
                <span className="font-medium">Now on Basic</span>
                <div className="flex-1"></div>
                <span className="text-yellow-300/80">Resets in {timeRemaining}</span>
            </div>
        );
    }

    if (req === 0 && preq === 0) {
        return (
            <div className="bg-red-900/30 border-b border-red-700/50 px-2 py-1.5 flex items-center gap-2 text-[11px] text-red-200">
                <i className="fa fa-check text-red-400"></i>
                <span>
                    {totalLimit}/{totalLimit} Reqs
                </span>
                <span className="text-red-400">•</span>
                <span className="font-medium">Limit Reached</span>
                <div className="flex-1"></div>
                <span className="text-red-300/80">Resets in {timeRemaining}</span>
            </div>
        );
    }

    return null;
});

AIRateLimitStripComponent.displayName = "AIRateLimitStrip";

export { AIRateLimitStripComponent as AIRateLimitStrip };
