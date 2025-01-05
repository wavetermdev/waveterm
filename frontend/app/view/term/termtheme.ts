// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TermViewModel } from "@/app/view/term/term";
import { computeTheme } from "@/app/view/term/termutil";
import { TermWrap } from "@/app/view/term/termwrap";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

interface TermThemeProps {
    blockId: string;
    termRef: React.RefObject<TermWrap>;
    model: TermViewModel;
}

const TermThemeUpdater = ({ blockId, model, termRef }: TermThemeProps) => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const blockTermTheme = useAtomValue(model.termThemeNameAtom);
    const transparency = useAtomValue(model.termTransparencyAtom);
    const [theme, _] = computeTheme(fullConfig, blockTermTheme, transparency);
    useEffect(() => {
        if (termRef.current?.terminal) {
            termRef.current.terminal.options.theme = theme;
        }
    }, [theme]);
    return null;
};

export { TermThemeUpdater };
