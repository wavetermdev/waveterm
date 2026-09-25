// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "@excalidraw/excalidraw/index.css";

import { ErrorOverlay } from "@/app/view/preview/preview-error-overlay";
import { Excalidraw } from "@excalidraw/excalidraw";
import { useAtom, useAtomValue } from "jotai";

import { ExcalidrawModel } from "./excalidraw-model";

(window as any).EXCALIDRAW_ASSET_PATH = "./excalidraw/";

export const ExcalidrawView: React.FC<ViewComponentProps<ExcalidrawModel>> = ({ model }) => {
    const theme = useAtomValue(model.themeAtom);
    const sceneLoadable = useAtomValue(model.loadableSceneAtom);
    const [errorMsg, setErrorMsg] = useAtom(model.errorMsgAtom);

    if (sceneLoadable.state === "loading") {
        return <div className="h-full w-full" />;
    }

    const scene = sceneLoadable.state === "hasData" ? sceneLoadable.data : null;

    return (
        <div className="relative h-full w-full">
            {errorMsg && <ErrorOverlay errorMsg={errorMsg} resetOverlay={() => setErrorMsg(null)} />}
            <Excalidraw
                initialData={scene}
                theme={theme as "dark" | "light"}
                onChange={(elements, appState, files) => model.handleChange(elements, appState, files)}
                excalidrawAPI={(api) => model.setExcalidrawAPI(api)}
            />
        </div>
    );
};
