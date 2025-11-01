// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WaveAIModel } from "./waveai-model";

export async function handleWaveAIContextMenu(e: React.MouseEvent, onClose?: () => void): Promise<void> {
    e.preventDefault();
    e.stopPropagation();

    const model = WaveAIModel.getInstance();
    const menu: ContextMenuItem[] = [];

    const hasSelection = waveAIHasSelection();
    if (hasSelection) {
        menu.push({
            role: "copy",
        });
        menu.push({ type: "separator" });
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

    const currentThinkingLevel = rtInfo?.["waveai:thinkinglevel"] ?? "medium";
    const defaultTokens = model.inBuilder ? 24576 : 4096;
    const currentMaxTokens = rtInfo?.["waveai:maxoutputtokens"] ?? defaultTokens;

    const thinkingLevelSubmenu: ContextMenuItem[] = [
        {
            label: "Low",
            type: "checkbox",
            checked: currentThinkingLevel === "low",
            click: () => {
                RpcApi.SetRTInfoCommand(TabRpcClient, {
                    oref: model.orefContext,
                    data: { "waveai:thinkinglevel": "low" },
                });
            },
        },
        {
            label: "Medium",
            type: "checkbox",
            checked: currentThinkingLevel === "medium",
            click: () => {
                RpcApi.SetRTInfoCommand(TabRpcClient, {
                    oref: model.orefContext,
                    data: { "waveai:thinkinglevel": "medium" },
                });
            },
        },
        {
            label: "High",
            type: "checkbox",
            checked: currentThinkingLevel === "high",
            click: () => {
                RpcApi.SetRTInfoCommand(TabRpcClient, {
                    oref: model.orefContext,
                    data: { "waveai:thinkinglevel": "high" },
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
        label: "Thinking Level",
        submenu: thinkingLevelSubmenu,
    });

    menu.push({
        label: "Max Output Tokens",
        submenu: maxTokensSubmenu,
    });

    menu.push({ type: "separator" });

    menu.push({
        label: "Hide Wave AI",
        click: () => {
            onClose?.();
        },
    });

    ContextMenuModel.showContextMenu(menu, e);
}