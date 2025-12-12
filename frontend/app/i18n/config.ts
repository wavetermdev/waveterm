// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";

i18n.use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources,
        fallbackLng: "en",
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
        detection: {
            order: ["localStorage", "navigator"],
            caches: ["localStorage"],
            lookupLocalStorage: "wave-language",
        },
        interpolation: {
            escapeValue: false, // React already escapes
        },
        react: {
            useSuspense: false, // 避免Electron环境下的Suspense问题
        },
    });

export default i18n;
