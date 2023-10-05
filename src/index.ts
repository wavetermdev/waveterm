import * as mobx from "mobx";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { sprintf } from "sprintf-js";
import { App } from "./app/app";
import * as DOMPurify from "dompurify";

// @ts-ignore
let VERSION = __PROMPT_VERSION__;
// @ts-ignore
let BUILD = __PROMPT_BUILD__;

document.addEventListener("DOMContentLoaded", () => {
    let reactElem = React.createElement(App, null, null);
    let elem = document.getElementById("app");
    let root = createRoot(elem);
    root.render(reactElem);
});

(window as any).mobx = mobx;
(window as any).sprintf = sprintf;
(window as any).DOMPurify = DOMPurify;

console.log("PROMPT", VERSION, BUILD);
