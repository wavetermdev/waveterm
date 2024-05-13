// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";

document.addEventListener("DOMContentLoaded", () => {
    let reactElem = React.createElement(App, null, null);
    let elem = document.getElementById("main");
    let root = createRoot(elem);
    document.fonts.ready.then(() => {
        root.render(reactElem);
    });
});
