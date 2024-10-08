// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { WebView, WebViewModel } from "@/app/view/webview/webview";
import { NodeModel } from "@/layout/index";
import { WebviewTag } from "electron";
import { atom } from "jotai";
import { createRef } from "react";
import "./helpview.less";

class HelpViewModel extends WebViewModel {
    viewType: string;
    blockId: string;
    webviewRef: React.RefObject<WebviewTag>;

    constructor(blockId: string, nodeModel: NodeModel) {
        super(blockId, nodeModel);
        this.getSettingsMenuItems = undefined;
        this.viewText = atom([
            {
                elemtype: "iconbutton",
                icon: "house",
                click: this.handleHome.bind(this),
                disabled: this.shouldDisabledHomeButton(),
            },
        ]);
        this.homepageUrl = atom(getApi().getDocsiteUrl());
        this.viewType = "help";
        this.blockId = blockId;
        this.viewIcon = atom("circle-question");
        this.viewName = atom("Help");
        this.webviewRef = createRef<WebviewTag>();
    }
}

function makeHelpViewModel(blockId: string, nodeModel: NodeModel) {
    return new HelpViewModel(blockId, nodeModel);
}

function HelpView({ model }: { model: HelpViewModel }) {
    return (
        <div className="help-view">
            <WebView blockId={model.blockId} model={model} />
        </div>
    );
}

export { HelpView, HelpViewModel, makeHelpViewModel };
