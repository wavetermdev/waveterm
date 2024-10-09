// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { WebView, WebViewModel } from "@/app/view/webview/webview";
import { NodeModel } from "@/layout/index";
import { atom } from "jotai";
import "./helpview.less";

class HelpViewModel extends WebViewModel {
    constructor(blockId: string, nodeModel: NodeModel) {
        super(blockId, nodeModel);
        this.getSettingsMenuItems = undefined;
        this.viewText = atom((get) => {
            // force a dependency on meta.url so we re-render the buttons when the url changes
            let url = get(this.blockAtom)?.meta?.url || get(this.homepageUrl);
            return [
                {
                    elemtype: "iconbutton",
                    icon: "chevron-left",
                    click: this.handleBack.bind(this),
                    disabled: this.shouldDisableBackButton(),
                },
                {
                    elemtype: "iconbutton",
                    icon: "chevron-right",
                    click: this.handleForward.bind(this),
                    disabled: this.shouldDisableForwardButton(),
                },
                {
                    elemtype: "iconbutton",
                    icon: "house",
                    click: this.handleHome.bind(this),
                    disabled: this.shouldDisableHomeButton(),
                },
            ];
        });
        this.homepageUrl = atom(getApi().getDocsiteUrl());
        this.viewType = "help";
        this.viewIcon = atom("circle-question");
        this.viewName = atom("Help");
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
