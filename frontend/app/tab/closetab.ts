// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

type CloseTabFn = () => Promise<boolean>;

type CloseTabWithConfirmationOpts = {
    confirmClose: boolean;
    closeTab: CloseTabFn;
    onDidClose?: () => void;
};

export async function closeTabWithConfirmation({
    confirmClose,
    closeTab,
    onDidClose,
}: CloseTabWithConfirmationOpts): Promise<boolean> {
    if (!confirmClose) {
        return await runClose(closeTab, onDidClose);
    }
    return await new Promise<boolean>((resolve, reject) => {
        modalsModel.pushModal("CloseTabConfirmModal", {
            onCancel: () => resolve(false),
            onConfirm: async (dontAskAgain: boolean) => {
                try {
                    if (dontAskAgain) {
                        await RpcApi.SetConfigCommand(TabRpcClient, { "tab:confirmclose": false });
                    }
                    const didClose = await runClose(closeTab, onDidClose);
                    resolve(didClose);
                } catch (e) {
                    reject(e);
                }
            },
        });
    });
}

async function runClose(closeTab: CloseTabFn, onDidClose?: () => void): Promise<boolean> {
    const didClose = await closeTab();
    if (didClose) {
        onDidClose?.();
    }
    return didClose;
}
