// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { Search, useSearch } from "@/app/element/search";
import { getApi, getBlockMetaKeyAtom, getSettingsKeyAtom, openLink } from "@/app/store/global";
import { getSimpleControlShiftAtom } from "@/app/store/keymodel";
import { ObjectService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS, globalStore } from "@/store/global";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { fireAndForget } from "@/util/util";
import clsx from "clsx";
import { WebviewTag } from "electron";
import { Atom, PrimitiveAtom, atom, useAtomValue, useSetAtom } from "jotai";
import { Fragment, createRef, memo, useCallback, useEffect, useRef, useState } from "react";
import "./webview.scss";

let webviewPreloadUrl = null;

function getWebviewPreloadUrl() {
    if (webviewPreloadUrl == null) {
        webviewPreloadUrl = getApi().getWebviewPreload();
        console.log("webviewPreloadUrl", webviewPreloadUrl);
    }
    if (webviewPreloadUrl == null) {
        return null;
    }
    return "file://" + webviewPreloadUrl;
}

export class WebViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    blockAtom: Atom<Block>;
    viewIcon: Atom<string | IconButtonDecl>;
    viewName: Atom<string>;
    viewText: Atom<HeaderElem[]>;
    url: PrimitiveAtom<string>;
    homepageUrl: Atom<string>;
    urlInputFocused: PrimitiveAtom<boolean>;
    isLoading: PrimitiveAtom<boolean>;
    urlWrapperClassName: PrimitiveAtom<string>;
    refreshIcon: PrimitiveAtom<string>;
    webviewRef: React.RefObject<WebviewTag>;
    urlInputRef: React.RefObject<HTMLInputElement>;
    nodeModel: BlockNodeModel;
    endIconButtons?: Atom<IconButtonDecl[]>;
    mediaPlaying: PrimitiveAtom<boolean>;
    mediaMuted: PrimitiveAtom<boolean>;
    modifyExternalUrl?: (url: string) => string;
    domReady: PrimitiveAtom<boolean>;
    hideNav: Atom<boolean>;
    searchAtoms?: SearchAtoms;

    constructor(blockId: string, nodeModel: BlockNodeModel) {
        this.nodeModel = nodeModel;
        this.viewType = "web";
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.url = atom();
        const defaultUrlAtom = getSettingsKeyAtom("web:defaulturl");
        this.homepageUrl = atom((get) => {
            const defaultUrl = get(defaultUrlAtom);
            const pinnedUrl = get(this.blockAtom).meta.pinnedurl;
            return pinnedUrl ?? defaultUrl;
        });
        this.urlWrapperClassName = atom("");
        this.urlInputFocused = atom(false);
        this.isLoading = atom(false);
        this.refreshIcon = atom("rotate-right");
        this.viewIcon = atom("globe");
        this.viewName = atom("Web");
        this.urlInputRef = createRef<HTMLInputElement>();
        this.webviewRef = createRef<WebviewTag>();
        this.domReady = atom(false);
        this.hideNav = getBlockMetaKeyAtom(blockId, "web:hidenav");

        this.mediaPlaying = atom(false);
        this.mediaMuted = atom(false);

        this.viewText = atom((get) => {
            const homepageUrl = get(this.homepageUrl);
            const metaUrl = get(this.blockAtom)?.meta?.url;
            const currUrl = get(this.url);
            const urlWrapperClassName = get(this.urlWrapperClassName);
            const refreshIcon = get(this.refreshIcon);
            const mediaPlaying = get(this.mediaPlaying);
            const mediaMuted = get(this.mediaMuted);
            const url = currUrl ?? metaUrl ?? homepageUrl;
            const rtn: HeaderElem[] = [];
            if (get(this.hideNav)) {
                return rtn;
            }

            rtn.push({
                elemtype: "iconbutton",
                icon: "chevron-left",
                click: this.handleBack.bind(this),
                disabled: this.shouldDisableBackButton(),
            });
            rtn.push({
                elemtype: "iconbutton",
                icon: "chevron-right",
                click: this.handleForward.bind(this),
                disabled: this.shouldDisableForwardButton(),
            });
            rtn.push({
                elemtype: "iconbutton",
                icon: "house",
                click: this.handleHome.bind(this),
                disabled: this.shouldDisableHomeButton(),
            });
            const divChildren: HeaderElem[] = [];
            divChildren.push({
                elemtype: "input",
                value: url,
                ref: this.urlInputRef,
                className: "url-input",
                onChange: this.handleUrlChange.bind(this),
                onKeyDown: this.handleKeyDown.bind(this),
                onFocus: this.handleFocus.bind(this),
                onBlur: this.handleBlur.bind(this),
            });
            if (mediaPlaying) {
                divChildren.push({
                    elemtype: "iconbutton",
                    icon: mediaMuted ? "volume-slash" : "volume",
                    click: this.handleMuteChange.bind(this),
                });
            }
            divChildren.push({
                elemtype: "iconbutton",
                icon: refreshIcon,
                click: this.handleRefresh.bind(this),
            });
            rtn.push({
                elemtype: "div",
                className: clsx("block-frame-div-url", urlWrapperClassName),
                onMouseOver: this.handleUrlWrapperMouseOver.bind(this),
                onMouseOut: this.handleUrlWrapperMouseOut.bind(this),
                children: divChildren,
            });
            return rtn;
        });

        this.endIconButtons = atom((get) => {
            if (get(this.hideNav)) {
                return null;
            }
            const url = get(this.url);
            return [
                {
                    elemtype: "iconbutton",
                    icon: "arrow-up-right-from-square",
                    title: "Open in External Browser",
                    click: () => {
                        console.log("open external", url);
                        if (url != null && url != "") {
                            const externalUrl = this.modifyExternalUrl?.(url) ?? url;
                            return getApi().openExternal(externalUrl);
                        }
                    },
                },
            ];
        });
    }

    /**
     * Whether the back button in the header should be disabled.
     * @returns True if the WebView cannot go back or if the WebView call fails. False otherwise.
     */
    shouldDisableBackButton() {
        try {
            return !this.webviewRef.current?.canGoBack();
        } catch (_) {}
        return true;
    }

    /**
     * Whether the forward button in the header should be disabled.
     * @returns True if the WebView cannot go forward or if the WebView call fails. False otherwise.
     */
    shouldDisableForwardButton() {
        try {
            return !this.webviewRef.current?.canGoForward();
        } catch (_) {}
        return true;
    }

    /**
     * Whether the home button in the header should be disabled.
     * @returns True if the current url is the pinned url or the pinned url is not set. False otherwise.
     */
    shouldDisableHomeButton() {
        try {
            const homepageUrl = globalStore.get(this.homepageUrl);
            return !homepageUrl || this.getUrl() === homepageUrl;
        } catch (_) {}
        return true;
    }

    handleHome(e?: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        this.loadUrl(globalStore.get(this.homepageUrl), "home");
    }

    setMediaPlaying(isPlaying: boolean) {
        globalStore.set(this.mediaPlaying, isPlaying);
    }

    handleMuteChange(e: React.ChangeEvent<HTMLInputElement>) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        try {
            const newMutedVal = !this.webviewRef.current?.isAudioMuted();
            globalStore.set(this.mediaMuted, newMutedVal);
            this.webviewRef.current?.setAudioMuted(newMutedVal);
        } catch (e) {
            console.error("Failed to change mute value", e);
        }
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
    }

    handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        const waveEvent = adaptFromReactOrNativeKeyEvent(event);
        if (checkKeyPressed(waveEvent, "Enter")) {
            const url = globalStore.get(this.url);
            this.loadUrl(url, "enter");
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
        fireAndForget(() => ObjectService.UpdateObjectMeta(WOS.makeORef("block", this.blockId), { url }));
        globalStore.set(this.url, url);
        if (this.searchAtoms) {
            globalStore.set(this.searchAtoms.isOpen, false);
        }
    }

    ensureUrlScheme(url: string, searchTemplate: string) {
        if (url == null) {
            url = "";
        }

        if (/^(http|https|file):/.test(url)) {
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
        if (searchTemplate == null) {
            return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
        }
        return searchTemplate.replace("{query}", encodeURIComponent(url));
    }

    /**
     * Load a new URL in the webview.
     * @param newUrl The new URL to load in the webview.
     */
    loadUrl(newUrl: string, reason: string) {
        const defaultSearchAtom = getSettingsKeyAtom("web:defaultsearch");
        const searchTemplate = globalStore.get(defaultSearchAtom);
        const nextUrl = this.ensureUrlScheme(newUrl, searchTemplate);
        console.log("webview loadUrl", reason, nextUrl, "cur=", this.webviewRef.current.getURL());
        if (!this.webviewRef.current) {
            return;
        }
        if (this.webviewRef.current.getURL() != nextUrl) {
            fireAndForget(() => this.webviewRef.current.loadURL(nextUrl));
        }
        if (newUrl != nextUrl) {
            globalStore.set(this.url, nextUrl);
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

    async setHomepageUrl(url: string, scope: "global" | "block") {
        if (url != null && url != "") {
            switch (scope) {
                case "block":
                    await RpcApi.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { pinnedurl: url },
                    });
                    break;
                case "global":
                    await RpcApi.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { pinnedurl: "" },
                    });
                    await RpcApi.SetConfigCommand(TabRpcClient, { "web:defaulturl": url });
                    break;
            }
        }
    }

    giveFocus(): boolean {
        console.log("webview giveFocus");
        if (this.searchAtoms && globalStore.get(this.searchAtoms.isOpen)) {
            console.log("search is open, not giving focus");
            return true;
        }
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
            this.webviewRef.current?.reload();
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

        const isNavHidden = globalStore.get(this.hideNav);
        return [
            {
                label: "Set Block Homepage",
                click: () => fireAndForget(() => this.setHomepageUrl(this.getUrl(), "block")),
            },
            {
                label: "Set Default Homepage",
                click: () => fireAndForget(() => this.setHomepageUrl(this.getUrl(), "global")),
            },
            {
                type: "separator",
            },
            {
                label: isNavHidden ? "Un-Hide Navigation" : "Hide Navigation",
                click: () =>
                    fireAndForget(() => {
                        return RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "web:hidenav": !isNavHidden },
                        });
                    }),
            },
            {
                label: "Set Zoom Factor",
                submenu: zoomSubMenu,
            },
            {
                label: this.webviewRef.current?.isDevToolsOpened() ? "Close DevTools" : "Open DevTools",
                click: () => {
                    if (this.webviewRef.current) {
                        if (this.webviewRef.current.isDevToolsOpened()) {
                            this.webviewRef.current.closeDevTools();
                        } else {
                            this.webviewRef.current.openDevTools();
                        }
                    }
                },
            },
        ];
    }
}

