// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getOverrideConfigAtom, getSettingsPrefixAtom, openLink } from "@/app/store/global";
import { TermViewModel } from "@/app/view/term/term";
import { TermElem, TermWrapOptions } from "@/element/termelem/termelem";
import { useAtomValue } from "jotai";

export function TermWrapElem({ blockId, model }: { blockId: string; model: TermViewModel }) {
    const termFontSize = useAtomValue(model.fontSizeAtom);
    const termSettingsAtom = getSettingsPrefixAtom("term");
    const termSettings = useAtomValue(termSettingsAtom);
    const termFontSizeAtom = getOverrideConfigAtom(blockId, "term:fontsize");
    const termFontFamilyAtom = getOverrideConfigAtom(blockId, "term:fontfamily");

    let termOpts: TermWrapOptions = {
        xtermOpts: {
            drawBoldTextInBrightColors: false,
            fontWeight: "normal",
            fontWeightBold: "bold",
            allowTransparency: true,
        },
        useWebGl: !termSettings?.["term:disablewebgl"],
        useWebLinksAddon: true,
        useSerializeAddon: true,
        onOpenLink: openLink,
        keydownHandler: model.handleTerminalKeydown.bind(model),
        termThemeAtom: model.termThemeAtom,
        termFontFamily: termFontFamilyAtom,
        termFontSize: termFontSizeAtom,
    };
    return <TermElem termOpts={termOpts} />;
}
