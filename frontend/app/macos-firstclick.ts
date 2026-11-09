// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type FirstClickOptions = {
    getLastNativeWindowFocusTime: () => number;
    focusBlock: (blockId: string) => void;
    focusAIPanel: () => void;
};

export function installMacOSFirstClickHandler({
    getLastNativeWindowFocusTime,
    focusBlock,
    focusAIPanel,
}: FirstClickOptions): () => void {
    let rendererFocusTime: number = null;
    let handledWindowFocusTime: number = null;
    let cancelNextClick = false;
    let pendingFocus: ReturnType<typeof setTimeout> = null;

    const cancelPendingFocus = () => {
        if (pendingFocus != null) {
            clearTimeout(pendingFocus);
            pendingFocus = null;
        }
    };

    const handleFocus = () => {
        rendererFocusTime = Date.now();
    };

    const handleBlur = () => {
        rendererFocusTime = null;
        cancelPendingFocus();
        // Focusing a webview also blurs this renderer; its activation click still needs to be suppressed.
    };

    const handleKeyDown = () => {
        rendererFocusTime = null;
        cancelNextClick = false;
        cancelPendingFocus();
    };

    const handleMouseDown = (event: MouseEvent) => {
        cancelPendingFocus();
        cancelNextClick = false;
        const rendererFocusAge = Date.now() - rendererFocusTime;
        if (rendererFocusTime == null || rendererFocusAge < 0 || rendererFocusAge >= 50) {
            return;
        }
        rendererFocusTime = null;

        // A webview can focus this renderer without activating its native window.
        const windowFocusTime = getLastNativeWindowFocusTime();
        const timeDiff = Date.now() - windowFocusTime;
        if (windowFocusTime == null || windowFocusTime === handledWindowFocusTime || timeDiff < 0 || timeDiff >= 50) {
            return;
        }

        handledWindowFocusTime = windowFocusTime;
        cancelNextClick = true;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const target = event.target instanceof Element ? event.target : null;
        const blockId = target?.closest("[data-blockid]")?.getAttribute("data-blockid");
        const aiPanel = target?.closest("[data-aipanel]");
        if (blockId != null || aiPanel != null) {
            pendingFocus = setTimeout(() => {
                pendingFocus = null;
                if (blockId != null) {
                    console.log("macos first-click, focusing block", blockId);
                    focusBlock(blockId);
                } else {
                    console.log("macos first-click, focusing AI panel");
                    focusAIPanel();
                }
            }, 10);
        }
        console.log("macos first-click detected, canceled", timeDiff + "ms");
    };

    const handleClick = (event: MouseEvent) => {
        if (!cancelNextClick || event.detail === 0) {
            return;
        }
        cancelNextClick = false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        console.log("macos first-click (click event) canceled");
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("click", handleClick, true);
    return () => {
        cancelPendingFocus();
        window.removeEventListener("focus", handleFocus);
        window.removeEventListener("blur", handleBlur);
        window.removeEventListener("keydown", handleKeyDown, true);
        window.removeEventListener("mousedown", handleMouseDown, true);
        window.removeEventListener("click", handleClick, true);
    };
}
