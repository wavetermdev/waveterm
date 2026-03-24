// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    clearBadgesForBlockOnFocus,
    clearBadgesForTabOnFocus,
    getBadgeAtom,
    getBlockBadgeAtom,
} from "@/app/store/badge";
import { ClientModel } from "@/app/store/client-model";
import { FocusManager } from "@/app/store/focusManager";
import { GlobalModel } from "@/app/store/global-model";
import { globalStore } from "@/app/store/jotaiStore";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { WaveEnvContext } from "@/app/waveenv/waveenv";
import { makeWaveEnvImpl } from "@/app/waveenv/waveenvimpl";
import { Workspace } from "@/app/workspace/workspace";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { ContextMenuModel } from "@/store/contextmenu";
import { atoms, createBlock, getSettingsPrefixAtom, refocusNode } from "@/store/global";
import { appHandleKeyDown, keyboardMouseDownHandler } from "@/store/keymodel";
import { getElemAsStr } from "@/util/focusutil";
import * as keyutil from "@/util/keyutil";
import { PLATFORM } from "@/util/platformutil";
import * as util from "@/util/util";
import clsx from "clsx";
import debug from "debug";
import { Provider, useAtomValue } from "jotai";
import "overlayscrollbars/overlayscrollbars.css";
import { useEffect, useRef } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { AppBackground } from "./app-bg";
import { CenteredDiv } from "./element/quickelems";

import "./app.scss";

// tailwindsetup.css should come *after* app.scss (don't remove the newline above otherwise prettier will reorder these imports)
import "../tailwindsetup.css";

const dlog = debug("wave:app");
const focusLog = debug("wave:focus");

const App = ({ onFirstRender }: { onFirstRender: () => void }) => {
    const tabId = useAtomValue(atoms.staticTabId);
    const waveEnvRef = useRef(makeWaveEnvImpl());
    useEffect(() => {
        onFirstRender();
    }, []);
    return (
        <Provider store={globalStore}>
            <WaveEnvContext.Provider value={waveEnvRef.current}>
                <TabModelContext.Provider value={getTabModelByTabId(tabId)}>
                    <AppInner />
                </TabModelContext.Provider>
            </WaveEnvContext.Provider>
        </Provider>
    );
};

function isContentEditableBeingEdited(): boolean {
    const activeElement = document.activeElement;
    return (
        activeElement &&
        activeElement.getAttribute("contenteditable") !== null &&
        activeElement.getAttribute("contenteditable") !== "false"
    );
}

function canEnablePaste(): boolean {
    const activeElement = document.activeElement;
    return activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || isContentEditableBeingEdited();
}

function canEnableCopy(): boolean {
    const sel = window.getSelection();
    return !util.isBlank(sel?.toString());
}

function canEnableCut(): boolean {
    const sel = window.getSelection();
    if (document.activeElement?.classList.contains("xterm-helper-textarea")) {
        return false;
    }
    return !util.isBlank(sel?.toString()) && canEnablePaste();
}

async function getClipboardURL(): Promise<URL> {
    try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText == null) {
            return null;
        }
        const url = new URL(clipboardText);
        if (!url.protocol.startsWith("http")) {
            return null;
        }
        return url;
    } catch (e) {
        return null;
    }
}

async function handleContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const canPaste = canEnablePaste();
    const canCopy = canEnableCopy();
    const canCut = canEnableCut();
    const clipboardURL = await getClipboardURL();
    if (!canPaste && !canCopy && !canCut && !clipboardURL) {
        return;
    }
    const menu: ContextMenuItem[] = [];
    if (canCut) {
        menu.push({ label: "Cut", role: "cut" });
    }
    if (canCopy) {
        menu.push({ label: "Copy", role: "copy" });
    }
    if (canPaste) {
        menu.push({ label: "Paste", role: "paste" });
    }
    if (clipboardURL) {
        menu.push({ type: "separator" });
        menu.push({
            label: "Open Clipboard URL (" + clipboardURL.hostname + ")",
            click: () => {
                createBlock({
                    meta: {
                        view: "web",
                        url: clipboardURL.toString(),
                    },
                });
            },
        });
    }
    ContextMenuModel.getInstance().showContextMenu(menu, e);
}

