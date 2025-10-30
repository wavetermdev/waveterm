// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { DiffViewer } from "@/app/view/codeeditor/diffviewer";
import { globalStore, WOS } from "@/store/global";
import * as jotai from "jotai";
import { useEffect } from "react";

type DiffData = {
    original: string;
    modified: string;
    fileName: string;
};

export class AiFileDiffViewModel implements ViewModel {
    blockId: string;
    viewType = "aifilediff";
    blockAtom: jotai.Atom<Block>;
    diffDataAtom: jotai.PrimitiveAtom<DiffData | null>;
    errorAtom: jotai.PrimitiveAtom<string | null>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<string>;

    constructor(blockId: string) {
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.diffDataAtom = jotai.atom(null) as jotai.PrimitiveAtom<DiffData | null>;
        this.errorAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.loadingAtom = jotai.atom<boolean>(true);
        this.viewIcon = jotai.atom("file-lines");
        this.viewName = jotai.atom("AI Diff Viewer");
        this.viewText = jotai.atom((get) => {
            const diffData = get(this.diffDataAtom);
            return diffData?.fileName ?? "";
        });
    }

    get viewComponent(): ViewComponent {
        return AiFileDiffView;
    }
}

const AiFileDiffView: React.FC<ViewComponentProps<AiFileDiffViewModel>> = ({ blockId, model }) => {
    const blockData = jotai.useAtomValue(model.blockAtom);
    const diffData = jotai.useAtomValue(model.diffDataAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);

    useEffect(() => {
        async function loadDiffData() {
            const chatId = blockData?.meta?.["aifilediff:chatid"];
            const toolCallId = blockData?.meta?.["aifilediff:toolcallid"];
            const fileName = blockData?.meta?.file;

            if (!chatId || !toolCallId) {
                globalStore.set(model.errorAtom, "Missing chatId or toolCallId in block metadata");
                globalStore.set(model.loadingAtom, false);
                return;
            }

            if (!fileName) {
                globalStore.set(model.errorAtom, "Missing file name in block metadata");
                globalStore.set(model.loadingAtom, false);
                return;
            }

            try {
                const result = await RpcApi.WaveAIGetToolDiffCommand(TabRpcClient, {
                    chatid: chatId,
                    toolcallid: toolCallId,
                });

                if (!result) {
                    globalStore.set(model.errorAtom, "No diff data returned from server");
                    globalStore.set(model.loadingAtom, false);
                    return;
                }

                const originalContent = atob(result.originalcontents64);
                const modifiedContent = atob(result.modifiedcontents64);

                globalStore.set(model.diffDataAtom, {
                    original: originalContent,
                    modified: modifiedContent,
                    fileName: fileName,
                });
                globalStore.set(model.loadingAtom, false);
            } catch (e) {
                console.error("Error loading diff data:", e);
                globalStore.set(model.errorAtom, `Error loading diff data: ${e.message}`);
                globalStore.set(model.loadingAtom, false);
            }
        }

        loadDiffData();
    }, [blockData?.meta?.["aifilediff:chatid"], blockData?.meta?.["aifilediff:toolcallid"], blockData?.meta?.file]);

    if (loading) {
        return (
            <div className="flex items-center justify-center w-full h-full">
                <div className="text-secondary">Loading diff...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center w-full h-full">
                <div className="text-red-500">{error}</div>
            </div>
        );
    }

    if (!diffData) {
        return (
            <div className="flex items-center justify-center w-full h-full">
                <div className="text-secondary">No diff data available</div>
            </div>
        );
    }

    return (
        <DiffViewer
            blockId={blockId}
            original={diffData.original}
            modified={diffData.modified}
            fileName={diffData.fileName}
        />
    );
};

export default AiFileDiffView;
