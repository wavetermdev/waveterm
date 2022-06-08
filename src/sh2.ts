import * as React from "react";
import {createRoot} from 'react-dom/client';
import {sprintf} from "sprintf-js";
import {Terminal} from 'xterm';
import {Main} from "./main";

let VERSION = __SHVERSION__;
let terminal = null;

document.addEventListener("DOMContentLoaded", () => {
    let reactElem = React.createElement(Main, {sessionid: "AQ45MM"}, null);
    let elem = document.getElementById("main");
    let root = createRoot(elem);
    root.render(reactElem);
});

console.log("SCRIPTHAUS", VERSION)
