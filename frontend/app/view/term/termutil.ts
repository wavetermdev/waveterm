// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as util from "@/util/util";

export const DefaultTermTheme = "default-dark";

function computeTheme(fullConfig: FullConfigType, themeName: string): TermThemeType {
    themeName = themeName ?? DefaultTermTheme;
    const defaultTheme: TermThemeType = fullConfig?.termthemes?.[DefaultTermTheme] || ({} as any);
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
