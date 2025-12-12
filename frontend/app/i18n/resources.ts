// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 英文翻译
import aiEN from "@/locales/en/ai.json";
import commonEN from "@/locales/en/common.json";
import editorEN from "@/locales/en/editor.json";
import errorsEN from "@/locales/en/errors.json";
import helpEN from "@/locales/en/help.json";
import modalsEN from "@/locales/en/modals.json";
import notificationsEN from "@/locales/en/notifications.json";
import onboardingEN from "@/locales/en/onboarding.json";
import settingsEN from "@/locales/en/settings.json";
import terminalEN from "@/locales/en/terminal.json";

// 中文翻译
import aiZH from "@/locales/zh-CN/ai.json";
import commonZH from "@/locales/zh-CN/common.json";
import editorZH from "@/locales/zh-CN/editor.json";
import errorsZH from "@/locales/zh-CN/errors.json";
import helpZH from "@/locales/zh-CN/help.json";
import modalsZH from "@/locales/zh-CN/modals.json";
import notificationsZH from "@/locales/zh-CN/notifications.json";
import onboardingZH from "@/locales/zh-CN/onboarding.json";
import settingsZH from "@/locales/zh-CN/settings.json";
import terminalZH from "@/locales/zh-CN/terminal.json";

export const resources = {
    en: {
        common: commonEN,
        editor: editorEN,
        terminal: terminalEN,
        ai: aiEN,
        settings: settingsEN,
        modals: modalsEN,
        notifications: notificationsEN,
        onboarding: onboardingEN,
        errors: errorsEN,
        help: helpEN,
    },
    "zh-CN": {
        common: commonZH,
        editor: editorZH,
        terminal: terminalZH,
        ai: aiZH,
        settings: settingsZH,
        modals: modalsZH,
        notifications: notificationsZH,
        onboarding: onboardingZH,
        errors: errorsZH,
        help: helpZH,
    },
} as const;
