// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const loadTranslations = () => {
    const translationModules: any = import.meta.glob("./translations/**/*.json", { eager: true });

    const resources: Record<string, Record<string, any>> = {};
    const namespaces: string[] = [];

    const namespaceSet = new Set<string>();

    for (const [path, module] of Object.entries(translationModules)) {
        const content = (module as any).default;

        const pathParts = path.replace("./translations/", "").split("/");
        const lng = pathParts[0];
        const ns = pathParts[1].replace(".json", "");

        if (!resources[lng]) {
            resources[lng] = {};
        }
        resources[lng][ns] = content;

        if (!namespaceSet.has(ns)) {
            namespaceSet.add(ns);
            namespaces.push(ns);
        }
    }

    return { resources, namespaces };
};

const { resources, namespaces } = loadTranslations();

i18n.use(initReactI18next).init({
    fallbackLng: "en",
    supportedLngs: ["en", "zh-CN"],
    resources,
    ns: namespaces,
    defaultNS: "common",
    interpolation: {
        escapeValue: false,
    },
    react: {
        useSuspense: false,
    },
});

export default i18n;
