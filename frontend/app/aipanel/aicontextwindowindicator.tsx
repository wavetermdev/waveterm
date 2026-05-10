// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { memo, useMemo } from "react";
import { estimateTokensFromMessages } from "./ai-token-utils";
import { WaveUIMessage } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

interface AIContextWindowIndicatorProps {
    messages: WaveUIMessage[];
}

const DefaultContextWindow = 128_000;

function formatTokenCount(count: number): string {
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1)}M`;
    }
    if (count >= 1_000) {
        return `${(count / 1_000).toFixed(1)}k`;
    }
    return String(count);
}

export const AIContextWindowIndicator = memo(({ messages }: AIContextWindowIndicatorProps) => {
    const model = WaveAIModel.getInstance();
    const aiModelConfigs = useAtomValue(model.aiModelConfigs);
    const currentModel = useAtomValue(model.currentAIModel);

    const { usedTokens, maxTokens, percentage } = useMemo(() => {
        const used = estimateTokensFromMessages(messages);
        const config = aiModelConfigs?.[currentModel];
        const max = config?.["ai:contextwindow"] && config["ai:contextwindow"] > 0
            ? config["ai:contextwindow"]
            : DefaultContextWindow;
        const pct = Math.min((used / max) * 100, 100);
        return { usedTokens: used, maxTokens: max, percentage: pct };
    }, [messages, aiModelConfigs, currentModel]);

    const barColor = useMemo(() => {
        if (percentage >= 90) return "bg-red-500";
        if (percentage >= 70) return "bg-yellow-500";
        return "bg-accent";
    }, [percentage]);

    const textColor = useMemo(() => {
        if (percentage >= 90) return "text-red-400";
        if (percentage >= 70) return "text-yellow-400";
        return "text-gray-400";
    }, [percentage]);

    if (messages.length === 0) {
        return null;
    }

    return (
        <div className="flex items-center gap-2 px-2 py-1">
            <div className="flex-1 h-1 bg-zinc-700 rounded-full overflow-hidden max-w-[100px]">
                <div
                    className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                    style={{ width: `${percentage}%` }}
                />
            </div>
            <span className={`text-[10px] font-mono ${textColor}`}>
                {formatTokenCount(usedTokens)} / {formatTokenCount(maxTokens)}
            </span>
        </div>
    );
});

AIContextWindowIndicator.displayName = "AIContextWindowIndicator";
