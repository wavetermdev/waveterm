// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as util from "@/util/util";

function computeTheme(settings: SettingsConfigType, themeName: string): TermThemeType {
    let defaultThemeName = "default-dark";
    themeName = themeName ?? "default-dark";
    const defaultTheme: TermThemeType = settings?.termthemes?.[defaultThemeName] || ({} as any);
    const theme: TermThemeType = settings?.termthemes?.[themeName] || ({} as any);
    const combinedTheme = { ...defaultTheme };
    for (const key in theme) {
        if (!util.isBlank(theme[key])) {
            combinedTheme[key] = theme[key];
        }
    }
    return combinedTheme;
}

export { computeTheme };
