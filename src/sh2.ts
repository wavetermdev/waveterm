import * as React from "react";
import {createRoot} from 'react-dom/client';
import {sprintf} from "sprintf-js";
import {Terminal} from 'xterm';
import {Main} from "./main";
import {GlobalWS} from "./ws";

let VERSION = __SHVERSION__;

document.addEventListener("DOMContentLoaded", () => {
    GlobalWS.reconnect();
    let reactElem = React.createElement(Main, null, null);
    let elem = document.getElementById("main");
    let root = createRoot(elem);
    root.render(reactElem);
});

console.log("SCRIPTHAUS", VERSION)
