// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { memo } from "react";

interface WaveAIVisualContentProps {
    model: WaveConfigViewModel;
}

export const WaveAIVisualContent = memo(({ model }: WaveAIVisualContentProps) => {
    return (
        <div className="flex flex-col gap-4 p-6 h-full">
            <div className="text-lg font-semibold">Wave AI Modes - Visual Editor</div>
            <div className="text-muted-foreground">Visual editor coming soon...</div>
        </div>
    );
});

WaveAIVisualContent.displayName = "WaveAIVisualContent";