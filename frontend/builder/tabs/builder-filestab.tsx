// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";

const BuilderFilesTab = memo(() => {
    return (
        <div className="w-full h-full flex items-center justify-center">
            <h1 className="text-4xl">Files Tab</h1>
        </div>
    );
});

BuilderFilesTab.displayName = "BuilderFilesTab";

export { BuilderFilesTab };