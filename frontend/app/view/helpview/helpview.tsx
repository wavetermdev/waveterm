// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { getApi } from "@/app/store/global";
import { WebView, WebViewModel } from "@/app/view/webview/webview";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { useCallback } from "react";
import "./helpview.less";

class HelpViewModel extends WebViewModel {
    constructor(blockId: string, nodeModel: BlockNodeModel) {
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

function makeHelpViewModel(blockId: string, nodeModel: BlockNodeModel) {
    return new HelpViewModel(blockId, nodeModel);
}

const baseUrlRegex = /http[s]?:\/\/([^:\/])+(:\d+)?/;

function HelpView({ model }: { model: HelpViewModel }) {
    const homepageUrl = useAtomValue(model.homepageUrl);

    // Effect to update the docsite base url when the app restarts, since the webserver port is dynamic
    const onFailLoad = useCallback(
        (url: string) =>
            fireAndForget(async () => {
                const newDocsiteUrl = getApi().getDocsiteUrl();

                // Correct the homepage URL, if necessary
                if (newDocsiteUrl !== homepageUrl) {
                    await model.setHomepageUrl(newDocsiteUrl, "block");
                }

                // Correct the base URL of the current page, if necessary
                const newBaseUrl = baseUrlRegex.exec(newDocsiteUrl)?.[0];
                const curBaseUrl = baseUrlRegex.exec(url)?.[0];
                console.log("fix-docsite-url", url, newDocsiteUrl, homepageUrl, curBaseUrl, newBaseUrl);
                if (curBaseUrl && newBaseUrl && curBaseUrl !== newBaseUrl) {
                    model.loadUrl(url.replace(curBaseUrl, newBaseUrl), "fix-fail-load");
                }
            }),
        [homepageUrl]
    );
    return (
        <div className="help-view">
            <WebView blockId={model.blockId} model={model} onFailLoad={onFailLoad} />
        </div>
    );
}

export { HelpView, HelpViewModel, makeHelpViewModel };
