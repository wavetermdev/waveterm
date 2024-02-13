// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { sprintf } from "sprintf-js";
import { App } from "@/app/app";
import * as DOMPurify from "dompurify";
import { loadFonts } from "./util/util";

// @ts-ignore
let VERSION = __WAVETERM_VERSION__;
// @ts-ignore
let BUILD = __WAVETERM_BUILD__;

loadFonts();

document.addEventListener("DOMContentLoaded", () => {
    let reactElem = React.createElement(App, null, null);
    let elem = document.getElementById("app");
    let root = createRoot(elem);
    let isFontLoaded = document.fonts.check("12px 'JetBrains Mono'");
    if (isFontLoaded) {
        root.render(reactElem);
    } else {
        document.fonts.ready.then(() => {
            root.render(reactElem);
        });
    }
});

(window as any).mobx = mobx;
(window as any).sprintf = sprintf;
(window as any).DOMPurify = DOMPurify;

console.log("WaveTerm", VERSION, BUILD);
