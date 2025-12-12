// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn, makeIconClass } from "@/util/util";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { WaveAIModel } from "./waveai-model";

interface AIFeedbackButtonsProps {
    messageText: string;
}

export const AIFeedbackButtons = memo(({ messageText }: AIFeedbackButtonsProps) => {
    const { t } = useTranslation("ai");
    const [thumbsUpClicked, setThumbsUpClicked] = useState(false);
    const [thumbsDownClicked, setThumbsDownClicked] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleThumbsUp = () => {
        setThumbsUpClicked(!thumbsUpClicked);
        if (thumbsDownClicked) {
            setThumbsDownClicked(false);
        }
        if (!thumbsUpClicked) {
            WaveAIModel.getInstance().handleAIFeedback("good");
        }
    };

    const handleThumbsDown = () => {
        setThumbsDownClicked(!thumbsDownClicked);
        if (thumbsUpClicked) {
            setThumbsUpClicked(false);
        }
        if (!thumbsDownClicked) {
            WaveAIModel.getInstance().handleAIFeedback("bad");
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
                    thumbsUpClicked ? "text-accent" : "text-secondary hover:bg-gray-700 hover:text-primary"
                )}
                title={t("message.goodResponse")}
            >
                <i className={makeIconClass(thumbsUpClicked ? "solid@thumbs-up" : "regular@thumbs-up", false)} />
            </button>
            <button
                onClick={handleThumbsDown}
                className={cn(
                    "p-1.5 rounded cursor-pointer transition-colors",
                    thumbsDownClicked ? "text-accent" : "text-secondary hover:bg-gray-700 hover:text-primary"
                )}
                title={t("message.badResponse")}
            >
                <i className={makeIconClass(thumbsDownClicked ? "solid@thumbs-down" : "regular@thumbs-down", false)} />
            </button>
            {messageText?.trim() && (
                <button
                    onClick={handleCopy}
                    className={cn(
                        "p-1.5 rounded cursor-pointer transition-colors",
                        copied ? "text-success" : "text-secondary hover:bg-gray-700 hover:text-primary"
                    )}
                    title={t("message.copyMessage")}
                >
                    <i className={makeIconClass(copied ? "solid@check" : "regular@copy", false)} />
                </button>
            )}
        </div>
    );
});

AIFeedbackButtons.displayName = "AIFeedbackButtons";