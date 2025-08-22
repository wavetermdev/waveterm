// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { getApi, globalStore, WOS } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WebView, WebViewModel } from "@/app/view/webview/webview";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { useCallback } from "react";

const docsiteWebUrl = "https://docs.waveterm.dev/";
const baseUrlRegex = /http[s]?:\/\/([^:\/])+(:\d+)?/;

class HelpViewModel extends WebViewModel {
    get viewComponent(): ViewComponent {
        return HelpView;
    }

    constructor(blockId: string, nodeModel: BlockNodeModel) {
        super(blockId, nodeModel);
        this.viewText = atom((get) => {
            // force a dependency on meta.url so we re-render the buttons when the url changes
            get(this.blockAtom)?.meta?.url || get(this.homepageUrl);
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

        /* 
        Add callback to take the current embedded docsite url and return the equivalent page in the public docsite.
        The port used by the embedded docsite changes every time the app runs and the current page may be cached from a previous run so we can't trust that it matches the current embedded url.
        We have a regex at the top of this file that can extract the base part of the url (i.e. http://127.0.0.1:53288). We'll use this regex to strip the base part of the url from both the current
        page and the embedded docsite url. Because we host the embedded docsite at a subdirectory, we also need to strip that (hence the second replace). Then, we can build the public url from whatever's left.
        */
        this.modifyExternalUrl = (url: string) => {
            const strippedDocsiteUrl = getApi().getDocsiteUrl().replace(baseUrlRegex, "");
            const strippedCurUrl = url.replace(baseUrlRegex, "").replace(strippedDocsiteUrl, "");
            const newUrl = docsiteWebUrl + strippedCurUrl;
            console.log("modify-external-url", url, newUrl);
            return newUrl;
        };
    }

    setZoomFactor(factor: number | null) {
        // null is ok (will reset to default)
        if (factor != null && factor < 0.1) {
            factor = 0.1;
        }
        if (factor != null && factor > 5) {
            factor = 5;
        }
        const domReady = globalStore.get(this.domReady);
        if (!domReady) {
            return;
        }
        this.webviewRef.current?.setZoomFactor(factor || 1);
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "web:zoom": factor }, // allow null so we can remove the zoom factor here
        });
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const zoomSubMenu: ContextMenuItem[] = [];
        let curZoom = 1;
        if (globalStore.get(this.domReady)) {
            curZoom = this.webviewRef.current?.getZoomFactor() || 1;
        }
        const model = this; // for the closure to work (this is getting unset)
        function makeZoomFactorMenuItem(label: string, factor: number): ContextMenuItem {
            return {
                label: label,
                type: "checkbox",
                click: () => {
                    model.setZoomFactor(factor);
                },
                checked: curZoom == factor,
            };
        }
        zoomSubMenu.push({
            label: "Reset",
            click: () => {
                model.setZoomFactor(null);
            },
        });
        zoomSubMenu.push(makeZoomFactorMenuItem("25%", 0.25));
        zoomSubMenu.push(makeZoomFactorMenuItem("50%", 0.5));
        zoomSubMenu.push(makeZoomFactorMenuItem("70%", 0.7));
        zoomSubMenu.push(makeZoomFactorMenuItem("80%", 0.8));
        zoomSubMenu.push(makeZoomFactorMenuItem("90%", 0.9));
        zoomSubMenu.push(makeZoomFactorMenuItem("100%", 1));
        zoomSubMenu.push(makeZoomFactorMenuItem("110%", 1.1));
        zoomSubMenu.push(makeZoomFactorMenuItem("120%", 1.2));
        zoomSubMenu.push(makeZoomFactorMenuItem("130%", 1.3));
        zoomSubMenu.push(makeZoomFactorMenuItem("150%", 1.5));
        zoomSubMenu.push(makeZoomFactorMenuItem("175%", 1.75));
        zoomSubMenu.push(makeZoomFactorMenuItem("200%", 2));

        return [
            {
                label: this.webviewRef.current?.isDevToolsOpened() ? "Close DevTools" : "Open DevTools",
                click: async () => {
                    if (this.webviewRef.current) {
                        if (this.webviewRef.current.isDevToolsOpened()) {
                            this.webviewRef.current.closeDevTools();
                        } else {
                            this.webviewRef.current.openDevTools();
                        }
                    }
                },
            },
            {
                label: "Set Zoom Factor",
                submenu: zoomSubMenu,
            },
        ];
    }
}

function HelpView(props: ViewComponentProps<HelpViewModel>) {
    const model = props.model;
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
                if (curBaseUrl && newBaseUrl && curBaseUrl !== newBaseUrl) {
                    model.loadUrl(url.replace(curBaseUrl, newBaseUrl), "fix-fail-load");
                }
            }),
        [homepageUrl]
    );
    return (
        <div className="w-full h-full">
            <WebView {...props} onFailLoad={onFailLoad} />
        </div>
    );
}

export { HelpViewModel };
