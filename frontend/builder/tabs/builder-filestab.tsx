// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderFocusManager } from "@/builder/store/builderFocusManager";
import { memo, useRef } from "react";

const BuilderFilesTab = memo(() => {
    const focusElemRef = useRef<HTMLInputElement>(null);

    const handleClick = () => {
        focusElemRef.current?.focus();
        BuilderFocusManager.getInstance().setAppFocused();
    };

    return (
        <div className="w-full h-full flex items-center justify-center" onClick={handleClick}>
            <div key="focuselem" className="h-0 w-0">
                <input
                    type="text"
                    value=""
                    ref={focusElemRef}
                    className="h-0 w-0 opacity-0 pointer-events-none"
                    onChange={() => {}}
                />
            </div>
            <h1 className="text-4xl">Files Tab</h1>
        </div>
    );
});

BuilderFilesTab.displayName = "BuilderFilesTab";

export { BuilderFilesTab };