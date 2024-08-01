// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { WOS, globalStore } from "@/store/global";
import * as services from "@/store/services";
import clsx from "clsx";
import { WebviewTag } from "electron";
import * as jotai from "jotai";
import React, { memo, useEffect } from "react";

import "./webview.less";

export class WebViewModel implements ViewModel {
    blockId: string;
    blockAtom: jotai.Atom<Block>;
    viewIcon: jotai.Atom<string | HeaderIconButton>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<HeaderElem[]>;
    url: jotai.PrimitiveAtom<string>;
    urlInput: jotai.PrimitiveAtom<string>;
    urlInputFocused: jotai.PrimitiveAtom<boolean>;
    isLoading: jotai.PrimitiveAtom<boolean>;
    urlWrapperClassName: jotai.PrimitiveAtom<string>;
    refreshIcon: jotai.PrimitiveAtom<string>;
    webviewRef: React.RefObject<WebviewTag>;
    urlInputRef: React.RefObject<HTMLInputElement>;
    historyStack: string[];
    historyIndex: number;
    recentUrls: { [key: string]: number };

    constructor(blockId: string) {
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);

        this.url = jotai.atom("");
        this.urlInput = jotai.atom("");
        this.urlWrapperClassName = jotai.atom("");
        this.urlInputFocused = jotai.atom(false);
        this.isLoading = jotai.atom(false);
        this.refreshIcon = jotai.atom("rotate-right");
        this.historyStack = [];
        this.historyIndex = 0;
        this.recentUrls = {};

        this.viewIcon = jotai.atom((get) => {
            return "globe"; // should not be hardcoded
        });

        this.viewName = jotai.atom("Web");
        this.urlInputRef = React.createRef<HTMLInputElement>();
        this.webviewRef = React.createRef<WebviewTag>();

