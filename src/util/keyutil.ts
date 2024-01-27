import * as React from "react";
import * as electron from "electron";

type KeyPressDecl = {
    mods: {
        Cmd?: boolean;
        Option?: boolean;
        Shift?: boolean;
        Ctrl?: boolean;
        Alt?: boolean;
        Meta?: boolean;
    };
    key: string;
};

var PLATFORM: string;
const PlatformMacOS: string = "darwin";

function setKeyUtilPlatform(platform: string) {
    PLATFORM = platform;
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
            rtn.key = key;
            if (key.length == 1) {
                // check for if key is upper case
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

function checkKeyPressed(event: WaveKeyboardEvent, description: string): boolean {
    let keyPress = parseKeyDescription(description);
    if (keyPress.mods.Option && !event.option) {
        return false;
    }
    if (keyPress.mods.Cmd && !event.cmd) {
        return false;
    }
    if (keyPress.mods.Shift && !event.shift) {
        return false;
    }
    if (keyPress.mods.Ctrl && !event.control) {
        return false;
    }
    if (keyPress.mods.Alt && !event.alt) {
        return false;
    }
    if (keyPress.mods.Meta && !event.meta) {
        return false;
    }
    let eventKey = event.key;
    let descKey = keyPress.key;
    if (eventKey.length == 1 && /[A-Z]/.test(eventKey.charAt(0))) {
        // key is upper case A-Z, this means shift is applied, we want to allow
        // "Shift:e" as well as "Shift:E" or "E"
        eventKey = eventKey.toLocaleLowerCase();
        descKey = descKey.toLocaleLowerCase();
    } else if (eventKey == " ") {
        eventKey = "Space";
        // a space key is shown as " ", we want users to be able to set space key as "Space" or " ", whichever they prefer
    }
    if (descKey != eventKey) {
        return false;
    }
    return true;
}

// Cmd and Option are portable between Mac and Linux/Windows
type ModKeyStrs = "Cmd" | "Option" | "Shift" | "Ctrl" | "Alt" | "Meta";

interface WaveKeyboardEvent {
    type: string;
    /**
     * Equivalent to KeyboardEvent.key.
     */
    key: string;
    /**
     * Equivalent to KeyboardEvent.code.
     */
    code: string;
    /**
     * Equivalent to KeyboardEvent.shiftKey.
     */
    shift: boolean;
    /**
     * Equivalent to KeyboardEvent.controlKey.
     */
    control: boolean;
    /**
     * Equivalent to KeyboardEvent.altKey.
     */
    alt: boolean;
    /**
     * Equivalent to KeyboardEvent.metaKey.
     */
    meta: boolean;
    /**
     * cmd is special, on mac it is meta, on windows it is alt
     */
    cmd: boolean;
    /**
     * option is special, on mac it is alt, on windows it is meta
     */
    option: boolean;

    repeat: boolean;
    /**
     * Equivalent to KeyboardEvent.location.
     */
    location: number;
}

function adaptFromReactOrNativeKeyEvent(event: React.KeyboardEvent | KeyboardEvent): WaveKeyboardEvent {
    let rtn: WaveKeyboardEvent = {} as WaveKeyboardEvent;
    rtn.control = event.ctrlKey;
    rtn.shift = event.shiftKey;
    rtn.cmd = (PLATFORM == PlatformMacOS ? event.metaKey : event.altKey);
    rtn.option = (PLATFORM == PlatformMacOS ? event.altKey : event.metaKey);
    rtn.meta = event.metaKey;
    rtn.alt = event.altKey;
    rtn.code = event.code;
    rtn.key = event.key;
    rtn.location = event.location;
    rtn.type = event.type;
    rtn.repeat = event.repeat;
    return rtn;
}

function adaptFromElectronKeyEvent(event: any): WaveKeyboardEvent {
    let rtn: WaveKeyboardEvent = {} as WaveKeyboardEvent;
    rtn.type = event.type;
    rtn.control = event.control;
    rtn.cmd = (PLATFORM == PlatformMacOS ? event.meta : event.alt)
    rtn.option = (PLATFORM == PlatformMacOS ? event.alt : event.meta);
    rtn.meta = event.meta;
    rtn.alt = event.alt;
    rtn.shift = event.shift;
    rtn.repeat = event.isAutoRepeat;
    rtn.location = event.location;
    rtn.code = event.code;
    rtn.key = event.key;
    return rtn;
}

export { adaptFromElectronKeyEvent, adaptFromReactOrNativeKeyEvent, checkKeyPressed, setKeyUtilPlatform };
export type { WaveKeyboardEvent };
