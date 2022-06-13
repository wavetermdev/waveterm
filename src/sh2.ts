import * as React from "react";
import {createRoot} from 'react-dom/client';
import {sprintf} from "sprintf-js";
import {Terminal} from 'xterm';
import {Main} from "./main";

let VERSION = __SHVERSION__;
let terminal = null;
let sessionId = "47445c53-cfcf-4943-8339-2c04447f20a1";

document.addEventListener("DOMContentLoaded", () => {
    let reactElem = React.createElement(Main, {sessionid: sessionId}, null);
    let elem = document.getElementById("main");
    let root = createRoot(elem);
    root.render(reactElem);
});

console.log("SCRIPTHAUS", VERSION)