function AppSettingsUpdater() {
    const windowSettingsAtom = getSettingsPrefixAtom("window");
    const windowSettings = useAtomValue(windowSettingsAtom);
    useEffect(() => {
        const isTransparentOrBlur =
            (windowSettings?.["window:transparent"] || windowSettings?.["window:blur"]) ?? false;
        const opacity = util.boundNumber(windowSettings?.["window:opacity"] ?? 0.8, 0, 1);
        const baseBgColor = windowSettings?.["window:bgcolor"];
        const mainDiv = document.getElementById("main");
        // console.log("window settings", windowSettings, isTransparentOrBlur, opacity, baseBgColor, mainDiv);
        if (isTransparentOrBlur) {
            mainDiv.classList.add("is-transparent");
            if (opacity != null) {
                document.body.style.setProperty("--window-opacity", `${opacity}`);
            } else {
                document.body.style.removeProperty("--window-opacity");
            }
        } else {
            mainDiv.classList.remove("is-transparent");
            document.body.style.removeProperty("--window-opacity");
        }
        if (baseBgColor != null) {
            document.body.style.setProperty("--main-bg-color", baseBgColor);
        } else {
            document.body.style.removeProperty("--main-bg-color");
        }
    }, [windowSettings]);
    return null;
}

function appFocusIn(e: FocusEvent) {
    focusLog("focusin", getElemAsStr(e.target), "<=", getElemAsStr(e.relatedTarget));
}

function appFocusOut(e: FocusEvent) {
    focusLog("focusout", getElemAsStr(e.target), "=>", getElemAsStr(e.relatedTarget));
}

function appSelectionChange(e: Event) {
    const selection = document.getSelection();
    focusLog("selectionchange", getElemAsStr(selection.anchorNode));
}

function AppFocusHandler() {
    return null;

    // for debugging
    useEffect(() => {
        document.addEventListener("focusin", appFocusIn);
        document.addEventListener("focusout", appFocusOut);
        document.addEventListener("selectionchange", appSelectionChange);
        const ivId = setInterval(() => {
            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLElement) {
                focusLog("activeElement", getElemAsStr(activeElement));
            }
        }, 2000);
        return () => {
            document.removeEventListener("focusin", appFocusIn);
            document.removeEventListener("focusout", appFocusOut);
            document.removeEventListener("selectionchange", appSelectionChange);
            clearInterval(ivId);
        };
    });
    return null;
}

const MacOSFirstClickHandler = () => {
    useEffect(() => {
        if (PLATFORM !== "darwin") {
            return;
        }
        let windowFocusTime: number = null;
        let cancelNextClick = false;
        const handleWindowFocus = (e: FocusEvent) => {
            windowFocusTime = Date.now();
        };
        const getBlockIdFromTarget = (target: EventTarget): string => {
            let elem = target as HTMLElement;
            while (elem != null) {
                const blockId = elem.dataset?.blockid;
                if (blockId) {
                    return blockId;
                }
                elem = elem.parentElement;
            }
            return null;
        };
        const isAIPanelTarget = (target: EventTarget): boolean => {
            let elem = target as HTMLElement;
            while (elem != null) {
                if (elem.dataset?.aipanel) {
                    return true;
                }
                elem = elem.parentElement;
            }
            return false;
        };
        const handleMouseDown = (e: MouseEvent) => {
            const timeDiff = Date.now() - windowFocusTime;
            if (windowFocusTime != null && timeDiff < 50) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                cancelNextClick = true;
                const blockId = getBlockIdFromTarget(e.target);
                if (blockId != null) {
                    setTimeout(() => {
                        console.log("macos first-click, focusing block", blockId);
                        refocusNode(blockId);
                    }, 10);
                } else if (isAIPanelTarget(e.target)) {
                    setTimeout(() => {
                        console.log("macos first-click, focusing AI panel");
                        FocusManager.getInstance().setWaveAIFocused(true);
                    }, 10);
                }
                console.log("macos first-click detected, canceled", timeDiff + "ms");
                return;
            }
            cancelNextClick = false;
        };
        const handleClick = (e: MouseEvent) => {
            if (!cancelNextClick) {
                return;
            }
            cancelNextClick = false;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            console.log("macos first-click (click event) canceled");
        };
        window.addEventListener("focus", handleWindowFocus);
        window.addEventListener("mousedown", handleMouseDown, true);
        window.addEventListener("click", handleClick, true);
        return () => {
            window.removeEventListener("focus", handleWindowFocus);
            window.removeEventListener("mousedown", handleMouseDown, true);
            window.removeEventListener("click", handleClick, true);
        };
    }, []);
    return null;
};

