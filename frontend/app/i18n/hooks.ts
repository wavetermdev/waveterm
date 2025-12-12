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

    useEffect(() => {
        const settingsLang = settings?.["app:language"];
        if (settingsLang && settingsLang !== i18n.language) {
            i18n.changeLanguage(settingsLang);
        }
    }, [settings, i18n]);
}
