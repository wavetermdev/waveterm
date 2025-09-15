// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import { getWebServerEndpoint } from "../frontend/util/endpoints";

export const WaveAppPathVarName = "WAVETERM_APP_PATH";
export const WaveAppElectronExecPath = "WAVETERM_ELECTRONEXECPATH";

export function getElectronExecPath(): string {
    return process.execPath;
}

// not necessarily exact, but we use this to help get us unstuck in certain cases
let lastCtrlShiftSate: boolean = false;

export function delay(ms): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function setCtrlShift(wc: Electron.WebContents, state: boolean) {
    lastCtrlShiftSate = state;
    wc.send("control-shift-state-update", state);
}

export function handleCtrlShiftFocus(sender: Electron.WebContents, focused: boolean) {
    if (!focused) {
        setCtrlShift(sender, false);
    }
}

export function handleCtrlShiftState(sender: Electron.WebContents, waveEvent: WaveKeyboardEvent) {
    if (waveEvent.type == "keyup") {
        if (waveEvent.key === "Control" || waveEvent.key === "Shift") {
            setCtrlShift(sender, false);
        }
        if (waveEvent.key == "Meta") {
            if (waveEvent.control && waveEvent.shift) {
                setCtrlShift(sender, true);
            }
        }
        if (lastCtrlShiftSate) {
            if (!waveEvent.control || !waveEvent.shift) {
                setCtrlShift(sender, false);
            }
        }
        return;
    }
    if (waveEvent.type == "keydown") {
        if (waveEvent.key === "Control" || waveEvent.key === "Shift" || waveEvent.key === "Meta") {
            if (waveEvent.control && waveEvent.shift && !waveEvent.meta) {
                // Set the control and shift without the Meta key
                setCtrlShift(sender, true);
            } else {
                // Unset if Meta is pressed
                setCtrlShift(sender, false);
            }
        }
        return;
    }
}

export function shNavHandler(event: Electron.Event<Electron.WebContentsWillNavigateEventParams>, url: string) {
    const isDev = !electron.app.isPackaged;
    if (
        isDev &&
        (url.startsWith("http://127.0.0.1:5173/index.html") ||
            url.startsWith("http://localhost:5173/index.html") ||
            url.startsWith("http://127.0.0.1:5174/index.html") ||
            url.startsWith("http://localhost:5174/index.html"))
    ) {
        // this is a dev-mode hot-reload, ignore it
        console.log("allowing hot-reload of index.html");
        return;
    }
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("file://")) {
        console.log("open external, shNav", url);
        electron.shell.openExternal(url);
    } else {
        console.log("navigation canceled", url);
    }
}

export function shFrameNavHandler(event: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>) {
    if (!event.frame?.parent) {
        // only use this handler to process iframe events (non-iframe events go to shNavHandler)
        return;
    }
    const url = event.url;
    console.log(`frame-navigation url=${url} frame=${event.frame.name}`);
    if (event.frame.name == "webview") {
        // "webview" links always open in new window
        // this will *not* effect the initial load because srcdoc does not count as an electron navigation
        console.log("open external, frameNav", url);
        event.preventDefault();
        electron.shell.openExternal(url);
        return;
    }
    if (
        event.frame.name == "pdfview" &&
        (url.startsWith("blob:file:///") ||
            url.startsWith(getWebServerEndpoint() + "/wave/stream-file?") ||
            url.startsWith(getWebServerEndpoint() + "/wave/stream-file/") ||
            url.startsWith(getWebServerEndpoint() + "/wave/stream-local-file?"))
    ) {
        // allowed
        return;
    }
    if (event.frame.name != null && event.frame.name.startsWith("tsunami:")) {
        // Parse port from frame name: tsunami:[port]:[blockid]
        const nameParts = event.frame.name.split(":");
        const expectedPort = nameParts.length >= 2 ? nameParts[1] : null;

        try {
            const tsunamiUrl = new URL(url);
            if (
                tsunamiUrl.protocol === "http:" &&
                tsunamiUrl.hostname === "localhost" &&
                expectedPort &&
                tsunamiUrl.port === expectedPort
            ) {
                // allowed
                return;
            }
            // If navigation is not to expected port, open externally
            event.preventDefault();
            electron.shell.openExternal(url);
            return;
        } catch (e) {
            // Invalid URL, fall through to prevent navigation
        }
    }
    event.preventDefault();
    console.log("frame navigation canceled");
}