const AppKeyHandlers = () => {
    useEffect(() => {
        const staticKeyDownHandler = keyutil.keydownWrapper(appHandleKeyDown);
        const staticMouseDownHandler = (e: MouseEvent) => {
            keyboardMouseDownHandler(e);
            GlobalModel.getInstance().setIsActive();
        };
        document.addEventListener("keydown", staticKeyDownHandler);
        document.addEventListener("mousedown", staticMouseDownHandler);

        return () => {
            document.removeEventListener("keydown", staticKeyDownHandler);
            document.removeEventListener("mousedown", staticMouseDownHandler);
        };
    }, []);
    return null;
};

const BadgeAutoClearing = () => {
    const tabId = useAtomValue(atoms.staticTabId);
    const documentHasFocus = useAtomValue(atoms.documentHasFocus);
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = useAtomValue(layoutModel.focusedNode);
    const focusedBlockId = focusedNode?.data?.blockId;
    const badge = useAtomValue(getBlockBadgeAtom(focusedBlockId));
    const tabTransientBadge = useAtomValue(getBadgeAtom(tabId != null ? `tab:${tabId}` : null));
    const prevFocusedBlockIdRef = useRef<string>(null);
    const prevDocHasFocusRef = useRef<boolean>(false);
    const prevTabDocHasFocusRef = useRef<boolean>(false);

    useEffect(() => {
        if (!focusedBlockId || !badge || !documentHasFocus) {
            prevFocusedBlockIdRef.current = focusedBlockId;
            prevDocHasFocusRef.current = documentHasFocus;
            return;
        }
        const focusSwitched =
            prevFocusedBlockIdRef.current !== focusedBlockId || prevDocHasFocusRef.current !== documentHasFocus;
        prevFocusedBlockIdRef.current = focusedBlockId;
        prevDocHasFocusRef.current = documentHasFocus;
        const delay = focusSwitched ? 500 : 3000;
        const timeoutId = setTimeout(() => {
            if (!document.hasFocus()) {
                return;
            }
            const currentFocusedNode = globalStore.get(layoutModel.focusedNode);
            if (currentFocusedNode?.data?.blockId === focusedBlockId) {
                clearBadgesForBlockOnFocus(focusedBlockId);
            }
        }, delay);
        return () => clearTimeout(timeoutId);
    }, [focusedBlockId, badge, documentHasFocus]);

    useEffect(() => {
        if (!tabId || !tabTransientBadge || !documentHasFocus) {
            prevTabDocHasFocusRef.current = documentHasFocus;
            return;
        }
        const focusSwitched = prevTabDocHasFocusRef.current !== documentHasFocus;
        prevTabDocHasFocusRef.current = documentHasFocus;
        const delay = focusSwitched ? 500 : 3000;
        const timeoutId = setTimeout(() => {
            if (!document.hasFocus()) {
                return;
            }
            clearBadgesForTabOnFocus(tabId);
        }, delay);
        return () => clearTimeout(timeoutId);
    }, [tabId, tabTransientBadge, documentHasFocus]);

    return null;
};

const AppInner = () => {
    const prefersReducedMotion = useAtomValue(atoms.prefersReducedMotionAtom);
    const client = useAtomValue(ClientModel.getInstance().clientAtom);
    const windowData = useAtomValue(GlobalModel.getInstance().windowDataAtom);
    const isFullScreen = useAtomValue(atoms.isFullScreen);

    if (client == null || windowData == null) {
        return (
            <div className="flex flex-col w-full h-full">
                <AppBackground />
                <CenteredDiv>invalid configuration, client or window was not loaded</CenteredDiv>
            </div>
        );
    }

    return (
        <div
            className={clsx("flex flex-col w-full h-full", PLATFORM, {
                fullscreen: isFullScreen,
                "prefers-reduced-motion": prefersReducedMotion,
            })}
            onContextMenu={handleContextMenu}
        >
            <AppBackground />
            <MacOSFirstClickHandler />
            <AppKeyHandlers />
            <AppFocusHandler />
            <AppSettingsUpdater />
            <BadgeAutoClearing />
            <DndProvider backend={HTML5Backend}>
                <Workspace />
            </DndProvider>
        </div>
    );
};

export { App };
