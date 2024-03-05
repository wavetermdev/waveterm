import * as React from "react";
import * as electron from "electron";
import { parse } from "node:path";
import { v4 as uuidv4 } from "uuid";
import keybindings from "../../assets/keybindings.json";

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
    keyType: string;
};

const KeyTypeCodeRegex = /:c{(.*)}/;
const KeyTypeKey = "key";
const KeyTypeCode = "code";

type KeybindCallback = (event: WaveKeyboardEvent) => boolean;

type Keybind = {
    domain: string;
    keybinding: string;
    callback: KeybindCallback;
};

const KeybindLevels = ["system", "app", "pane", "plugin"];

class KeybindManager {
    domainCallbacks: Map<string, KeybindCallback>;
    levelMap: Map<string, Array<Keybind>>;
    levelArray: Array<string>;
    keyDescriptionsMap: Map<string, Array<string>>;

    processLevel(nativeEvent: any, event: WaveKeyboardEvent, keybindsArray: Array<Keybind>): boolean {
        // iterate through keybinds in backwards order
        for (let index = keybindsArray.length - 1; index >= 0; index--) {
            let curKeybind = keybindsArray[index];
            if (this.checkKeyPressed(event, curKeybind.keybinding)) {
                let shouldReturn = false;
                if (curKeybind.callback != null) {
                    console.log("Calling callback");
                    shouldReturn = curKeybind.callback(event);
                    console.log("callback return value", shouldReturn);
                }
                if (!shouldReturn && this.domainCallbacks.has(curKeybind.domain)) {
                    let curDomainCallback = this.domainCallbacks.get(curKeybind.domain);
                    if (curDomainCallback != null) {
                        shouldReturn = curDomainCallback(event);
                    } else {
                        console.log("domain callback for ", curKeybind.domain, " is null. This should never happen");
                    }
                }
                if (shouldReturn) {
                    nativeEvent.preventDefault();
                    return true;
                }
            }
        }
        return false;
    }

    processKeyEvent(nativeEvent: any, event: WaveKeyboardEvent) {
        for (let index = this.levelArray.length - 1; index >= 0; index--) {
            let curLevel = this.levelArray[index];
            let curKeybindsArray;
            if (this.levelMap.has(curLevel)) {
                curKeybindsArray = this.levelMap.get(curLevel);
            } else {
                console.error("error processing key event: couldn't find level: ", curLevel);
                continue;
            }
            let shouldReturn = this.processLevel(nativeEvent, event, curKeybindsArray);
            if (shouldReturn) {
                return;
            }
        }
    }

    keybindingAlreadyAdded(level: string, domain: string, keybinding: string) {
        if (!this.levelMap.has(level)) {
            return false;
        }
        let keybindsArray = this.levelMap.get(level);
        for (let index = 0; index < keybindsArray.length; index++) {
            let curKeybind = keybindsArray[index];
            if (curKeybind.domain == domain && keybindingIsEqual(curKeybind.keybinding, keybinding)) {
                console.log("keybinding is equal: ", curKeybind.keybinding, keybinding, curKeybind.domain, domain);
                return true;
            }
        }
        return false;
    }

    registerKeybinding(level: string, domain: string, keybinding: string, callback: KeybindCallback): boolean {
        if (domain == "" || this.keybindingAlreadyAdded(level, domain, keybinding)) {
            return false;
        }
        // TODO: check if keybinding is valid
        let newKeybind = { domain: domain, keybinding: keybinding, callback: callback } as Keybind;
        if (!this.levelMap.has(level)) {
            return false;
        }
        let curKeybindArray = this.levelMap.get(level);
        curKeybindArray.push(newKeybind);
        this.levelMap.set(level, curKeybindArray);
        return true;
    }

    registerAndCheckKeyPressed(
        nativeEvent: any,
        waveEvent: WaveKeyboardEvent,
        level: string,
        keybinding: string
    ): boolean {
        let rtn = false;
        let curDomain = String(uuidv4());
        this.registerKeybinding(level, curDomain, keybinding, (waveEvent) => {
            rtn = true;
            return true;
        });
        this.processKeyEvent(nativeEvent, waveEvent);
        let didUnregister = this.unregisterKeybinding(level, curDomain, keybinding);
        return rtn;
    }

