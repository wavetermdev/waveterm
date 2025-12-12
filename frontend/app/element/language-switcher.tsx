// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import "./language-switcher.scss";

interface Language {
    code: string;
    name: string;
    nativeName: string;
}

const SUPPORTED_LANGUAGES: Language[] = [
    { code: "en", name: "English", nativeName: "English" },
    { code: "zh-CN", name: "Chinese Simplified", nativeName: "简体中文" },
];

const LanguageSwitcher = memo(() => {
    const { i18n } = useTranslation();

    const handleLanguageChange = (langCode: string) => {
        i18n.changeLanguage(langCode);
    };

    const currentLanguage = SUPPORTED_LANGUAGES.find((lang) => lang.code === i18n.language) || SUPPORTED_LANGUAGES[0];

    return (
        <div className="language-switcher">
            <select
                value={i18n.language}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="language-select"
            >
                {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                        {lang.nativeName}
                    </option>
                ))}
            </select>
        </div>
    );
});

LanguageSwitcher.displayName = "LanguageSwitcher";

export { LanguageSwitcher };
