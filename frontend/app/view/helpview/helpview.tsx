// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { useState } from "react";
import "./helpview.less";

class HelpViewModel implements ViewModel {
    viewType: string;

    constructor() {
        this.viewType = "help";
    }
}

function makeHelpViewModel() {
    return new HelpViewModel();
}

function HelpView({}: { model: HelpViewModel }) {
    const [url] = useState(() => getApi().getDocsiteUrl());
    console.log(url);
    return (
        <div className="help-view">
            <webview className="docsite-webview" src={url} />
        </div>
    );
}

export { HelpView, HelpViewModel, makeHelpViewModel };