function makeWebViewModel(blockId: string, nodeModel: BlockNodeModel): WebViewModel {
    const webviewModel = new WebViewModel(blockId, nodeModel);
    return webviewModel;
}

interface WebViewProps {
    blockId: string;
    model: WebViewModel;
    onFailLoad?: (url: string) => void;
}

const WebView = memo(({ model, onFailLoad }: WebViewProps) => {
    const blockData = useAtomValue(model.blockAtom);
    const defaultUrl = useAtomValue(model.homepageUrl);
    const defaultSearchAtom = getSettingsKeyAtom("web:defaultsearch");
    const defaultSearch = useAtomValue(defaultSearchAtom);
    let metaUrl = blockData?.meta?.url || defaultUrl;
    metaUrl = model.ensureUrlScheme(metaUrl, defaultSearch);
    const metaUrlRef = useRef(metaUrl);
    const zoomFactor = useAtomValue(getBlockMetaKeyAtom(model.blockId, "web:zoom")) || 1;

    // Search
    const searchProps = useSearch({ anchorRef: model.webviewRef, viewModel: model });
    const searchVal = useAtomValue<string>(searchProps.searchValue);
    const setSearchIndex = useSetAtom(searchProps.resultsIndex);
    const setNumSearchResults = useSetAtom(searchProps.resultsCount);
    searchProps.onSearch = useCallback((search: string) => {
        try {
            if (search) {
                model.webviewRef.current?.findInPage(search, { findNext: true });
            } else {
                model.webviewRef.current?.stopFindInPage("clearSelection");
            }
        } catch (e) {
            console.error("Failed to search", e);
        }
    }, []);
    searchProps.onNext = useCallback(() => {
        try {
            console.log("search next", searchVal);
            model.webviewRef.current?.findInPage(searchVal, { findNext: false, forward: true });
        } catch (e) {
            console.error("Failed to search next", e);
        }
    }, [searchVal]);
    searchProps.onPrev = useCallback(() => {
        try {
            console.log("search prev", searchVal);
            model.webviewRef.current?.findInPage(searchVal, { findNext: false, forward: false });
        } catch (e) {
            console.error("Failed to search prev", e);
        }
    }, [searchVal]);
    const onFoundInPage = useCallback((event: any) => {
        const result = event.result;
        console.log("found in page", result);
        if (!result) {
            return;
        }
        setNumSearchResults(result.matches);
        setSearchIndex(result.activeMatchOrdinal - 1);
    }, []);
    // End Search

    // The initial value of the block metadata URL when the component first renders. Used to set the starting src value for the webview.
    const [metaUrlInitial] = useState(metaUrl);

    const [webContentsId, setWebContentsId] = useState(null);
    const domReady = useAtomValue(model.domReady);

    const [errorText, setErrorText] = useState("");

    function setBgColor() {
        const webview = model.webviewRef.current;
        if (!webview) {
            return;
        }
        setTimeout(() => {
            webview
                .executeJavaScript(
                    `!!document.querySelector('meta[name="color-scheme"]') && document.querySelector('meta[name="color-scheme"]').content?.includes('dark') || false`
                )
                .then((hasDarkMode) => {
                    if (hasDarkMode) {
                        webview.style.backgroundColor = "black"; // Dark mode background
                    } else {
                        webview.style.backgroundColor = "white"; // Light mode background
                    }
                })
                .catch((e) => {
                    webview.style.backgroundColor = "black"; // Dark mode background
                    console.log("Error getting color scheme, defaulting to dark", e);
                });
        }, 100);
    }

    useEffect(() => {
        return () => {
            globalStore.set(model.domReady, false);
        };
    }, []);

    useEffect(() => {
        if (model.webviewRef.current == null || !domReady) {
            return;
        }
        try {
            const wcId = model.webviewRef.current.getWebContentsId?.();
            if (wcId) {
                setWebContentsId(wcId);
                if (model.webviewRef.current.getZoomFactor() != zoomFactor) {
                    model.webviewRef.current.setZoomFactor(zoomFactor);
                }
            }
        } catch (e) {
            console.error("Failed to get webcontentsid / setzoomlevel (webview)", e);
        }
    }, [model.webviewRef.current, domReady, zoomFactor]);

    // Load a new URL if the block metadata is updated.
    useEffect(() => {
        if (metaUrlRef.current != metaUrl) {
            metaUrlRef.current = metaUrl;
            model.loadUrl(metaUrl, "meta");
        }
    }, [metaUrl]);

    useEffect(() => {
        const webview = model.webviewRef.current;
        if (!webview) {
            return;
        }
        const navigateListener = (e: any) => {
            setErrorText("");
            if (e.isMainFrame) {
                model.handleNavigate(e.url);
            }
        };
        const newWindowHandler = (e: any) => {
            e.preventDefault();
            const newUrl = e.detail.url;
            fireAndForget(() => openLink(newUrl, true));
        };
        const startLoadingHandler = () => {
            model.setRefreshIcon("xmark-large");
            model.setIsLoading(true);
            webview.style.backgroundColor = "transparent";
        };
        const stopLoadingHandler = () => {
            model.setRefreshIcon("rotate-right");
            model.setIsLoading(false);
            setBgColor();
        };
        const failLoadHandler = (e: any) => {
            if (e.errorCode === -3) {
                console.warn("Suppressed ERR_ABORTED error", e);
            } else {
                const errorMessage = `Failed to load ${e.validatedURL}: ${e.errorDescription}`;
                console.error(errorMessage);
                setErrorText(errorMessage);
                if (onFailLoad) {
                    const curUrl = model.webviewRef.current.getURL();
                    onFailLoad(curUrl);
                }
            }
        };
        const webviewFocus = () => {
            getApi().setWebviewFocus(webview.getWebContentsId());
            model.nodeModel.focusNode();
        };
        const webviewBlur = () => {
            getApi().setWebviewFocus(null);
        };
        const handleDomReady = () => {
            globalStore.set(model.domReady, true);
            setBgColor();
        };
        const handleMediaPlaying = () => {
            model.setMediaPlaying(true);
        };
        const handleMediaPaused = () => {
            model.setMediaPlaying(false);
        };

        webview.addEventListener("did-frame-navigate", navigateListener);
        webview.addEventListener("did-navigate-in-page", navigateListener);
        webview.addEventListener("did-navigate", navigateListener);
        webview.addEventListener("did-start-loading", startLoadingHandler);
        webview.addEventListener("did-stop-loading", stopLoadingHandler);
        webview.addEventListener("new-window", newWindowHandler);
        webview.addEventListener("did-fail-load", failLoadHandler);
        webview.addEventListener("focus", webviewFocus);
        webview.addEventListener("blur", webviewBlur);
        webview.addEventListener("dom-ready", handleDomReady);
        webview.addEventListener("media-started-playing", handleMediaPlaying);
        webview.addEventListener("media-paused", handleMediaPaused);
        webview.addEventListener("found-in-page", onFoundInPage);

        // Clean up event listeners on component unmount
        return () => {
            webview.removeEventListener("did-frame-navigate", navigateListener);
            webview.removeEventListener("did-navigate", navigateListener);
            webview.removeEventListener("did-navigate-in-page", navigateListener);
            webview.removeEventListener("new-window", newWindowHandler);
            webview.removeEventListener("did-fail-load", failLoadHandler);
            webview.removeEventListener("did-start-loading", startLoadingHandler);
            webview.removeEventListener("did-stop-loading", stopLoadingHandler);
            webview.removeEventListener("focus", webviewFocus);
            webview.removeEventListener("blur", webviewBlur);
            webview.removeEventListener("dom-ready", handleDomReady);
            webview.removeEventListener("media-started-playing", handleMediaPlaying);
            webview.removeEventListener("media-paused", handleMediaPaused);
            webview.removeEventListener("found-in-page", onFoundInPage);
        };
    }, []);

    return (
        <Fragment>
            <webview
                id="webview"
                className="webview"
                ref={model.webviewRef}
                src={metaUrlInitial}
                data-blockid={model.blockId}
                data-webcontentsid={webContentsId} // needed for emain
                preload={getWebviewPreloadUrl()}
                // @ts-ignore This is a discrepancy between the React typing and the Chromium impl for webviewTag. Chrome webviewTag expects a string, while React expects a boolean.
                allowpopups="true"
            />
            {errorText && (
                <div className="webview-error">
                    <div>{errorText}</div>
                </div>
            )}
            <Search {...searchProps} />
        </Fragment>
    );
});

export { WebView, makeWebViewModel };
