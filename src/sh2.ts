import * as React from "react";
import {createRoot} from 'react-dom/client';
import {sprintf} from "sprintf-js";
import {Terminal} from 'xterm';
import {Main} from "./main";
import {WSControl} from "./ws";
import {GlobalModel} from "./model";
import {v4 as uuidv4} from "uuid";

// @ts-ignore
let VERSION = __SHVERSION__;

document.addEventListener("DOMContentLoaded", () => {
    let reactElem = React.createElement(Main, null, null);
    let elem = document.getElementById("app");
    let root = createRoot(elem);
    root.render(reactElem);
});

console.log("SCRIPTHAUS", VERSION)
