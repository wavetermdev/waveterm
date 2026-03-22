// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useAtomValue } from "jotai";
import { memo, useCallback, useState } from "react";
import { WaveAIModel } from "./waveai-model";

export const ApiKeyInput = memo(() => {
    const model = WaveAIModel.getInstance();
    const inputData = useAtomValue(model.showApiKeyInput);
    const [apiKey, setApiKey] = useState("");
    const [saving, setSaving] = useState(false);

    const handleSave = useCallback(async () => {
        console.log("[apikeyinput] handleSave called", { apiKey: apiKey ? "***" : "empty", inputData });
        if (!apiKey.trim() || !inputData) {
            console.log("[apikeyinput] early return - missing data");
            return;
        }
        setSaving(true);
        try {
            console.log("[apikeyinput] saving secret:", inputData.secretName);
            await RpcApi.SetSecretsCommand(TabRpcClient, {
                [inputData.secretName]: apiKey.trim(),
            });
            console.log("[apikeyinput] secret saved, switching to mode:", inputData.presetKey);
            model.setAIMode(inputData.presetKey);
            globalStore.set(model.showApiKeyInput, null);
            setApiKey("");
        } catch (e) {
            console.error("[apikeyinput] Failed to save API key:", e);
        }
        setSaving(false);
    }, [apiKey, inputData, model]);

    const handleCancel = useCallback(() => {
        globalStore.set(model.showApiKeyInput, null);
        setApiKey("");
    }, [model]);

    if (!inputData) return null;

    return (
        <div className="mx-2 mt-2 p-2.5 bg-gray-800 border border-gray-600 rounded-lg text-xs">
            <div className="flex items-center gap-2 mb-2">
                <i className="fa fa-key text-accent-400" />
                <span className="text-gray-200">{inputData.secretLabel}</span>
            </div>
            <div className="flex gap-2">
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") handleSave();
                        if (e.key === "Escape") handleCancel();
                    }}
                    placeholder="sk-... or API key"
                    className="flex-1 bg-gray-900 text-gray-200 text-xs font-mono px-2 py-1.5 rounded border border-gray-600 focus:border-accent-500 focus:outline-none"
                    spellCheck={false}
                    autoFocus
                />
                <button
                    onClick={handleSave}
                    disabled={!apiKey.trim() || saving}
                    className="bg-accent-600 hover:bg-accent-500 disabled:bg-gray-600 text-white px-2.5 py-1 rounded text-xs cursor-pointer disabled:cursor-not-allowed transition-colors"
                >
                    {saving ? "Saving..." : "Save & Activate"}
                </button>
                <button
                    onClick={handleCancel}
                    className="text-gray-400 hover:text-white cursor-pointer transition-colors"
                >
                    <i className="fa fa-times" />
                </button>
            </div>
            <div className="text-gray-500 text-[10px] mt-1.5">
                Key is stored securely in Wave's secret store, not in config files.
            </div>
        </div>
    );
});

ApiKeyInput.displayName = "ApiKeyInput";
