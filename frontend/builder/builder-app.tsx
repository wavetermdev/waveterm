// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderWorkspace } from "@/builder/builder-workspace";
import { appHandleKeyDown } from "@/store/keymodel";
import * as keyutil from "@/util/keyutil";
import { useEffect } from "react";

type BuilderAppProps = {
    initOpts: BuilderInitOpts;
    onFirstRender: () => void;
};

const BuilderKeyHandlers = () => {
    useEffect(() => {
        const staticKeyDownHandler = keyutil.keydownWrapper(appHandleKeyDown);
        document.addEventListener("keydown", staticKeyDownHandler);

        return () => {
            document.removeEventListener("keydown", staticKeyDownHandler);
        };
    }, []);
    return null;
};

export function BuilderApp({ initOpts, onFirstRender }: BuilderAppProps) {
    useEffect(() => {
        onFirstRender();
    }, []);

    return (
        <div className="w-full h-full flex flex-col bg-main-bg text-main-text">
            <BuilderKeyHandlers />
            <div
                className="h-9 flex-shrink-0 border-b border-b-border"
                style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            >
                {/* Title bar - draggable area */}
            </div>
            <BuilderWorkspace />
        </div>
    );
}
