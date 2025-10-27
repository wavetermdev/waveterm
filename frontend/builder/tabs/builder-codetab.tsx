// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { BuilderAppPanelModel } from "@/builder/store/builderAppPanelModel";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { memo, useEffect } from "react";

const BuilderCodeTab = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const builderAppId = useAtomValue(atoms.builderAppId);
    const codeContent = useAtomValue(model.codeContentAtom);
    const isLoading = useAtomValue(model.isLoadingAtom);
    const error = useAtomValue(model.errorAtom);

    useEffect(() => {
        if (builderAppId) {
            model.loadAppFile(builderAppId);
        }
    }, [builderAppId, model]);

    const handleCodeChange = (newText: string) => {
        model.setCodeContent(newText);
    };

    if (isLoading) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <div className="text-secondary">Loading app.go...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <div className="text-red-500">{error}</div>
            </div>
        );
    }

    return (
        <div className="w-full h-full">
            <CodeEditor
                blockId=""
                text={codeContent}
                readonly={false}
                language="go"
                fileName="app.go"
                onChange={handleCodeChange}
            />
        </div>
    );
});

BuilderCodeTab.displayName = "BuilderCodeTab";

export { BuilderCodeTab };
