// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { isDev } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WaveAIModel } from "./waveai-model";

export async function handleWaveAIContextMenu(e: React.MouseEvent, showCopy: boolean): Promise<void> {
    e.preventDefault();
    e.stopPropagation();

    const model = WaveAIModel.getInstance();
    const menu: ContextMenuItem[] = [];

    if (showCopy) {
        const hasSelection = waveAIHasSelection();
        if (hasSelection) {
            menu.push({
                role: "copy",
            });
            menu.push({ type: "separator" });
        }
    }

    menu.push({
        label: "New Chat",
        click: () => {
            model.clearChat();
        },
    });

    menu.push({ type: "separator" });

    const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
        oref: model.orefContext,
    });

    const currentMaxTokens = rtInfo?.["waveai:maxoutputtokens"] ?? 4096;

    const maxTokensSubmenu: ContextMenuItem[] = [];

    if (isDev()) {
        maxTokensSubmenu.push({
            label: "1k (Dev Testing)",
            type: "checkbox",
            checked: currentMaxTokens === 1024,
            click: () => {
                RpcApi.SetRTInfoCommand(TabRpcClient, {
                    oref: model.orefContext,
                    data: { "waveai:maxoutputtokens": 1024 },
                });
            },
        });
    }
    maxTokensSubmenu.push(
        {
            label: "4k",
            type: "checkbox",
            checked: currentMaxTokens === 4096,
            click: () => {
                RpcApi.SetRTInfoCommand(TabRpcClient, {
                    oref: model.orefContext,
                    data: { "waveai:maxoutputtokens": 4096 },
                });
            },
        },
        {
            label: "16k (Pro)",
            type: "checkbox",
            checked: currentMaxTokens === 16384,
            click: () => {
                RpcApi.SetRTInfoCommand(TabRpcClient, {
                    oref: model.orefContext,
                    data: { "waveai:maxoutputtokens": 16384 },
                });
            },
        },
        {
            label: "64k (Pro)",
            type: "checkbox",
            checked: currentMaxTokens === 65536,
            click: () => {
                RpcApi.SetRTInfoCommand(TabRpcClient, {
                    oref: model.orefContext,
                    data: { "waveai:maxoutputtokens": 65536 },
                });
            },
        }
    );

    menu.push({
        label: "Max Output Tokens",
        submenu: maxTokensSubmenu,
    });

    menu.push({ type: "separator" });

    menu.push({
        label: "Configure Modes",
        click: () => {
            model.openWaveAIConfig();
        },
    });

    if (model.canCloseWaveAIPanel()) {
        menu.push({ type: "separator" });

        menu.push({
            label: "Hide Wave AI",
            click: () => {
                model.closeWaveAIPanel();
            },
        });
    }

    ContextMenuModel.showContextMenu(menu, e);
}
