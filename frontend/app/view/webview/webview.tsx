// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi, openLink } from "@/app/store/global";
import { getSimpleControlShiftAtom } from "@/app/store/keymodel";
import { NodeModel } from "@/layout/index";
import { WOS, globalStore } from "@/store/global";
import * as services from "@/store/services";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { fireAndForget } from "@/util/util";
import clsx from "clsx";
import { WebviewTag } from "electron";
import * as jotai from "jotai";
import React, { memo, useEffect, useState } from "react";
import "./webview.less";

export class WebViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    blockAtom: jotai.Atom<Block>;
    viewIcon: jotai.Atom<string | HeaderIconButton>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<HeaderElem[]>;
    url: jotai.PrimitiveAtom<string>;
    isUrlDirty: jotai.PrimitiveAtom<boolean>;
    urlInput: jotai.PrimitiveAtom<string>;
    urlInputFocused: jotai.PrimitiveAtom<boolean>;
    isLoading: jotai.PrimitiveAtom<boolean>;
    urlWrapperClassName: jotai.PrimitiveAtom<string>;
    refreshIcon: jotai.PrimitiveAtom<string>;
    webviewRef: React.RefObject<WebviewTag>;
    urlInputRef: React.RefObject<HTMLInputElement>;
    nodeModel: NodeModel;

    constructor(blockId: string, nodeModel: NodeModel) {
        this.nodeModel = nodeModel;
        this.viewType = "web";
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);

        this.url = jotai.atom("");
        this.isUrlDirty = jotai.atom(false);
        this.urlInput = jotai.atom("");
        this.urlWrapperClassName = jotai.atom("");
        this.urlInputFocused = jotai.atom(false);
        this.isLoading = jotai.atom(false);
        this.refreshIcon = jotai.atom("rotate-right");
        this.viewIcon = jotai.atom("globe");
        this.viewName = jotai.atom("Web");
        this.urlInputRef = React.createRef<HTMLInputElement>();
        this.webviewRef = React.createRef<WebviewTag>();

        this.viewText = jotai.atom((get) => {
            let url = get(this.blockAtom)?.meta?.url || "";
            if (url && !get(this.url)) {
                globalStore.set(this.url, url);
            }
            const urlIsDirty = get(this.isUrlDirty);
            if (urlIsDirty) {
                const currUrl = get(this.url);
                url = currUrl;
            }
            return [
                {
                    elemtype: "iconbutton",
                    className: this.shouldDisabledBackButton() ? "disabled" : "",
                    icon: "chevron-left",
                    click: this.handleBack.bind(this),
                },
                {
                    elemtype: "iconbutton",
                    className: this.shouldDisabledForwardButton() ? "disabled" : "",
                    icon: "chevron-right",
                    click: this.handleForward.bind(this),
                },
                {
                    elemtype: "div",
                    className: clsx("block-frame-div-url", get(this.urlWrapperClassName)),
                    onMouseOver: this.handleUrlWrapperMouseOver.bind(this),
                    onMouseOut: this.handleUrlWrapperMouseOut.bind(this),
                    children: [
                        {
                            elemtype: "input",
                            value: url,
                            ref: this.urlInputRef,
                            className: "url-input",
                            onChange: this.handleUrlChange.bind(this),
                            onKeyDown: this.handleKeyDown.bind(this),
                            onFocus: this.handleFocus.bind(this),
                            onBlur: this.handleBlur.bind(this),
                        },
                        {
                            elemtype: "iconbutton",
                            icon: get(this.refreshIcon),
                            click: this.handleRefresh.bind(this),
                        },
                    ],
                },
            ] as HeaderElem[];
        });
    }

    /**
     * Whether the back button in the header should be disabled.
     * @returns True if the WebView cannot go back or if the WebView call fails. False otherwise.
     */
    shouldDisabledBackButton() {
        try {
            return !this.webviewRef.current?.canGoBack();
        } catch (_) {}
        return true;
    }

    /**
     * Whether the forward button in the header should be disabled.
     * @returns True if the WebView cannot go forward or if the WebView call fails. False otherwise.
     */
    shouldDisabledForwardButton() {
        try {
            return !this.webviewRef.current?.canGoForward();
        } catch (_) {}
        return true;
    }

    handleUrlWrapperMouseOver(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        const urlInputFocused = globalStore.get(this.urlInputFocused);
        if (e.type === "mouseover" && !urlInputFocused) {
            globalStore.set(this.urlWrapperClassName, "hovered");
        }
    }

    handleUrlWrapperMouseOut(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        const urlInputFocused = globalStore.get(this.urlInputFocused);
        if (e.type === "mouseout" && !urlInputFocused) {
            globalStore.set(this.urlWrapperClassName, "");
        }
    }

    handleBack(e?: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        this.webviewRef.current?.goBack();
    }

    handleForward(e?: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        this.webviewRef.current?.goForward();
    }

    handleRefresh(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        e.preventDefault();
        e.stopPropagation();
        try {
            if (this.webviewRef.current) {
                if (globalStore.get(this.isLoading)) {
                    this.webviewRef.current.stop();
                } else {
                    this.webviewRef.current.reload();
                }
            }
        } catch (e) {
            console.warn("handleRefresh catch", e);
        }
    }

    handleUrlChange(event: React.ChangeEvent<HTMLInputElement>) {
        globalStore.set(this.url, event.target.value);
        globalStore.set(this.isUrlDirty, true);
    }

    handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        const waveEvent = adaptFromReactOrNativeKeyEvent(event);
        if (checkKeyPressed(waveEvent, "Enter")) {
            const url = globalStore.get(this.url);
            this.loadUrl(url);
            this.urlInputRef.current?.blur();
            return;
        }
        if (checkKeyPressed(waveEvent, "Escape")) {
            this.webviewRef.current?.focus();
        }
    }

    handleFocus(event: React.FocusEvent<HTMLInputElement>) {
        globalStore.set(this.urlWrapperClassName, "focused");
        globalStore.set(this.urlInputFocused, true);
        this.urlInputRef.current.focus();
        event.target.select();
    }

    handleBlur(event: React.FocusEvent<HTMLInputElement>) {
        globalStore.set(this.urlWrapperClassName, "");
        globalStore.set(this.urlInputFocused, false);
    }

    /**
     * Update the URL in the state when a navigation event has occurred.
     * @param url The URL that has been navigated to.
     */
    handleNavigate(url: string) {
        services.ObjectService.UpdateObjectMeta(WOS.makeORef("block", this.blockId), { url });
        globalStore.set(this.url, url);
    }

    ensureUrlScheme(url: string) {
        if (/^(http|https):/.test(url)) {
            // If the URL starts with http: or https:, return it as is
            return url;
        }

        // Check if the URL looks like a local URL
        const isLocal = /^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?$/.test(url.split("/")[0]);

        if (isLocal) {
            // If it is a local URL, ensure it has http:// scheme
            return `http://${url}`;
        }

        // Check if the URL looks like a domain
        const domainRegex = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
        const isDomain = domainRegex.test(url.split("/")[0]);

        if (isDomain) {
            // If it looks like a domain, ensure it has https:// scheme
            return `https://${url}`;
        }

        // Otherwise, treat it as a search query
        return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }

    normalizeUrl(url: string) {
        if (!url) {
            return url;
        }

        try {
            const parsedUrl = new URL(url);
            if (parsedUrl.hostname.startsWith("www.")) {
                parsedUrl.hostname = parsedUrl.hostname.slice(4);
            }
            return parsedUrl.href;
        } catch (e) {
            return url.replace(/\/+$/, "") + "/";
        }
    }

    /**
     * Load a new URL in the webview.
     * @param newUrl The new URL to load in the webview.
     */
    loadUrl(newUrl: string) {
        console.log("loadUrl", newUrl);
        const nextUrl = this.ensureUrlScheme(newUrl);
        const normalizedNextUrl = this.normalizeUrl(nextUrl);
        const normalizedCurUrl = this.normalizeUrl(globalStore.get(this.url));

        if (normalizedCurUrl !== normalizedNextUrl) {
            this.webviewRef?.current.loadURL(normalizedNextUrl);
        }
    }

    /**
     * Get the current URL from the state.
     * @returns The URL from the state.
     */
    getUrl() {
        return globalStore.get(this.url);
    }

    setRefreshIcon(refreshIcon: string) {
        globalStore.set(this.refreshIcon, refreshIcon);
    }

    setIsLoading(isLoading: boolean) {
        globalStore.set(this.isLoading, isLoading);
    }

    giveFocus(): boolean {
        const ctrlShiftState = globalStore.get(getSimpleControlShiftAtom());
        if (ctrlShiftState) {
            // this is really weird, we don't get keyup events from webview
            const unsubFn = globalStore.sub(getSimpleControlShiftAtom(), () => {
                const state = globalStore.get(getSimpleControlShiftAtom());
                if (!state) {
                    unsubFn();
                    const isStillFocused = globalStore.get(this.nodeModel.isFocused);
                    if (isStillFocused) {
                        this.webviewRef.current?.focus();
                    }
                }
            });
            return false;
        }
        this.webviewRef.current?.focus();
        return true;
    }

    keyDownHandler(e: WaveKeyboardEvent): boolean {
        if (checkKeyPressed(e, "Cmd:l")) {
            this.urlInputRef?.current?.focus();
            this.urlInputRef?.current?.select();
            return true;
        }
        if (checkKeyPressed(e, "Cmd:r")) {
            this.webviewRef?.current?.reload();
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowLeft")) {
            this.handleBack(null);
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowRight")) {
            this.handleForward(null);
            return true;
        }
        return false;
    }
}

