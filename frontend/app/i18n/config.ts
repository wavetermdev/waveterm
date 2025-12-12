// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/store/global";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";

// 自定义语言检测器,从Wave settings读取
const waveSettingsDetector = {
    name: "waveSettings",
    lookup() {
        // 尝试从全局store获取settings中的language配置
        try {
            const globalStore = (window as any).globalStore;
            const settingsAtom = (window as any).globalAtoms?.settingsAtom;
            if (globalStore && settingsAtom) {
                const settings = globalStore.get(settingsAtom);
                return settings?.["app:language"] || null;
            }
        } catch (e) {
            // Settings可能还未初始化
            console.debug("Wave settings not yet initialized for i18n");
        }
        return null;
    },
};

i18n.use({
    type: "languageDetector",
    init: () => {},
    detect: () => {
        // 优先级: Wave settings > localStorage > 系统语言
        const settingsLang = waveSettingsDetector.lookup();
        if (settingsLang) {
            return settingsLang;
        }
        const storedLang = localStorage.getItem("wave-language");
        if (storedLang) {
            return storedLang;
        }
        return navigator.language || "en";
    },
    cacheUserLanguage: (lng: string) => {
        localStorage.setItem("wave-language", lng);
    },
})
    .use(initReactI18next)
    .init({
        resources,
        fallbackLng: "en",
        supportedLngs: ["en", "zh-CN"],
        defaultNS: "common",
        ns: [
            "common",
            "editor",
            "terminal",
            "ai",
            "settings",
            "modals",
            "notifications",
            "onboarding",
            "errors",
            "help",
        ],
        interpolation: {
            escapeValue: false, // React already escapes
        },
        react: {
            useSuspense: false, // 避免Electron环境下的Suspense问题
        },
    });

export default i18n;
