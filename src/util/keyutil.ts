import * as React from "react";
import * as electron from "electron";

type KeyPressDecl = {
    mods: {
        Cmd?: boolean;
        Option?: boolean;
        Shift?: boolean;
        Ctrl?: boolean;
    };
    key: string;
};

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
    if (keyPress.mods.Option && !event.alt) {
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

type ModKeyStrs = "Cmd" | "Option" | "Shift" | "Ctrl";

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
    cmd: boolean;
    repeat: boolean;
    /**
     * Equivalent to KeyboardEvent.location.
     */
    location: number;
}

function adaptFromReactOrNativeKeyEvent(event: React.KeyboardEvent | KeyboardEvent): WaveKeyboardEvent {
    let rtn: WaveKeyboardEvent = {} as WaveKeyboardEvent;
    rtn.alt = event.altKey;
    rtn.control = event.ctrlKey;
    rtn.shift = event.shiftKey;
    rtn.cmd = event.metaKey;
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
    rtn.alt = event.alt;
    rtn.control = event.control;
    rtn.cmd = event.meta;
    rtn.shift = event.shift;
    rtn.repeat = event.isAutoRepeat;
    rtn.location = event.location;
    rtn.code = event.code;
    rtn.key = event.key;
    return rtn;
}

export { adaptFromElectronKeyEvent, adaptFromReactOrNativeKeyEvent, checkKeyPressed };
export type { WaveKeyboardEvent };
