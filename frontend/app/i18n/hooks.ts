// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

/**
 * Hook to sync i18n language with Wave settings
 * Automatically updates language when app:language setting changes
 */
export function useLanguageSync() {
    const { i18n } = useTranslation();
    const settings = useAtomValue(atoms.settingsAtom);
    const settingsLang = settings?.["app:language"];

    useEffect(() => {
        if (!settingsLang) {
            return;
        }

        // Filter out i18next special/debug codes (cimode, dev, etc.)
        const specialCodes = ["cimode", "dev"];
        const rawSupportedLangs = i18n.options?.supportedLngs || ["en", "zh-CN"];
        const supportedLangs = Array.isArray(rawSupportedLangs)
            ? rawSupportedLangs.filter((lang) => !specialCodes.includes(lang))
            : ["en", "zh-CN"];

        const isSupported = supportedLangs.includes(settingsLang);

        if (isSupported && settingsLang !== i18n.language) {
            i18n.changeLanguage(settingsLang).catch((error) => {
                console.error("Failed to change language:", error);
            });
        }
    }, [settingsLang, i18n]);
}
