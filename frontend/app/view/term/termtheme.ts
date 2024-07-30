// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TermWrap } from "@/app/view/term/termwrap";
import { atoms, WOS } from "@/store/global";
import * as util from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

interface TermThemeProps {
    blockId: string;
    termRef: React.RefObject<TermWrap>;
}

const TermThemeUpdater = ({ blockId, termRef }: TermThemeProps) => {
    const { termthemes } = useAtomValue(atoms.settingsConfigAtom);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    let defaultThemeName = "default-dark";
    let themeName = blockData.meta?.["term:theme"] ?? "default-dark";

    const defaultTheme: TermThemeType = termthemes?.[defaultThemeName] || ({} as any);
    const theme: TermThemeType = termthemes?.[themeName] || ({} as any);

    useEffect(() => {
        const combinedTheme = { ...defaultTheme };
        for (const key in theme) {
            if (!util.isBlank(theme[key])) {
                combinedTheme[key] = theme[key];
            }
        }
        if (termRef.current?.terminal) {
            termRef.current.terminal.options.theme = combinedTheme;
        }
    }, [defaultTheme, theme]);

    return null;
};

export { TermThemeUpdater };
