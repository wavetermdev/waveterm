// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from "vitest";
import { getI18nLocale, resolveLocale, setI18nLocale, supportedLocales, t } from "./index";

describe("i18n", () => {
    afterEach(() => {
        setI18nLocale("en-US");
    });

    it("defaults to English source strings", () => {
        setI18nLocale("en-US");
        expect(getI18nLocale()).toBe("en-US");
        expect(t("Save")).toBe("Save");
        expect(t("Open File...")).toBe("Open File...");
    });

    it("returns Simplified Chinese translations", () => {
        setI18nLocale("zh-CN");
        expect(t("Save")).toBe("保存");
        expect(t("Open File...")).toBe("打开文件...");
    });

    it("returns Japanese translations", () => {
        setI18nLocale("ja-JP");
        expect(t("Save")).toBe("保存");
        expect(t("Open File...")).toBe("ファイルを開く...");
    });

    it("translates quick tips and language menu labels", () => {
        setI18nLocale("zh-CN");
        expect(t("Header Icons")).toBe("标题栏图标");
        expect(t("Tab Switching ({modifier})", { modifier: "Cmd" })).toBe("标签切换（Cmd）");
        expect(t("System default")).toBe("跟随系统");
        expect(supportedLocales.map((option) => t(option.label))).toEqual(["英文", "简体中文", "日文"]);

        setI18nLocale("ja-JP");
        expect(t("Header Icons")).toBe("ヘッダーアイコン");
        expect(t("Tab Switching ({modifier})", { modifier: "Cmd" })).toBe("タブ切り替え（Cmd）");
        expect(t("System default")).toBe("システム既定");
        expect(supportedLocales.map((option) => t(option.label))).toEqual(["英語", "簡体字中国語", "日本語"]);
    });

    it("interpolates translated messages", () => {
        setI18nLocale("zh-CN");
        expect(t("Client Version {version}", { version: "0.14.5" })).toBe("客户端版本 0.14.5");
        expect(t("Open Clipboard URL ({host})", { host: "example.com" })).toBe("打开剪贴板 URL（example.com）");
    });

    it("falls back to the original key when a translation is missing", () => {
        setI18nLocale("zh-CN");
        expect(t("Untranslated UI String")).toBe("Untranslated UI String");
    });

    it("resolves supported system locales", () => {
        expect(resolveLocale("system", "zh-Hans-CN")).toBe("zh-CN");
        expect(resolveLocale(null, "ja-JP")).toBe("ja-JP");
        expect(resolveLocale("en", "zh-CN")).toBe("en-US");
        expect(resolveLocale("fr-FR", "fr-FR")).toBe("en-US");
    });
});
