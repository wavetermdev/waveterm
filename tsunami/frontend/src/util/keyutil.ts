// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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
    fn: (waveEvent: VDomKeyboardEvent) => boolean
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

function waveEventToKeyDesc(waveEvent: VDomKeyboardEvent): string {
    let keyDesc: string[] = [];
    if (waveEvent.cmd) {
        keyDesc.push("Cmd");
    }
    if (waveEvent.option) {
        keyDesc.push("Option");
    }
    if (waveEvent.meta) {
        keyDesc.push("Meta");
    }
    if (waveEvent.control) {
        keyDesc.push("Ctrl");
    }
    if (waveEvent.shift) {
        keyDesc.push("Shift");
    }
    if (waveEvent.key != null && waveEvent.key != "") {
        if (waveEvent.key == " ") {
            keyDesc.push("Space");
        } else {
            keyDesc.push(waveEvent.key);
        }
    } else {
        keyDesc.push("c{" + waveEvent.code + "}");
    }
    return keyDesc.join(":");
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
            if (PLATFORM == PlatformMacOS) {
                rtn.mods.Meta = true;
            } else {
                rtn.mods.Alt = true;
            }
            rtn.mods.Cmd = true;
        } else if (key == "Shift") {
            rtn.mods.Shift = true;
        } else if (key == "Ctrl") {
            rtn.mods.Ctrl = true;
        } else if (key == "Option") {
            if (PLATFORM == PlatformMacOS) {
                rtn.mods.Alt = true;
            } else {
                rtn.mods.Meta = true;
            }
            rtn.mods.Option = true;
        } else if (key == "Alt") {
            if (PLATFORM == PlatformMacOS) {
                rtn.mods.Option = true;
            } else {
                rtn.mods.Cmd = true;
            }
            rtn.mods.Alt = true;
        } else if (key == "Meta") {
            if (PLATFORM == PlatformMacOS) {
                rtn.mods.Cmd = true;
            } else {
                rtn.mods.Option = true;
            }
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

function countGraphemes(str: string): number {
    if (str == null) {
        return 0;
    }
    // this exists (need to hack TS to get it to not show an error)
    const seg = new (Intl as any).Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(seg.segment(str)).length;
}

function isCharacterKeyEvent(event: VDomKeyboardEvent): boolean {
    if (event.alt || event.meta || event.control) {
        return false;
    }
    return countGraphemes(event.key) == 1;
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

function isInputEvent(event: VDomKeyboardEvent): boolean {
    if (isCharacterKeyEvent(event)) {
        return true;
    }
    for (let key of inputKeyMap.keys()) {
        if (checkKeyPressed(event, key)) {
            return true;
        }
    }
}

function checkKeyPressed(event: VDomKeyboardEvent, keyDescription: string): boolean {
    let keyPress = parseKeyDescription(keyDescription);
    if (notMod(keyPress.mods.Option, event.option)) {
        return false;
    }
    if (notMod(keyPress.mods.Cmd, event.cmd)) {
        return false;
    }
    if (notMod(keyPress.mods.Shift, event.shift)) {
        return false;
    }
    if (notMod(keyPress.mods.Ctrl, event.control)) {
        return false;
    }
    if (notMod(keyPress.mods.Alt, event.alt)) {
        return false;
    }
    if (notMod(keyPress.mods.Meta, event.meta)) {
        return false;
    }
    let eventKey = "";
    let descKey = keyPress.key;
    if (keyPress.keyType == KeyTypeCode) {
        eventKey = event.code;
    }
    if (keyPress.keyType == KeyTypeKey) {
        eventKey = event.key;
        if (eventKey != null && eventKey.length == 1 && /[A-Z]/.test(eventKey.charAt(0))) {
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

function adaptFromReactOrNativeKeyEvent(event: React.KeyboardEvent | KeyboardEvent): VDomKeyboardEvent {
    let rtn: VDomKeyboardEvent = {} as VDomKeyboardEvent;
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

function adaptFromElectronKeyEvent(event: any): VDomKeyboardEvent {
    let rtn: VDomKeyboardEvent = {} as VDomKeyboardEvent;
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

const keyMap = {
    Enter: "\r",
    Backspace: "\x7f",
    Tab: "\t",
    Escape: "\x1b",
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Insert: "\x1b[2~",
    Delete: "\x1b[3~",
    Home: "\x1b[1~",
    End: "\x1b[4~",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
};

function keyboardEventToASCII(event: VDomKeyboardEvent): string {
    // check modifiers
    // if no modifiers are set, just send the key
    if (!event.alt && !event.control && !event.meta) {
        if (event.key == null || event.key == "") {
            return "";
        }
        if (keyMap[event.key] != null) {
            return keyMap[event.key];
        }
        if (event.key.length == 1) {
            return event.key;
        } else {
            console.log("not sending keyboard event", event.key, event);
        }
    }
    // if meta or alt is set, there is no ASCII representation
    if (event.meta || event.alt) {
        return "";
    }
    // if ctrl is set, if it is a letter, subtract 64 from the uppercase value to get the ASCII value
    if (event.control) {
        if (
            (event.key.length === 1 && event.key >= "A" && event.key <= "Z") ||
            (event.key >= "a" && event.key <= "z")
        ) {
            const key = event.key.toUpperCase();
            return String.fromCharCode(key.charCodeAt(0) - 64);
        }
    }
    return "";
}

export {
    adaptFromElectronKeyEvent,
    adaptFromReactOrNativeKeyEvent,
    checkKeyPressed,
    getKeyUtilPlatform,
    isCharacterKeyEvent,
    isInputEvent,
    keyboardEventToASCII,
    keydownWrapper,
    parseKeyDescription,
    setKeyUtilPlatform,
    waveEventToKeyDesc,
};
