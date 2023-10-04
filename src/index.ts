import * as mobx from "mobx";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { sprintf } from "sprintf-js";
import { Main } from "./main/Main";
import { loadFonts } from "./util/util";
import * as DOMPurify from "dompurify";

// @ts-ignore
let VERSION = __PROMPT_VERSION__;
// @ts-ignore
let BUILD = __PROMPT_BUILD__;

//loadFonts();

document.addEventListener("DOMContentLoaded", () => {
    let reactElem = React.createElement(Main, null, null);
    let elem = document.getElementById("app");
    let root = createRoot(elem);
    // @check:font
    // let isFontLoaded = document.fonts.check("12px 'JetBrains Mono'");
    document.fonts.ready.then(() => {
        root.render(reactElem);
    });
});

(window as any).mobx = mobx;
(window as any).sprintf = sprintf;
(window as any).DOMPurify = DOMPurify;

console.log("PROMPT", VERSION, BUILD);