        this.viewText = jotai.atom((get) => {
            let url = get(this.blockAtom)?.meta?.url || "";
            if (url && this.historyStack.length === 0) {
                this.addToHistoryStack(url);
            }
            const currUrl = get(this.url);
            if (currUrl) {
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

    shouldDisabledBackButton() {
        return this.historyIndex === 0;
    }

    shouldDisabledForwardButton() {
        return this.historyIndex === this.historyStack.length - 1;
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

    handleBack(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        e.preventDefault();
        e.stopPropagation();
        if (this.historyIndex > 0) {
            do {
                this.historyIndex -= 1;
            } while (this.historyIndex > 0 && this.isRecentUrl(this.historyStack[this.historyIndex]));

            const prevUrl = this.historyStack[this.historyIndex];
            this.setBlockUrl(this.blockId, prevUrl);
            globalStore.set(this.url, prevUrl);
            if (this.webviewRef.current) {
                this.webviewRef.current.src = prevUrl;
            }
        }
    }

    handleForward(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        e.preventDefault();
        e.stopPropagation();
        if (this.historyIndex < this.historyStack.length - 1) {
            do {
                this.historyIndex += 1;
            } while (
                this.historyIndex < this.historyStack.length - 1 &&
                this.isRecentUrl(this.historyStack[this.historyIndex])
            );

            const nextUrl = this.historyStack[this.historyIndex];
            this.setBlockUrl(this.blockId, nextUrl);
            globalStore.set(this.url, nextUrl);
            if (this.webviewRef.current) {
                this.webviewRef.current.src = nextUrl;
            }
        }
    }

    handleRefresh(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        e.preventDefault();
        e.stopPropagation();
        if (this.webviewRef.current) {
            if (globalStore.get(this.isLoading)) {
                this.webviewRef.current.stop();
            } else {
                this.webviewRef.current.reload();
            }
        }
    }

    handleUrlChange(event: React.ChangeEvent<HTMLInputElement>) {
        globalStore.set(this.url, event.target.value);
    }

    handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Enter") {
            let url = globalStore.get(this.url);
            if (!url) {
                url = this.historyStack[this.historyIndex];
            }
            this.navigateTo(url);
            this.urlInputRef.current?.blur();
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

    ensureUrlScheme(url: string) {
        if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?/.test(url)) {
            // If the URL starts with localhost or an IP address (with optional port)
            return `http://${url}`;
        } else if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)) {
            // If the URL doesn't start with a protocol
            return `https://${url}`;
        }
        return url;
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

    navigateTo(newUrl: string) {
        const finalUrl = this.ensureUrlScheme(newUrl);
        const normalizedFinalUrl = this.normalizeUrl(finalUrl);
        const normalizedLastUrl = this.normalizeUrl(this.historyStack[this.historyIndex]);

        if (normalizedLastUrl !== normalizedFinalUrl) {
            this.setBlockUrl(this.blockId, normalizedFinalUrl);
            globalStore.set(this.url, normalizedFinalUrl);
            this.historyIndex += 1;
            this.historyStack = this.historyStack.slice(0, this.historyIndex);
            this.addToHistoryStack(normalizedFinalUrl);
            if (this.webviewRef.current) {
                this.webviewRef.current.src = normalizedFinalUrl;
            }
            this.updateRecentUrls(normalizedFinalUrl);
        }
    }

    addToHistoryStack(url: string) {
        if (this.historyStack.length === 0 || this.historyStack[this.historyStack.length - 1] !== url) {
            this.historyStack.push(url);
        }
    }

    setBlockUrl(blockId: string, url: string) {
        services.ObjectService.UpdateObjectMeta(WOS.makeORef("block", blockId), { url: url });
    }

    updateRecentUrls(url: string) {
        if (this.recentUrls[url]) {
            this.recentUrls[url]++;
        } else {
            this.recentUrls[url] = 1;
        }
        // Clean up old entries after a certain threshold
        if (Object.keys(this.recentUrls).length > 50) {
            this.recentUrls = {};
        }
    }

    isRecentUrl(url: string) {
        return this.recentUrls[url] > 1;
    }

    setRefreshIcon(refreshIcon: string) {
        globalStore.set(this.refreshIcon, refreshIcon);
    }

    setIsLoading(isLoading: boolean) {
        globalStore.set(this.isLoading, isLoading);
    }

    getUrl() {
        return this.historyStack[this.historyIndex];
    }

    giveFocus(): boolean {
        if (this.urlInputRef.current) {
            this.urlInputRef.current.focus({ preventScroll: true });
            return true;
        }
    }
}

function makeWebViewModel(blockId: string): WebViewModel {
    const webviewModel = new WebViewModel(blockId);
    return webviewModel;
}

interface WebViewProps {
    parentRef: React.RefObject<HTMLDivElement>;
    model: WebViewModel;
}

const WebView = memo(({ parentRef, model }: WebViewProps) => {
    const url = model.getUrl();
    const blockData = jotai.useAtomValue(model.blockAtom);
    const metaUrl = blockData?.meta?.url;
    const metaUrlRef = React.useRef(metaUrl);
    useEffect(() => {
        if (metaUrlRef.current != metaUrl) {
            metaUrlRef.current = metaUrl;
            model.navigateTo(metaUrl);
        }
    }, [metaUrl]);

    useEffect(() => {
        const webview = model.webviewRef.current;

        if (webview) {
            const navigateListener = (e: any) => {
                model.navigateTo(e.url);
            };

            webview.addEventListener("did-navigate", (e) => {
                console.log("did-navigate");
                navigateListener(e);
            });
            webview.addEventListener("did-start-loading", () => {
                model.setRefreshIcon("xmark-large");
                model.setIsLoading(true);
            });
            webview.addEventListener("did-stop-loading", () => {
                model.setRefreshIcon("rotate-right");
                model.setIsLoading(false);
            });

            // Handle new-window event
            webview.addEventListener("new-window", (e: any) => {
                e.preventDefault();
                const newUrl = e.detail.url;
                getApi().openExternal(newUrl);
            });

            // Suppress errors
            webview.addEventListener("did-fail-load", (e: any) => {
                if (e.errorCode === -3) {
                    e.log("Suppressed ERR_ABORTED error");
                } else {
                    console.error(`Failed to load ${e.validatedURL}: ${e.errorDescription}`);
                }
            });

            // Clean up event listeners on component unmount
            return () => {
                webview.removeEventListener("did-navigate", navigateListener);
                webview.removeEventListener("did-navigate-in-page", navigateListener);
                webview.removeEventListener("new-window", (e: any) => {
                    model.navigateTo(e.url);
                });
                webview.removeEventListener("did-fail-load", (e: any) => {
                    if (e.errorCode === -3) {
                        console.log("Suppressed ERR_ABORTED error");
                    } else {
                        console.error(`Failed to load ${e.validatedURL}: ${e.errorDescription}`);
                    }
                });
            };
        }
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "l") {
                e.preventDefault();
                if (model.urlInputRef) {
                    model.urlInputRef.current.focus();
                    model.urlInputRef.current.select();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key === "r") {
                e.preventDefault();
                if (model.webviewRef.current) {
                    model.webviewRef.current.reload();
                }
            }
        };

        const parentElement = parentRef.current;
        if (parentElement) {
            parentElement.addEventListener("keydown", handleKeyDown);
        }

        return () => {
            if (parentElement) {
                parentElement.removeEventListener("keydown", handleKeyDown);
            }
        };
    }, [parentRef]);

    return <webview id="webview" className="webview" ref={model.webviewRef} src={url}></webview>;
});

export { WebView, makeWebViewModel };
