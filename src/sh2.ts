import * as React from "react";
import {createRoot} from 'react-dom/client';
import {sprintf} from "sprintf-js";
import {Terminal} from 'xterm';
import {Main} from "./main";
import {GlobalWS} from "./ws";
import {v4 as uuidv4} from "uuid";
import {initSession} from "./session";

let VERSION = __SHVERSION__;

window.ScriptHausClientId = uuidv4();

document.addEventListener("DOMContentLoaded", () => {
    initSession();
    GlobalWS.reconnect();
    let reactElem = React.createElement(Main, null, null);
    let elem = document.getElementById("app");
    let root = createRoot(elem);
    root.render(reactElem);
});

console.log("SCRIPTHAUS", VERSION)