    unregisterKeybinding(level: string, domain: string, keybinding: string): boolean {
        if (!this.levelMap.has(level)) {
            return false;
        }
        let keybindsArray = this.levelMap.get(level);
        for (let index = 0; index < keybindsArray.length; index++) {
            let curKeybind = keybindsArray[index];
            if (curKeybind.domain == domain && keybindingIsEqual(curKeybind.keybinding, keybinding)) {
                keybindsArray.splice(index, 1);
                this.levelMap.set(level, keybindsArray);
            }
            return true;
        }
        return false;
    }

    unregisterDomain(domain: string) {
        let foundKeybind = false;
        for (let levelIndex = 0; levelIndex < this.levelArray.length; levelIndex++) {
            let curLevel = this.levelArray[levelIndex];
            let curKeybindArray = this.levelMap.get(curLevel);
            for (let curArrayIndex = 0; curArrayIndex < curKeybindArray.length; curArrayIndex++) {
                let curKeybind = curKeybindArray[curArrayIndex];
                if (curKeybind.domain == domain) {
                    curKeybindArray.splice(curArrayIndex, 1);
                    curArrayIndex--;
                    foundKeybind = true;
                }
            }
        }
        this.domainCallbacks.delete(domain);
        return foundKeybind;
    }

    getKeyPressEventForDomain(domain: string, callback: KeybindCallback) {
        if (callback == null) {
            console.log("domain callback can't be null");
        }
        this.domainCallbacks.set(domain, callback);
    }

    constructor() {
        this.levelMap = new Map();
        this.domainCallbacks = new Map();
        this.levelArray = KeybindLevels;
        for (let index = 0; index < this.levelArray.length; index++) {
            let curLevel = this.levelArray[index];
            this.levelMap.set(curLevel, new Array<Keybind>());
        }
        this.initKeyDescriptionsMap();
    }

    initKeyDescriptionsMap() {
        this.keyDescriptionsMap = new Map();
        for (let index = 0; index < keybindings.length; index++) {
            let curKeybind = keybindings[index];
            this.keyDescriptionsMap.set(curKeybind.command, curKeybind.keys);
        }
        let error = false;
        let numberedTabKeybinds = [];
        for (let index = 1; index <= 9; index++) {
            let curKeybind = this.keyDescriptionsMap.get("app:selectTab-" + index);
            if (curKeybind == null) {
                error = true;
                break;
            }
            numberedTabKeybinds.push(curKeybind);
        }
        if (!error) {
            this.keyDescriptionsMap.set("app:selectNumberedTab", numberedTabKeybinds);
        }
        let numberedWorkspaceKeybinds = [];
        for (let index = 1; index <= 9; index++) {
            let curKeybind = this.keyDescriptionsMap.get("app:selectTab-" + index);
            if (curKeybind == null) {
                error = true;
                break;
            }
            numberedWorkspaceKeybinds.push(curKeybind);
        }
        if (!error) {
            this.keyDescriptionsMap.set("app:selectNumberedTab", numberedWorkspaceKeybinds);
        }
    }

    checkKeyPressed(event: WaveKeyboardEvent, keyDescription: string): boolean {
        if (keyDescription == "any") {
            return true;
        }
        if (!this.keyDescriptionsMap.has(keyDescription)) {
            return false;
        }
        let keyPressArray = this.keyDescriptionsMap.get(keyDescription);
        for (let index = 0; index < keyPressArray.length; index++) {
            let curKeyPress = keyPressArray[index];
            let curKeyPressDecl = parseKeyDescription(curKeyPress);
            let pressed = checkKeyPressed(event, curKeyPressDecl);
            if (pressed) {
                return true;
            }
        }
        return false;
    }

    checkKeysPressed(event: WaveKeyboardEvent, keyDescriptions: Array<string>) {
        for (let index = 0; index < keyDescriptions.length; index++) {
            let curKeyDesc = keyDescriptions[index];
            let pressed = this.checkKeyPressed(event, curKeyDesc);
            if (pressed) {
                return true;
            }
        }
        return false;
    }
}

var PLATFORM: string;
const PlatformMacOS: string = "darwin";

function setKeyUtilPlatform(platform: string) {
    PLATFORM = platform;
}

function keybindingIsEqual(bind1: string, bind2: string) {
    return bind1 == bind2;
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

function checkKeyPressed(event: WaveKeyboardEvent, keyPress: KeyPressDecl): boolean {
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
    rtn.cmd = PLATFORM == PlatformMacOS ? event.metaKey : event.altKey;
    rtn.option = PLATFORM == PlatformMacOS ? event.altKey : event.metaKey;
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

export { KeybindManager, adaptFromElectronKeyEvent, adaptFromReactOrNativeKeyEvent, setKeyUtilPlatform };
export type { WaveKeyboardEvent };
