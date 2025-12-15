// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getFilteredAIModeConfigs, getModeDisplayName } from "@/app/aipanel/ai-utils";
import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { atoms, getSettingsKeyAtom, isDev } from "@/app/store/global";
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
    const aiModeConfigs = globalStore.get(model.aiModeConfigs);
    const showCloudModes = globalStore.get(getSettingsKeyAtom("waveai:showcloudmodes"));
    const currentAIMode = rtInfo?.["waveai:mode"] ?? (hasPremium ? "waveai@balanced" : "waveai@quick");
    const defaultTokens = model.inBuilder ? 24576 : 4096;
    const currentMaxTokens = rtInfo?.["waveai:maxoutputtokens"] ?? defaultTokens;

    const { waveProviderConfigs, otherProviderConfigs } = getFilteredAIModeConfigs(
        aiModeConfigs,
        showCloudModes,
        model.inBuilder,
        hasPremium
    );

    const aiModeSubmenu: ContextMenuItem[] = [];

    if (waveProviderConfigs.length > 0) {
        aiModeSubmenu.push({
            label: "Wave AI Modes",
            type: "header",
            enabled: false,
        });

        waveProviderConfigs.forEach(({ mode, ...config }) => {
            const isPremium = config["waveai:premium"] === true;
            const isEnabled = !isPremium || hasPremium;
            aiModeSubmenu.push({
                label: getModeDisplayName(config),
                type: "checkbox",
                checked: currentAIMode === mode,
                enabled: isEnabled,
                click: () => {
                    if (!isEnabled) return;
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "waveai:mode": mode },
                    });
                },
            });
        });
    }

    if (otherProviderConfigs.length > 0) {
        if (waveProviderConfigs.length > 0) {
            aiModeSubmenu.push({ type: "separator" });
        }

        aiModeSubmenu.push({
            label: "Custom Modes",
            type: "header",
            enabled: false,
        });

        otherProviderConfigs.forEach(({ mode, ...config }) => {
            const isPremium = config["waveai:premium"] === true;
            const isEnabled = !isPremium || hasPremium;
            aiModeSubmenu.push({
                label: getModeDisplayName(config),
                type: "checkbox",
                checked: currentAIMode === mode,
                enabled: isEnabled,
                click: () => {
                    if (!isEnabled) return;
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "waveai:mode": mode },
                    });
                },
            });
        });
    }

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
        label: "AI Mode",
        submenu: aiModeSubmenu,
    });

    menu.push({
        label: "Max Output Tokens",
        submenu: maxTokensSubmenu,
    });

    menu.push({ type: "separator" });

    menu.push({
        label: "Configure Modes",
        click: () => {
            RpcApi.RecordTEventCommand(
                TabRpcClient,
                {
                    event: "action:other",
                    props: {
                        "action:type": "waveai:configuremodes:contextmenu",
                    },
                },
                { noresponse: true }
            );
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
