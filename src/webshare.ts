import * as mobx from "mobx";
import * as React from "react";
import {createRoot} from 'react-dom/client';
import {sprintf} from "sprintf-js";
import {WebShareMain} from "./webshare-elems";

document.addEventListener("DOMContentLoaded", () => {
    let elem = document.getElementById("app");
    let root = createRoot(elem);
    let reactElem = React.createElement(WebShareMain, null, null);
    root.render(reactElem);
});

(window as any).mobx = mobx;
(window as any).sprintf = sprintf;
