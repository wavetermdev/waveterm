// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const DefaultTermTheme = "default-dark";
import { colord } from "colord";

function applyTransparencyToColor(hexColor: string, transparency: number): string {
    const alpha = 1 - transparency; // transparency is already 0-1
    return colord(hexColor).alpha(alpha).toHex();
}

// returns (theme, bgcolor, transparency (0 - 1.0))
function computeTheme(
    fullConfig: FullConfigType,
    themeName: string,
    termTransparency: number
): [TermThemeType, string] {
    let theme: TermThemeType = fullConfig?.termthemes?.[themeName];
    if (theme == null) {
        theme = fullConfig?.termthemes?.[DefaultTermTheme] || ({} as any);
    }
    const themeCopy = { ...theme };
    if (termTransparency != null && termTransparency > 0) {
        if (themeCopy.background) {
            themeCopy.background = applyTransparencyToColor(themeCopy.background, termTransparency);
        }
        if (themeCopy.selectionBackground) {
            themeCopy.selectionBackground = applyTransparencyToColor(themeCopy.selectionBackground, termTransparency);
        }
    }
    let bgcolor = themeCopy.background;
    // Keep the actual background color in the theme so terminal applications
    // like Neovim can properly detect the background color for syntax highlighting
    return [themeCopy, bgcolor];
}

export { computeTheme };
