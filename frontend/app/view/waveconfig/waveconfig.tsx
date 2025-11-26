// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";

const WaveConfigView = memo(() => {
    return (
        <div className="flex flex-col w-full h-full p-4">
            <div className="text-xl font-semibold mb-4">Settings</div>
            <div className="text-muted">Settings view coming soon...</div>
        </div>
    );
});

WaveConfigView.displayName = "WaveConfigView";

export { WaveConfigView };
