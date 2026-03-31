// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import i18n from "@/app/i18n/i18n-next";
import { useT } from "@/app/i18n/index";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { base64ToString, stringToBase64 } from "@/util/util";
import * as jotai from "jotai";
import { useState } from "react";

export function SettingsContent({ model }: { model: WaveConfigViewModel }) {
    const t = useT();
    const fullConfig = jotai.useAtomValue(model.env.atoms.fullConfigAtom);
    const [fileContent, setFileContent] = jotai.useAtom(model.fileContentAtom);
    const [isUpdating, setIsUpdating] = useState(false);

    const currentSettings = fileContent ? JSON.parse(fileContent) : {};
    const remoteTmuxResumeEnabled = fullConfig?.settings?.["term:remotetmuxresume"] ?? true;
    const currentLanguage = currentSettings["app:language"] || "en";

    const refreshConfig = async () => {
        const refreshed = await model.env.rpc.FileReadCommand(TabRpcClient, {
            info: { path: `${model.configDir}/settings.json` },
        });
        const content = refreshed?.data64 ? base64ToString(refreshed.data64) : "";
        return JSON.parse(content || "{}");
    };

    const setLanguage = async (newLang: string) => {
        if (newLang === currentLanguage || isUpdating) return;
        setIsUpdating(true);
        globalStore.set(model.errorMessageAtom, null);

        try {
            const fullPath = `${model.configDir}/settings.json`;
            const updatedSettings = { ...currentSettings, "app:language": newLang };
            const updatedContent = JSON.stringify(updatedSettings, null, 2);

            await model.env.rpc.FileWriteCommand(TabRpcClient, {
                info: { path: fullPath },
                data64: stringToBase64(updatedContent),
            });

            globalStore.set(model.fileContentAtom, updatedContent);

            await i18n.changeLanguage(newLang);
        } catch (e: any) {
            globalStore.set(model.errorMessageAtom, e?.message ? String(e.message) : String(e));
        } finally {
            setIsUpdating(false);
        }
    };

    const setRemoteTmuxResume = async (enabled: boolean) => {
        if (enabled === remoteTmuxResumeEnabled || isUpdating) return;
        setIsUpdating(true);
        globalStore.set(model.errorMessageAtom, null);

        try {
            const fullPath = `${model.configDir}/settings.json`;
            const updatedSettings = { ...currentSettings, "term:remotetmuxresume": enabled };
            const updatedContent = JSON.stringify(updatedSettings, null, 2);

            await model.env.rpc.FileWriteCommand(TabRpcClient, {
                info: { path: fullPath },
                data64: stringToBase64(updatedContent),
            });

            globalStore.set(model.fileContentAtom, updatedContent);

            const configUpdated = await refreshConfig();
            globalStore.set(model.env.atoms.fullConfigAtom, { ...fullConfig, settings: configUpdated });
        } catch (e: any) {
            globalStore.set(model.errorMessageAtom, e?.message ? String(e.message) : String(e));
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 p-6 h-full overflow-auto">
            <div className="flex flex-col gap-1">
                <div className="text-lg font-semibold">{t("settings.language")}</div>
                <div className="text-sm text-muted-foreground">{t("settings.language.description")}</div>
            </div>

            <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="radio"
                        name="app-language"
                        checked={currentLanguage === "en"}
                        disabled={isUpdating}
                        onChange={() => setLanguage("en")}
                    />
                    <span className="text-sm">{t("settings.language.english")}</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="radio"
                        name="app-language"
                        checked={currentLanguage === "zh-CN"}
                        disabled={isUpdating}
                        onChange={() => setLanguage("zh-CN")}
                    />
                    <span className="text-sm">{t("settings.language.chinese")}</span>
                </label>
            </div>

            <div className="flex flex-col gap-1">
                <div className="text-lg font-semibold">{t("settings.remoteTmuxResume")}</div>
                <div className="text-sm text-muted-foreground">{t("settings.remoteTmuxResume.description")}</div>
            </div>

            <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={remoteTmuxResumeEnabled}
                        disabled={isUpdating}
                        onChange={(e) => setRemoteTmuxResume(e.target.checked)}
                    />
                    <span className="text-sm">{t("settings.remoteTmuxResume.toggle")}</span>
                </label>
            </div>
        </div>
    );
}
