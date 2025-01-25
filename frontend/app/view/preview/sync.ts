// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, globalStore } from "@/store/global";
import * as WOS from "@/store/wos";
import { PreviewModel } from "./preview";
import * as React from "react";
import { useAtomValue } from "jotai";
import { ObjectService } from "@/store/services";

declare module "@/store/wos" {
    interface MetaType {
        "preview:linked_terminal"?: string | null;
        "cmd:cwd"?: string;
    }
}

/**
 * Synchronizes the Terminal's current working directory with the Preview's directory.
 * This is used when the Terminal and Preview panes are linked.
 */
export function useTerminalPreviewSync(previewModel: PreviewModel) {
    const blockData = useAtomValue(previewModel.blockAtom);
    const linkedTerminalId = blockData?.meta?.["preview:linked_terminal"];
    
    React.useEffect(() => {
        if (!linkedTerminalId) {
            return;
        }

        const terminalBlockAtom = WOS.getWaveObjectAtom(WOS.makeORef("block", linkedTerminalId));
        const unsubscribe = globalStore.sub(terminalBlockAtom, () => {
            const terminalBlock = globalStore.get(terminalBlockAtom);
            const terminalCwd = terminalBlock?.meta?.["cmd:cwd"];
            if (terminalCwd) {
                previewModel.isUpdatingFromTerminal = true;
                previewModel.goHistory(terminalCwd)
                    .catch(console.error)
                    .finally(() => {
                        previewModel.isUpdatingFromTerminal = false;
                    });
            }
        });

        return () => {
            unsubscribe();
            previewModel.isUpdatingFromTerminal = false;
        };
    }, [linkedTerminalId, previewModel]);
}

/**
 * Links or unlinks a Terminal and Preview pane for directory synchronization
 */
export async function toggleTerminalPreviewLink(terminalId: string, previewId: string) {
    const previewBlockRef = WOS.makeORef("block", previewId);
    const previewBlock = globalStore.get(WOS.getWaveObjectAtom(previewBlockRef));
    
    if (previewBlock?.meta?.["preview:linked_terminal"] === terminalId) {
        await ObjectService.UpdateObjectMeta(previewBlockRef, {
            "preview:linked_terminal": null
        });
        return;
    }

    await ObjectService.UpdateObjectMeta(previewBlockRef, {
        "preview:linked_terminal": terminalId
    });

    const terminalBlock = globalStore.get(WOS.getWaveObjectAtom(WOS.makeORef("block", terminalId)));
    const terminalCwd = terminalBlock?.meta?.["cmd:cwd"];
    if (terminalCwd) {
        const previewModel = new PreviewModel(previewId, null);
        previewModel.isUpdatingFromTerminal = true;
        try {
            await previewModel.goHistory(terminalCwd);
        } finally {
            previewModel.isUpdatingFromTerminal = false;
        }
    }
}