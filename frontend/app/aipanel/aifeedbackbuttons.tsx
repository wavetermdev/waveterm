// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn, makeIconClass } from "@/util/util";
import { memo, useState } from "react";

interface AIFeedbackButtonsProps {
    messageText: string;
}

export const AIFeedbackButtons = memo(({ messageText }: AIFeedbackButtonsProps) => {
    const [thumbsUpClicked, setThumbsUpClicked] = useState(false);
    const [thumbsDownClicked, setThumbsDownClicked] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleThumbsUp = () => {
        setThumbsUpClicked(!thumbsUpClicked);
        if (thumbsDownClicked) {
            setThumbsDownClicked(false);
        }
    };

    const handleThumbsDown = () => {
        setThumbsDownClicked(!thumbsDownClicked);
        if (thumbsUpClicked) {
            setThumbsUpClicked(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(messageText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex items-center gap-0.5 mt-2">
            <button
                onClick={handleThumbsUp}
                className={cn(
                    "p-1.5 rounded cursor-pointer transition-colors",
                    thumbsUpClicked
                        ? "text-accent"
                        : "text-secondary hover:bg-gray-700 hover:text-primary"
                )}
                title="Good response"
            >
                <i className={makeIconClass(thumbsUpClicked ? "solid@thumbs-up" : "regular@thumbs-up", false)} />
            </button>
            <button
                onClick={handleThumbsDown}
                className={cn(
                    "p-1.5 rounded cursor-pointer transition-colors",
                    thumbsDownClicked
                        ? "text-accent"
                        : "text-secondary hover:bg-gray-700 hover:text-primary"
                )}
                title="Bad response"
            >
                <i className={makeIconClass(thumbsDownClicked ? "solid@thumbs-down" : "regular@thumbs-down", false)} />
            </button>
            <button
                onClick={handleCopy}
                className={cn(
                    "p-1.5 rounded cursor-pointer transition-colors",
                    copied
                        ? "text-success"
                        : "text-secondary hover:bg-gray-700 hover:text-primary"
                )}
                title="Copy message"
            >
                <i className={makeIconClass(copied ? "solid@check" : "regular@copy", false)} />
            </button>
        </div>
    );
});

AIFeedbackButtons.displayName = "AIFeedbackButtons";