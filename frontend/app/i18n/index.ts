// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { enUS } from "./en-US";
import { jaJP } from "./ja-JP";
import type { I18nCatalog, I18nParams, Locale, LocaleOption } from "./types";
import { zhCN } from "./zh-CN";

const DefaultLocale: Locale = "en-US";

const localeCatalogs: Record<Locale, I18nCatalog> = {
    "en-US": enUS,
    "zh-CN": zhCN,
    "ja-JP": jaJP,
};

export const supportedLocales: LocaleOption[] = [
    { locale: "en-US", label: "English" },
    { locale: "zh-CN", label: "Simplified Chinese" },
    { locale: "ja-JP", label: "Japanese" },
];

let currentLocale: Locale = DefaultLocale;

function interpolate(template: string, params?: I18nParams): string {
    if (params == null) {
        return template;
    }
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
        const value = params[key];
        if (value == null) {
            return match;
        }
        return String(value);
    });
}

export function normalizeLocale(locale?: string | null): Locale | null {
    if (locale == null || locale === "" || locale === "system") {
        return null;
    }
    const normalizedLocale = locale.replace("_", "-").toLowerCase();
    if (normalizedLocale === "en" || normalizedLocale === "en-us") {
        return "en-US";
    }
    if (normalizedLocale === "zh" || normalizedLocale === "zh-cn" || normalizedLocale.startsWith("zh-hans")) {
        return "zh-CN";
    }
    if (normalizedLocale === "ja" || normalizedLocale === "ja-jp") {
        return "ja-JP";
    }
    return null;
}

export function getSystemLocale(): string | null {
    return globalThis.navigator?.language ?? globalThis.navigator?.languages?.[0] ?? null;
}

export function resolveLocale(configuredLocale?: string | null, systemLocale = getSystemLocale()): Locale {
    return normalizeLocale(configuredLocale) ?? normalizeLocale(systemLocale) ?? DefaultLocale;
}

export function setI18nLocale(locale?: string | null): Locale {
    currentLocale = normalizeLocale(locale) ?? DefaultLocale;
    return currentLocale;
}

export function setI18nLocaleFromConfig(settings?: SettingsType | null, systemLocale = getSystemLocale()): Locale {
    return setI18nLocale(resolveLocale(settings?.["app:locale"], systemLocale));
}

export function getI18nLocale(): Locale {
    return currentLocale;
}

export function t(key: string, params?: I18nParams, locale: Locale = currentLocale): string {
    const catalog = localeCatalogs[locale] ?? localeCatalogs[DefaultLocale];
    return interpolate(catalog[key] ?? enUS[key] ?? key, params);
}

export type { I18nCatalog, I18nParams, Locale, LocaleOption };
export { enUS, jaJP, zhCN };
