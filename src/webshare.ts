import * as mobx from "mobx";
import * as React from "react";
import {createRoot} from 'react-dom/client';
import {sprintf} from "sprintf-js";
import {WebShareMain} from "./webshare-elems";
import {loadFonts} from "./util";
import {WebShareModel} from "./webshare-model";
import * as textmeasure from "./textmeasure";

// @ts-ignore
let PROMPT_DEV = __PROMPT_DEV__;
// @ts-ignore
let PROMPT_VERSION = __PROMPT_VERSION__;
// @ts-ignore
let PROMPT_BUILD = __PROMPT_BUILD__;

loadFonts();

document.addEventListener("DOMContentLoaded", () => {
    let elem = document.getElementById("app");
    let root = createRoot(elem);
    let reactElem = React.createElement(WebShareMain, null, null);
    let isFontLoaded = document.fonts.check("12px 'JetBrains Mono'");
    if (isFontLoaded) {
        root.render(reactElem);
    }
    else {
        document.fonts.ready.then(() => {
            root.render(reactElem);
        });
    }
});

(window as any).textmeasure = textmeasure;
(window as any).mobx = mobx;
(window as any).sprintf = sprintf;

console.log("PROMPT webshare", PROMPT_VERSION, PROMPT_BUILD);
