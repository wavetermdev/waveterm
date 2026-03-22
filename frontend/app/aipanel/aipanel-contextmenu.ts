// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { isDev } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WaveAIModel } from "./waveai-model";

async function activateByokPreset(presetKey: string, secretName: string | null, secretLabel: string | null) {
    const model = WaveAIModel.getInstance();

    if (secretName && secretLabel) {
        globalStore.set(model.showApiKeyInput, { presetKey, secretName, secretLabel });
    } else {
        // Local model (Ollama) - check if endpoint is reachable
        try {
            const resp = await fetch("http://localhost:11434/api/tags");
            if (!resp.ok) throw new Error("not reachable");
            // Mark as enabled and switch
            await RpcApi.SetSecretsCommand(TabRpcClient, { "byok_local_enabled": "true" });
            model.setAIMode(presetKey);
        } catch {
            model.setError("Ollama is not running. Start it with: ollama serve");
        }
    }
}

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

    const defaultTokens = model.inBuilder ? 24576 : 4096;
    const currentMaxTokens = rtInfo?.["waveai:maxoutputtokens"] ?? defaultTokens;

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
        label: "Max Output Tokens",
        submenu: maxTokensSubmenu,
    });

    menu.push({ type: "separator" });

    const mcpEnabled = globalStore.get(model.mcpContextAtom);
    if (mcpEnabled) {
        menu.push({
            label: "Disconnect MCP",
            click: () => {
                model.setMCPContext(false);
            },
        });
    } else {
        menu.push({
            label: "Connect MCP...",
            click: () => {
                globalStore.set(model.showMCPConnectInput, true);
                setTimeout(() => model.focusInput(), 0);
            },
        });
    }

    menu.push({ type: "separator" });

    const quickAddModels: ContextMenuItem[] = [
        {
            label: "Claude (Anthropic)",
            click: () => activateByokPreset("byok@claude-sonnet", "anthropic-api-key", "Anthropic API Key"),
        },
        {
            label: "GPT-5 (OpenAI)",
            click: () => activateByokPreset("byok@gpt5-mini", "openai-api-key", "OpenAI API Key"),
        },
        {
            label: "Gemini (Google)",
            click: () => activateByokPreset("byok@gemini-flash", "google-ai-key", "Google AI API Key"),
        },
        {
            label: "MiniMax",
            click: () => activateByokPreset("byok@minimax", "minimax-api-key", "MiniMax API Key"),
        },
        {
            label: "Ollama (Local)",
            click: () => activateByokPreset("byok@ollama", null, null),
        },
        {
            label: "OpenRouter",
            click: () => activateByokPreset("byok@openrouter", "openrouter-api-key", "OpenRouter API Key"),
        },
    ];

    menu.push({
        label: "Quick Add Model",
        submenu: quickAddModels,
    });

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

    ContextMenuModel.getInstance().showContextMenu(menu, e);
}