function isWindowFullyVisible(bounds: electron.Rectangle): boolean {
    const displays = electron.screen.getAllDisplays();

    // Helper function to check if a point is inside any display
    function isPointInDisplay(x: number, y: number) {
        for (const display of displays) {
            const { x: dx, y: dy, width, height } = display.bounds;
            if (x >= dx && x < dx + width && y >= dy && y < dy + height) {
                return true;
            }
        }
        return false;
    }

    // Check all corners of the window
    const topLeft = isPointInDisplay(bounds.x, bounds.y);
    const topRight = isPointInDisplay(bounds.x + bounds.width, bounds.y);
    const bottomLeft = isPointInDisplay(bounds.x, bounds.y + bounds.height);
    const bottomRight = isPointInDisplay(bounds.x + bounds.width, bounds.y + bounds.height);

    return topLeft && topRight && bottomLeft && bottomRight;
}

function findDisplayWithMostArea(bounds: electron.Rectangle): electron.Display {
    const displays = electron.screen.getAllDisplays();
    let maxArea = 0;
    let bestDisplay = null;

    for (let display of displays) {
        const { x, y, width, height } = display.bounds;
        const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, x + width) - Math.max(bounds.x, x));
        const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, y + height) - Math.max(bounds.y, y));
        const overlapArea = overlapX * overlapY;

        if (overlapArea > maxArea) {
            maxArea = overlapArea;
            bestDisplay = display;
        }
    }

    return bestDisplay;
}

function adjustBoundsToFitDisplay(bounds: electron.Rectangle, display: electron.Display): electron.Rectangle {
    const { x: dx, y: dy, width: dWidth, height: dHeight } = display.workArea;
    let { x, y, width, height } = bounds;

    // Adjust width and height to fit within the display's work area
    width = Math.min(width, dWidth);
    height = Math.min(height, dHeight);

    // Adjust x to ensure the window fits within the display
    if (x < dx) {
        x = dx;
    } else if (x + width > dx + dWidth) {
        x = dx + dWidth - width;
    }

    // Adjust y to ensure the window fits within the display
    if (y < dy) {
        y = dy;
    } else if (y + height > dy + dHeight) {
        y = dy + dHeight - height;
    }
    return { x, y, width, height };
}

export function ensureBoundsAreVisible(bounds: electron.Rectangle): electron.Rectangle {
    if (!isWindowFullyVisible(bounds)) {
        let targetDisplay = findDisplayWithMostArea(bounds);

        if (!targetDisplay) {
            targetDisplay = electron.screen.getPrimaryDisplay();
        }

        return adjustBoundsToFitDisplay(bounds, targetDisplay);
    }
    return bounds;
}

export function waveKeyToElectronKey(waveKey: string): string {
    const waveParts = waveKey.split(":");
    const electronParts: Array<string> = waveParts.map((part: string) => {
        const digitRegexpMatch = new RegExp("^c{Digit([0-9])}$").exec(part);
        const numpadRegexpMatch = new RegExp("^c{Numpad([0-9])}$").exec(part);
        const lowercaseCharMatch = new RegExp("^([a-z])$").exec(part);
        if (part == "ArrowUp") {
            return "Up";
        }
        if (part == "ArrowDown") {
            return "Down";
        }
        if (part == "ArrowLeft") {
            return "Left";
        }
        if (part == "ArrowRight") {
            return "Right";
        }
        if (part == "Soft1") {
            return "F21";
        }
        if (part == "Soft2") {
            return "F22";
        }
        if (part == "Soft3") {
            return "F23";
        }
        if (part == "Soft4") {
            return "F24";
        }
        if (part == " ") {
            return "Space";
        }
        if (part == "CapsLock") {
            return "Capslock";
        }
        if (part == "NumLock") {
            return "Numlock";
        }
        if (part == "ScrollLock") {
            return "Scrolllock";
        }
        if (part == "AudioVolumeUp") {
            return "VolumeUp";
        }
        if (part == "AudioVolumeDown") {
            return "VolumeDown";
        }
        if (part == "AudioVolumeMute") {
            return "VolumeMute";
        }
        if (part == "MediaTrackNext") {
            return "MediaNextTrack";
        }
        if (part == "MediaTrackPrevious") {
            return "MediaPreviousTrack";
        }
        if (part == "Decimal") {
            return "numdec";
        }
        if (part == "Add") {
            return "numadd";
        }
        if (part == "Subtract") {
            return "numsub";
        }
        if (part == "Multiply") {
            return "nummult";
        }
        if (part == "Divide") {
            return "numdiv";
        }
        if (digitRegexpMatch && digitRegexpMatch.length > 1) {
            return digitRegexpMatch[1];
        }
        if (numpadRegexpMatch && numpadRegexpMatch.length > 1) {
            return `num${numpadRegexpMatch[1]}`;
        }
        if (lowercaseCharMatch && lowercaseCharMatch.length > 1) {
            return lowercaseCharMatch[1].toUpperCase();
        }

        return part;
    });
    return electronParts.join("+");
}
