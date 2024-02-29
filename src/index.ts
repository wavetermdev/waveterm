// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { sprintf } from "sprintf-js";
import { App } from "@/app/app";
import * as DOMPurify from "dompurify";
import { loadFonts } from "@/util/fontutil";
import * as textmeasure from "@/util/textmeasure";
import { getApi } from "@/models";

// @ts-ignore
let VERSION = __WAVETERM_VERSION__;
// @ts-ignore
let BUILD = __WAVETERM_BUILD__;

let initialFontFamily = getApi().getInitialTermFontFamily();
if (initialFontFamily == null) {
    initialFontFamily = "JetBrains Mono";
}
loadFonts(initialFontFamily);

document.addEventListener("DOMContentLoaded", () => {
    let reactElem = React.createElement(App, null, null);
    let elem = document.getElementById("app");
    let root = createRoot(elem);
    document.fonts.ready.then(() => {
        root.render(reactElem);
    });
});

// put some items on the window for debugging
(window as any).mobx = mobx;
(window as any).sprintf = sprintf;
(window as any).DOMPurify = DOMPurify;
(window as any).textmeasure = textmeasure;

console.log("WaveTerm", VERSION, BUILD);
