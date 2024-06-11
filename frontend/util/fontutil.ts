// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

let isJetBrainsMonoLoaded = false;
let isLatoFontLoaded = false;
let isHackFontLoaded = false;
let isBaseFontsLoaded = false;
let isFiraCodeLoaded = false;

function addToFontFaceSet(fontFaceSet: FontFaceSet, fontFace: FontFace) {
    // any cast to work around typing issue
    (fontFaceSet as any).add(fontFace);
}

function loadJetBrainsMonoFont() {
    if (isJetBrainsMonoLoaded) {
        return;
    }
    isJetBrainsMonoLoaded = true;
    const jbmFontNormal = new FontFace("JetBrains Mono", "url('/fonts/jetbrains-mono-v13-latin-regular.woff2')", {
        style: "normal",
        weight: "400",
    });
    const jbmFont200 = new FontFace("JetBrains Mono", "url('/fonts/jetbrains-mono-v13-latin-200.woff2')", {
        style: "normal",
        weight: "200",
    });
    const jbmFont700 = new FontFace("JetBrains Mono", "url('/fonts/jetbrains-mono-v13-latin-700.woff2')", {
        style: "normal",
        weight: "700",
    });
    addToFontFaceSet(document.fonts, jbmFontNormal);
    addToFontFaceSet(document.fonts, jbmFont200);
    addToFontFaceSet(document.fonts, jbmFont700);
    jbmFontNormal.load();
    jbmFont200.load();
    jbmFont700.load();
}

function loadLatoFont() {
    if (isLatoFontLoaded) {
        return;
    }
    isLatoFontLoaded = true;
    const latoFont = new FontFace("Lato", "url('/fonts/lato-regular.woff')", {
        style: "normal",
        weight: "400",
    });
    const latoFontBold = new FontFace("Lato", "url('/fonts/lato-bold.woff')", {
        style: "normal",
        weight: "700",
    });
    addToFontFaceSet(document.fonts, latoFont);
    addToFontFaceSet(document.fonts, latoFontBold);
    latoFont.load();
    latoFontBold.load();
}

function loadFiraCodeFont() {
    if (isFiraCodeLoaded) {
        return;
    }
    isFiraCodeLoaded = true;
    const firaCodeRegular = new FontFace("Fira Code", "url('/fonts/firacode-regular.woff2')", {
        style: "normal",
        weight: "400",
    });
    const firaCodeBold = new FontFace("Fira Code", "url('/fonts/firacode-bold.woff2')", {
        style: "normal",
        weight: "700",
    });
    addToFontFaceSet(document.fonts, firaCodeRegular);
    addToFontFaceSet(document.fonts, firaCodeBold);
    firaCodeRegular.load();
    firaCodeBold.load();
}

function loadHackFont() {
    if (isHackFontLoaded) {
        return;
    }
    isHackFontLoaded = true;
    const hackRegular = new FontFace("Hack", "url('/fonts/hack-regular.woff2')", {
        style: "normal",
        weight: "400",
    });
    const hackBold = new FontFace("Hack", "url('/fonts/hack-bold.woff2')", {
        style: "normal",
        weight: "700",
    });
    const hackItalic = new FontFace("Hack", "url('/fonts/hack-italic.woff2')", {
        style: "italic",
        weight: "400",
    });
    const hackBoldItalic = new FontFace("Hack", "url('/fonts/hack-bolditalic.woff2')", {
        style: "italic",
        weight: "700",
    });
    addToFontFaceSet(document.fonts, hackRegular);
    addToFontFaceSet(document.fonts, hackBold);
    addToFontFaceSet(document.fonts, hackItalic);
    addToFontFaceSet(document.fonts, hackBoldItalic);
    hackRegular.load();
    hackBold.load();
    hackItalic.load();
    hackBoldItalic.load();
}

function loadBaseFonts() {
    if (isBaseFontsLoaded) {
        return;
    }
    isBaseFontsLoaded = true;
    const mmFont = new FontFace("Martian Mono", "url(/fonts/MartianMono-VariableFont_wdth,wght.ttf)", {
        style: "normal",
        weight: "normal",
    });
    addToFontFaceSet(document.fonts, mmFont);
    mmFont.load();
}

function loadFonts() {
    loadBaseFonts();
    loadLatoFont();
    loadJetBrainsMonoFont();
    loadHackFont();
    loadFiraCodeFont();
}

export { loadFonts };
