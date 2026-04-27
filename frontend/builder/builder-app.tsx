// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { globalStore } from "@/app/store/jotaiStore";
import { WaveEnvContext } from "@/app/waveenv/waveenv";
import { makeWaveEnvImpl } from "@/app/waveenv/waveenvimpl";
import { AppSelectionModal } from "@/builder/app-selection-modal";
import { BuilderWorkspace } from "@/builder/builder-workspace";
import { atoms, isDev } from "@/store/global";
import { appHandleKeyDown } from "@/store/keymodel";
import * as keyutil from "@/util/keyutil";
import { isBlank } from "@/util/util";
import { Provider, useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

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

function BuilderAppInner() {
    const builderAppId = useAtomValue(atoms.builderAppId);
    const hasDraftApp = !isBlank(builderAppId) && builderAppId.startsWith("draft/");

    return (
        <div className="w-full h-full flex flex-col bg-main-bg text-main-text">
            <BuilderKeyHandlers />
            <div
                className="h-9 shrink-0 border-b border-b-border flex items-center justify-center gap-2"
                style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            >
                {isDev() ? (
                    <div className="text-accent text-xl" title="Running Wave Dev Build">
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
                <div className="text-sm font-medium">
                    WaveApp Builder{!isBlank(builderAppId) && ` (${builderAppId})`}
                </div>
            </div>
            <DndProvider backend={HTML5Backend}>
                {hasDraftApp ? <BuilderWorkspace /> : <AppSelectionModal />}
            </DndProvider>
            <ModalsRenderer />
        </div>
    );
}

export function BuilderApp({ initOpts, onFirstRender }: BuilderAppProps) {
    const waveEnvRef = useRef(makeWaveEnvImpl());
    useEffect(() => {
        onFirstRender();
    }, []);

    return (
        <Provider store={globalStore}>
            <WaveEnvContext.Provider value={waveEnvRef.current}>
                <BuilderAppInner />
            </WaveEnvContext.Provider>
        </Provider>
    );
}
