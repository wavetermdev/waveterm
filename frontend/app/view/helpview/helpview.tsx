// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { WebviewTag } from "electron";
import { createRef, useEffect, useState } from "react";
import "./helpview.less";

class HelpViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    webviewRef: React.RefObject<WebviewTag>;

    constructor(blockId: string) {
        this.viewType = "help";
        this.blockId = blockId;
        this.webviewRef = createRef<WebviewTag>();
    }
}

function makeHelpViewModel(blockId: string) {
    return new HelpViewModel(blockId);
}

function HelpView({ model }: { model: HelpViewModel }) {
    const [url] = useState(() => getApi().getDocsiteUrl());
    const [webContentsId, setWebContentsId] = useState(null);
    const [domReady, setDomReady] = useState(false);

    useEffect(() => {
        if (model.webviewRef.current && domReady) {
            const wcId = model.webviewRef.current.getWebContentsId?.();
            if (wcId) {
                setWebContentsId(wcId);
            }
        }
    }, [model.webviewRef.current, domReady]);

    useEffect(() => {
        const webview = model.webviewRef.current;
        if (!webview) {
            return;
        }
        const handleDomReady = () => {
            setDomReady(true);
        };
        webview.addEventListener("dom-ready", handleDomReady);
        return () => {
            webview.removeEventListener("dom-ready", handleDomReady);
        };
    });

    return (
        <div className="help-view">
            <webview
                ref={model.webviewRef}
                data-blockid={model.blockId}
                data-webcontentsid={webContentsId} // needed for emain
                className="docsite-webview"
                src={url}
            />
        </div>
    );
}

export { HelpView, HelpViewModel, makeHelpViewModel };
