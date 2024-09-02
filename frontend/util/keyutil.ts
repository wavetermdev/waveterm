// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as util from "./util";

const KeyTypeCodeRegex = /c{(.*)}/;
const KeyTypeKey = "key";
const KeyTypeCode = "code";

let PLATFORM: NodeJS.Platform = "darwin";
const PlatformMacOS = "darwin";

function setKeyUtilPlatform(platform: NodeJS.Platform) {
    PLATFORM = platform;
}

function getKeyUtilPlatform(): NodeJS.Platform {
    return PLATFORM;
}

function keydownWrapper(
    fn: (waveEvent: WaveKeyboardEvent) => boolean
): (event: KeyboardEvent | React.KeyboardEvent) => void {
    return (event: KeyboardEvent | React.KeyboardEvent) => {
        const waveEvent = adaptFromReactOrNativeKeyEvent(event);
        const rtnVal = fn(waveEvent);
        if (rtnVal) {
            event.preventDefault();
            event.stopPropagation();
        }
    };
}

function parseKey(key: string): { key: string; type: string } {
    let regexMatch = key.match(KeyTypeCodeRegex);
    if (regexMatch != null && regexMatch.length > 1) {
        let code = regexMatch[1];
        return { key: code, type: KeyTypeCode };
    } else if (regexMatch != null) {
        console.log("error: regexMatch is not null yet there is no captured group: ", regexMatch, key);
    }
    return { key: key, type: KeyTypeKey };
}

function parseKeyDescription(keyDescription: string): KeyPressDecl {
    let rtn = { key: "", mods: {} } as KeyPressDecl;
    let keys = keyDescription.replace(/[()]/g, "").split(":");
    for (let key of keys) {
        if (key == "Cmd") {
            rtn.mods.Cmd = true;
        } else if (key == "Shift") {
            rtn.mods.Shift = true;
        } else if (key == "Ctrl") {
            rtn.mods.Ctrl = true;
        } else if (key == "Option") {
            rtn.mods.Option = true;
        } else if (key == "Alt") {
            rtn.mods.Alt = true;
        } else if (key == "Meta") {
            rtn.mods.Meta = true;
        } else {
            let { key: parsedKey, type: keyType } = parseKey(key);
            rtn.key = parsedKey;
            rtn.keyType = keyType;
            if (rtn.keyType == KeyTypeKey && key.length == 1) {
                // check for if key is upper case
                // TODO what about unicode upper case?
                if (/[A-Z]/.test(key.charAt(0))) {
                    // this key is an upper case A - Z - we should apply the shift key, even if it wasn't specified
                    rtn.mods.Shift = true;
                } else if (key == " ") {
                    rtn.key = "Space";
                    // we allow " " and "Space" to be mapped to Space key
                }
            }
        }
    }
    return rtn;
}

function notMod(keyPressMod: boolean, eventMod: boolean) {
    return (keyPressMod && !eventMod) || (eventMod && !keyPressMod);
}

function isCharacterKeyEvent(event: WaveKeyboardEvent): boolean {
    if (event.alt || event.meta || event.control) {
        return false;
    }
    return util.countGraphemes(event.key) == 1;
}

const inputKeyMap = new Map<string, boolean>([
    ["Backspace", true],
    ["Delete", true],
    ["Enter", true],
    ["Space", true],
    ["Tab", true],
    ["ArrowLeft", true],
    ["ArrowRight", true],
    ["ArrowUp", true],
    ["ArrowDown", true],
    ["Home", true],
    ["End", true],
    ["PageUp", true],
    ["PageDown", true],
    ["Cmd:a", true],
    ["Cmd:c", true],
    ["Cmd:v", true],
    ["Cmd:x", true],
    ["Cmd:z", true],
    ["Cmd:Shift:z", true],
    ["Cmd:ArrowLeft", true],
    ["Cmd:ArrowRight", true],
    ["Cmd:Backspace", true],
    ["Cmd:Delete", true],
    ["Shift:ArrowLeft", true],
    ["Shift:ArrowRight", true],
    ["Shift:ArrowUp", true],
    ["Shift:ArrowDown", true],
    ["Shift:Home", true],
    ["Shift:End", true],
    ["Cmd:Shift:ArrowLeft", true],
    ["Cmd:Shift:ArrowRight", true],
    ["Cmd:Shift:ArrowUp", true],
    ["Cmd:Shift:ArrowDown", true],
]);

