// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientModel } from "@/app/store/client-model";
import { GlobalModel } from "@/app/store/global-model";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { Workspace } from "@/app/workspace/workspace";
import { ContextMenuModel } from "@/store/contextmenu";
import {
    atoms,
    clearTabIndicatorFromFocus,
    createBlock,
    getSettingsPrefixAtom,
    getTabIndicatorAtom,
    globalStore,
    isDev,
    removeFlashError,
} from "@/store/global";
import { appHandleKeyDown, keyboardMouseDownHandler } from "@/store/keymodel";
import { getElemAsStr } from "@/util/focusutil";
import * as keyutil from "@/util/keyutil";
import { PLATFORM } from "@/util/platformutil";
import * as util from "@/util/util";
import clsx from "clsx";
import debug from "debug";
import { Provider, useAtomValue } from "jotai";
import "overlayscrollbars/overlayscrollbars.css";
import { Fragment, useEffect, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { AppBackground } from "./app-bg";
import { CenteredDiv } from "./element/quickelems";
import { useTheme } from "./hook/usetheme";
import { NotificationBubbles } from "./notification/notificationbubbles";

import "./app.scss";

// tailwindsetup.css should come *after* app.scss (don't remove the newline above otherwise prettier will reorder these imports)
import "../tailwindsetup.css";

const dlog = debug("wave:app");
const focusLog = debug("wave:focus");

const App = ({ onFirstRender }: { onFirstRender: () => void }) => {
    const tabId = useAtomValue(atoms.staticTabId);
    useEffect(() => {
        onFirstRender();
    }, []);
    return (
        <Provider store={globalStore}>
            <TabModelContext.Provider value={getTabModelByTabId(tabId)}>
                <AppInner />
            </TabModelContext.Provider>
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
    let menu: ContextMenuItem[] = [];
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
    ContextMenuModel.showContextMenu(menu, e);
}

function AppThemeUpdater() {
    useTheme();
    return null;
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

const AppKeyHandlers = () => {
    useEffect(() => {
        const staticKeyDownHandler = keyutil.keydownWrapper(appHandleKeyDown);
        document.addEventListener("keydown", staticKeyDownHandler);
        document.addEventListener("mousedown", keyboardMouseDownHandler);

        return () => {
            document.removeEventListener("keydown", staticKeyDownHandler);
            document.removeEventListener("mousedown", keyboardMouseDownHandler);
        };
    }, []);
    return null;
};

const TabIndicatorAutoClearing = () => {
    const tabId = useAtomValue(atoms.staticTabId);
    const indicator = useAtomValue(getTabIndicatorAtom(tabId));
    const documentHasFocus = useAtomValue(atoms.documentHasFocus);

    useEffect(() => {
        if (!indicator || !documentHasFocus || !indicator.clearonfocus) {
            return;
        }

        const timeoutId = setTimeout(() => {
            const currentIndicator = globalStore.get(getTabIndicatorAtom(tabId));
            if (globalStore.get(atoms.documentHasFocus) && currentIndicator?.clearonfocus) {
                clearTabIndicatorFromFocus(tabId);
            }
        }, 3000);

        return () => clearTimeout(timeoutId);
    }, [tabId, indicator, documentHasFocus]);

    return null;
};

const FlashError = () => {
    const flashErrors = useAtomValue(atoms.flashErrors);
    const [hoveredId, setHoveredId] = useState<string>(null);
    const [ticker, setTicker] = useState<number>(0);

    useEffect(() => {
        if (flashErrors.length == 0 || hoveredId != null) {
            return;
        }
        const now = Date.now();
        for (let ferr of flashErrors) {
            if (ferr.expiration == null || ferr.expiration < now) {
                removeFlashError(ferr.id);
            }
        }
        setTimeout(() => setTicker(ticker + 1), 1000);
    }, [flashErrors, ticker, hoveredId]);

    if (flashErrors.length == 0) {
        return null;
    }

    function copyError(id: string) {
        const ferr = flashErrors.find((f) => f.id === id);
        if (ferr == null) {
            return;
        }
        let text = "";
        if (ferr.title != null) {
            text += ferr.title;
        }
        if (ferr.message != null) {
            if (text.length > 0) {
                text += "\n";
            }
            text += ferr.message;
        }
        navigator.clipboard.writeText(text);
    }

    function convertNewlinesToBreaks(text) {
        return text.split("\n").map((part, index) => (
            <Fragment key={index}>
                {part}
                <br />
            </Fragment>
        ));
    }

    return (
        <div className="flash-error-container">
            {flashErrors.map((err, idx) => (
                <div
                    key={idx}
                    className={clsx("flash-error", { hovered: hoveredId === err.id })}
                    onClick={() => copyError(err.id)}
                    onMouseEnter={() => setHoveredId(err.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    title="Click to Copy Error Message"
                >
                    <div className="flash-error-scroll">
                        {err.title != null ? <div className="flash-error-title">{err.title}</div> : null}
                        {err.message != null ? (
                            <div className="flash-error-message">{convertNewlinesToBreaks(err.message)}</div>
                        ) : null}
                    </div>
                </div>
            ))}
        </div>
    );
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
            <AppKeyHandlers />
            <AppFocusHandler />
            <AppThemeUpdater />
            <AppSettingsUpdater />
            <TabIndicatorAutoClearing />
            <DndProvider backend={HTML5Backend}>
                <Workspace />
            </DndProvider>
            <FlashError />
            {isDev() ? <NotificationBubbles></NotificationBubbles> : null}
        </div>
    );
};

export { App };
