// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { atoms, isDev } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
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

    const rateLimitInfo = globalStore.get(atoms.waveAIRateLimitInfoAtom);
    const hasPremium = !rateLimitInfo || rateLimitInfo.unknown || rateLimitInfo.preq > 0;
    const currentThinkingMode = rtInfo?.["waveai:thinkingmode"] ?? (hasPremium ? "waveai@balanced" : "waveai@quick");
    const defaultTokens = model.inBuilder ? 24576 : 4096;
    const currentMaxTokens = rtInfo?.["waveai:maxoutputtokens"] ?? defaultTokens;

    const thinkingModeSubmenu: ContextMenuItem[] = [
        {
            label: "Quick (gpt-5-mini)",
            type: "checkbox",
            checked: currentThinkingMode === "waveai@quick",
            click: () => {
                RpcApi.SetRTInfoCommand(TabRpcClient, {
                    oref: model.orefContext,
                    data: { "waveai:thinkingmode": "waveai@quick" },
                });
            },
        },
        {
            label: hasPremium ? "Balanced (gpt-5.1, low thinking)" : "Balanced (premium)",
            type: "checkbox",
            checked: currentThinkingMode === "waveai@balanced",
            enabled: hasPremium,
            click: () => {
                if (!hasPremium) return;
                RpcApi.SetRTInfoCommand(TabRpcClient, {
                    oref: model.orefContext,
                    data: { "waveai:thinkingmode": "waveai@balanced" },
                });
            },
        },
        {
            label: hasPremium ? "Deep (gpt-5.1, full thinking)" : "Deep (premium)",
            type: "checkbox",
            checked: currentThinkingMode === "waveai@deep",
            enabled: hasPremium,
            click: () => {
                if (!hasPremium) return;
                RpcApi.SetRTInfoCommand(TabRpcClient, {
                    oref: model.orefContext,
                    data: { "waveai:thinkingmode": "waveai@deep" },
                });
            },
        },
    ];

    const maxTokensSubmenu: ContextMenuItem[] = [];

    if (model.inBuilder) {
        maxTokensSubmenu.push(
            {
                label: "24k",
                type: "checkbox",
                checked: currentMaxTokens === 24576,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "waveai:maxoutputtokens": 24576 },
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
    } else {
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
    }

    menu.push({
        label: "Thinking Mode",
        submenu: thinkingModeSubmenu,
    });

    menu.push({
        label: "Max Output Tokens",
        submenu: maxTokensSubmenu,
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