function isInputEvent(event: WaveKeyboardEvent): boolean {
    if (isCharacterKeyEvent(event)) {
        return true;
    }
    for (let key of inputKeyMap.keys()) {
        if (checkKeyPressed(event, key)) {
            return true;
        }
    }
}

function checkKeyPressed(event: WaveKeyboardEvent, keyDescription: string): boolean {
    let keyPress = parseKeyDescription(keyDescription);
    if (!keyPress.mods.Alt && notMod(keyPress.mods.Option, event.option)) {
        return false;
    }
    if (!keyPress.mods.Meta && notMod(keyPress.mods.Cmd, event.cmd)) {
        return false;
    }
    if (notMod(keyPress.mods.Shift, event.shift)) {
        return false;
    }
    if (notMod(keyPress.mods.Ctrl, event.control)) {
        return false;
    }
    if (keyPress.mods.Alt && !event.alt) {
        return false;
    }
    if (keyPress.mods.Meta && !event.meta) {
        return false;
    }
    let eventKey = "";
    let descKey = keyPress.key;
    if (keyPress.keyType == KeyTypeCode) {
        eventKey = event.code;
    }
    if (keyPress.keyType == KeyTypeKey) {
        eventKey = event.key;
        if (eventKey.length == 1 && /[A-Z]/.test(eventKey.charAt(0))) {
            // key is upper case A-Z, this means shift is applied, we want to allow
            // "Shift:e" as well as "Shift:E" or "E"
            eventKey = eventKey.toLocaleLowerCase();
            descKey = descKey.toLocaleLowerCase();
        } else if (eventKey == " ") {
            eventKey = "Space";
            // a space key is shown as " ", we want users to be able to set space key as "Space" or " ", whichever they prefer
        }
    }
    if (descKey != eventKey) {
        return false;
    }
    return true;
}

function adaptFromReactOrNativeKeyEvent(event: React.KeyboardEvent | KeyboardEvent): WaveKeyboardEvent {
    let rtn: WaveKeyboardEvent = {} as WaveKeyboardEvent;
    rtn.control = event.ctrlKey;
    rtn.shift = event.shiftKey;
    rtn.cmd = PLATFORM == PlatformMacOS ? event.metaKey : event.altKey;
    rtn.option = PLATFORM == PlatformMacOS ? event.altKey : event.metaKey;
    rtn.meta = event.metaKey;
    rtn.alt = event.altKey;
    rtn.code = event.code;
    rtn.key = event.key;
    rtn.location = event.location;
    if (event.type == "keydown" || event.type == "keyup" || event.type == "keypress") {
        rtn.type = event.type;
    } else {
        rtn.type = "unknown";
    }
    rtn.repeat = event.repeat;
    return rtn;
}

function adaptFromElectronKeyEvent(event: any): WaveKeyboardEvent {
    let rtn: WaveKeyboardEvent = {} as WaveKeyboardEvent;
    if (event.type == "keyUp") {
        rtn.type = "keyup";
    } else if (event.type == "keyDown") {
        rtn.type = "keydown";
    } else {
        rtn.type = "unknown";
    }
    rtn.control = event.control;
    rtn.cmd = PLATFORM == PlatformMacOS ? event.meta : event.alt;
    rtn.option = PLATFORM == PlatformMacOS ? event.alt : event.meta;
    rtn.meta = event.meta;
    rtn.alt = event.alt;
    rtn.shift = event.shift;
    rtn.repeat = event.isAutoRepeat;
    rtn.location = event.location;
    rtn.code = event.code;
    rtn.key = event.key;
    return rtn;
}

export {
    adaptFromElectronKeyEvent,
    adaptFromReactOrNativeKeyEvent,
    checkKeyPressed,
    getKeyUtilPlatform,
    isCharacterKeyEvent,
    isInputEvent,
    keydownWrapper,
    parseKeyDescription,
    setKeyUtilPlatform,
};