function makeWebViewModel(blockId: string, nodeModel: NodeModel): WebViewModel {
    const webviewModel = new WebViewModel(blockId, nodeModel);
    return webviewModel;
}

interface WebViewProps {
    blockId: string;
    model: WebViewModel;
}

const WebView = memo(({ model }: WebViewProps) => {
    const blockData = jotai.useAtomValue(model.blockAtom);
    const metaUrl = blockData?.meta?.url;
    const metaUrlRef = React.useRef(metaUrl);

    // The initial value of the block metadata URL when the component first renders. Used to set the starting src value for the webview.
    const [metaUrlInitial] = useState(metaUrl);

    // Load a new URL if the block metadata is updated.
    useEffect(() => {
        if (metaUrlRef.current != metaUrl) {
            metaUrlRef.current = metaUrl;
            model.loadUrl(metaUrl);
        }
    }, [metaUrl]);

    useEffect(() => {
        const webview = model.webviewRef.current;

        if (webview) {
            const navigateListener = (e: any) => {
                model.handleNavigate(e.url);
            };
            const newWindowHandler = (e: any) => {
                e.preventDefault();
                const newUrl = e.detail.url;
                console.log("webview new-window event:", newUrl);
                fireAndForget(() => openLink(newUrl, true));
            };
            const startLoadingHandler = () => {
                model.setRefreshIcon("xmark-large");
                model.setIsLoading(true);
            };
            const stopLoadingHandler = () => {
                model.setRefreshIcon("rotate-right");
                model.setIsLoading(false);
            };
            const failLoadHandler = (e: any) => {
                if (e.errorCode === -3) {
                    console.warn("Suppressed ERR_ABORTED error", e);
                } else {
                    console.error(`Failed to load ${e.validatedURL}: ${e.errorDescription}`);
                }
            };
            const webviewFocus = () => {
                getApi().setWebviewFocus(webview.getWebContentsId());
                model.nodeModel.focusNode();
            };
            const webviewBlur = () => {
                getApi().setWebviewFocus(null);
            };

            webview.addEventListener("did-navigate-in-page", navigateListener);
            webview.addEventListener("did-navigate", navigateListener);
            webview.addEventListener("did-start-loading", startLoadingHandler);
            webview.addEventListener("did-stop-loading", stopLoadingHandler);
            webview.addEventListener("new-window", newWindowHandler);
            webview.addEventListener("did-fail-load", failLoadHandler);

            webview.addEventListener("focus", webviewFocus);
            webview.addEventListener("blur", webviewBlur);

            // Clean up event listeners on component unmount
            return () => {
                webview.removeEventListener("did-navigate", navigateListener);
                webview.removeEventListener("did-navigate-in-page", navigateListener);
                webview.removeEventListener("new-window", newWindowHandler);
                webview.removeEventListener("did-fail-load", failLoadHandler);
                webview.removeEventListener("did-start-loading", startLoadingHandler);
                webview.removeEventListener("did-stop-loading", stopLoadingHandler);
                webview.addEventListener("focus", webviewFocus);
                webview.addEventListener("blur", webviewBlur);
            };
        }
    }, []);

    return (
        <webview
            id="webview"
            className="webview"
            ref={model.webviewRef}
            src={metaUrlInitial}
            // @ts-ignore This is a discrepancy between the React typing and the Chromium impl for webviewTag. Chrome webviewTag expects a string, while React expects a boolean.
            allowpopups="true"
        ></webview>
    );
});

export { WebView, makeWebViewModel };
