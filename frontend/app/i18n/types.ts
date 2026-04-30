// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type Locale = "en-US" | "zh-CN" | "ja-JP";

export type I18nParams = Record<string, string | number | boolean | null | undefined>;

export type I18nCatalog = Record<string, string>;

export type LocaleOption = {
    locale: Locale;
    label: string;
};
