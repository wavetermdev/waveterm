// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as util from "@/util/util";

function computeTheme(fullConfig: FullConfigType, themeName: string): TermThemeType {
    let defaultThemeName = "default-dark";
    themeName = themeName ?? "default-dark";
    const defaultTheme: TermThemeType = fullConfig?.termthemes?.[defaultThemeName] || ({} as any);
    const theme: TermThemeType = fullConfig?.termthemes?.[themeName] || ({} as any);
    const combinedTheme = { ...defaultTheme };
    for (const key in theme) {
        if (!util.isBlank(theme[key])) {
            combinedTheme[key] = theme[key];
        }
    }
    return combinedTheme;
}

export { computeTheme };
