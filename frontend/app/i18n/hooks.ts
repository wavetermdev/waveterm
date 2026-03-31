// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import i18n from "@/app/i18n/i18n-next";
import { atoms } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

export function useT(): (key: string, vars?: Record<string, any>) => string {
    const { t } = useTranslation();
    return useCallback(
        (key: string, vars?: Record<string, any>) => {
            const result = t(key, vars) as string;
            if (result === key) {
                const parts = key.split(".");
                if (parts.length > 1) {
                    const ns = parts[0];
                    const nsKey = parts.slice(1).join(".");
                    const nsResult = t(nsKey, { ...vars, ns }) as string;
                    if (nsResult !== nsKey) {
                        return nsResult;
                    }
                }
            }
            return result;
        },
        [t]
    );
}

export function useAppLanguage(): string {
    const settings = useAtomValue(atoms.settingsAtom);
    const lang = settings?.["app:language"] || "en";
    const { i18n } = useTranslation();
    if (i18n.language !== lang) {
        i18n.changeLanguage(lang);
    }
    return i18n.language;
}

export function initLanguageFromSettings() {
    try {
        const settingsStr = localStorage.getItem("settings") || "{}";
        const settings = JSON.parse(settingsStr);
        const lang = settings?.["app:language"] || "zh-CN";
        i18n.changeLanguage(lang);
    } catch (e) {
        i18n.changeLanguage("zh-CN");
    }
}
