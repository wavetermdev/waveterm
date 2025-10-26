// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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
            <div className="flex-1 flex flex-col items-center justify-center">
                <h1 className="text-5xl font-semibold mb-8">Tsunami Builder</h1>
                <div className="text-xl opacity-70">
                    <p className="my-2">Builder ID: {initOpts.builderId}</p>
                    <p className="my-2">App ID: {initOpts.appId}</p>
                </div>
            </div>
        </div>
    );
}
