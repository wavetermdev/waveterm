import * as React from "react";
import * as electron from "electron";
import { parse } from "node:path";
import { v4 as uuidv4 } from "uuid";

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
    keyDescriptionsMap: Map<string, Array<KeyPressDecl>>;

    processLevel(nativeEvent: any, event: WaveKeyboardEvent, keybindsArray: Array<Keybind>): boolean {
        // iterate through keybinds in backwards order
        for (let index = keybindsArray.length - 1; index >= 0; index--) {
            let curKeybind = keybindsArray[index];
            if (this.checkKeyPressed(event, curKeybind.keybinding)) {
                let shouldReturn = false;
                if (curKeybind.callback != null) {
                    shouldReturn = curKeybind.callback(event);
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
        console.log("adding: ", keybinding);
        if (domain == "" || this.keybindingAlreadyAdded(level, domain, keybinding)) {
            console.log("already added?", keybinding);
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
        console.log("did unregister: ", didUnregister);
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
                    console.log("removing keybind: ", curKeybind.keybinding);
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
        this.keyDescriptionsMap.set("system:toggleDeveloperTools", [parseKeyDescription("Cmd:Option:i")]);
        this.keyDescriptionsMap.set("generic:cancel", [parseKeyDescription("Escape")]);
        this.keyDescriptionsMap.set("generic:confirm", [parseKeyDescription("Enter")]);
        this.keyDescriptionsMap.set("generic:deleteItem", [
            parseKeyDescription("Backspace"),
            parseKeyDescription("Delete"),
        ]);
        this.keyDescriptionsMap.set("generic:selectAbove", [parseKeyDescription("ArrowUp")]);
        this.keyDescriptionsMap.set("generic:selectBelow", [parseKeyDescription("ArrowDown")]);
        this.keyDescriptionsMap.set("generic:selectPageAbove", [parseKeyDescription("PageUp")]);
        this.keyDescriptionsMap.set("generic:selectPageBelow", [parseKeyDescription("PageDown")]);
        this.keyDescriptionsMap.set("app:openHistory", [parseKeyDescription("Cmd:h")]);
        this.keyDescriptionsMap.set("app:openTabSearchModal", [parseKeyDescription("Cmd:p")]);
        this.keyDescriptionsMap.set("app:newTab", [parseKeyDescription("Cmd:t")]);
        this.keyDescriptionsMap.set("app:focusCmdInput", [parseKeyDescription("Cmd:i")]);
        this.keyDescriptionsMap.set("app:focusSelectedLine", [parseKeyDescription("Cmd:l")]);
        this.keyDescriptionsMap.set("app:restartCommand", [parseKeyDescription("Cmd:r")]);
        this.keyDescriptionsMap.set("app:restartLastCommand", [parseKeyDescription("Cmd:Shift:r")]);
        this.keyDescriptionsMap.set("app:closeCurrentTab", [parseKeyDescription("Cmd:w")]);
        this.keyDescriptionsMap.set("app:selectLineAbove", [
            parseKeyDescription("Cmd:ArrowUp"),
            parseKeyDescription("Cmd:PageUp"),
        ]);
        this.keyDescriptionsMap.set("app:selectLineBelow", [
            parseKeyDescription("Cmd:ArrowDown"),
            parseKeyDescription("Cmd:PageDown"),
        ]);
        this.keyDescriptionsMap.set("app:selectTab-1", [parseKeyDescription("Cmd:1")]);
        this.keyDescriptionsMap.set("app:selectTab-2", [parseKeyDescription("Cmd:2")]);
        this.keyDescriptionsMap.set("app:selectTab-3", [parseKeyDescription("Cmd:3")]);
        this.keyDescriptionsMap.set("app:selectTab-4", [parseKeyDescription("Cmd:4")]);
        this.keyDescriptionsMap.set("app:selectTab-5", [parseKeyDescription("Cmd:5")]);
        this.keyDescriptionsMap.set("app:selectTab-6", [parseKeyDescription("Cmd:6")]);
        this.keyDescriptionsMap.set("app:selectTab-7", [parseKeyDescription("Cmd:7")]);
        this.keyDescriptionsMap.set("app:selectTab-8", [parseKeyDescription("Cmd:8")]);
        this.keyDescriptionsMap.set("app:selectTab-9", [parseKeyDescription("Cmd:9")]);
        let selectNumberedTabKeyPressArray = [];
        for (let num = 1; num <= 9; num++) {
            // get all of the above 9 keybindings into one array
            let curNumArray = this.keyDescriptionsMap.get("app:selectTab-" + num);
            selectNumberedTabKeyPressArray = selectNumberedTabKeyPressArray.concat(curNumArray);
        }
        // this keybinding will work for any of the above 9 keybindings. The user can then check for each one, allowing for slightly cleaner code
        this.keyDescriptionsMap.set("app:selectNumberedTab", selectNumberedTabKeyPressArray);
        this.keyDescriptionsMap.set("app:selectTabLeft", [parseKeyDescription("Cmd:[")]);
        this.keyDescriptionsMap.set("app:selectTabRight", [parseKeyDescription("Cmd:]")]);

        this.keyDescriptionsMap.set("app:selectWorkspace-1", [parseKeyDescription("Cmd:Ctrl:1")]);
        this.keyDescriptionsMap.set("app:selectWorkspace-2", [parseKeyDescription("Cmd:Ctrl:2")]);
        this.keyDescriptionsMap.set("app:selectWorkspace-3", [parseKeyDescription("Cmd:Ctrl:3")]);
        this.keyDescriptionsMap.set("app:selectWorkspace-4", [parseKeyDescription("Cmd:Ctrl:4")]);
        this.keyDescriptionsMap.set("app:selectWorkspace-5", [parseKeyDescription("Cmd:Ctrl:5")]);
        this.keyDescriptionsMap.set("app:selectWorkspace-6", [parseKeyDescription("Cmd:Ctrl:6")]);
        this.keyDescriptionsMap.set("app:selectWorkspace-7", [parseKeyDescription("Cmd:Ctrl:7")]);
        this.keyDescriptionsMap.set("app:selectWorkspace-8", [parseKeyDescription("Cmd:Ctrl:8")]);
        this.keyDescriptionsMap.set("app:selectWorkspace-9", [parseKeyDescription("Cmd:Ctrl:9")]);
        let selectNumberedWorkspaceKeyPressArray = [];
        for (let num = 1; num <= 9; num++) {
            // get all of the above 9 keybindings into one array
            let curNumArray = this.keyDescriptionsMap.get("app:selectWorkspace-" + num);
            selectNumberedWorkspaceKeyPressArray = selectNumberedWorkspaceKeyPressArray.concat(curNumArray);
        }
        // this keybinding will work for any of the above 9 keybindings. The user can then check for each one, allowing for slightly cleaner code
        this.keyDescriptionsMap.set("app:selectNumberedWorkspace", selectNumberedWorkspaceKeyPressArray);
        this.keyDescriptionsMap.set("app:toggleSidebar", [parseKeyDescription("Cmd:Ctrl:s")]);
        this.keyDescriptionsMap.set("app:deleteActiveLine", [parseKeyDescription("Cmd:d")]);
        this.keyDescriptionsMap.set("app:bookmarkActiveLine", [parseKeyDescription("Cmd:b")]);
        this.keyDescriptionsMap.set("bookmarks:edit", [parseKeyDescription("e")]);
        this.keyDescriptionsMap.set("bookmarks:copy", [parseKeyDescription("c")]);
        this.keyDescriptionsMap.set("cmdinput:autocomplete", [parseKeyDescription("Tab")]);
        this.keyDescriptionsMap.set("cmdinput:expandInput", [parseKeyDescription("Cmd:e")]);
        this.keyDescriptionsMap.set("cmdinput:clearInput", [parseKeyDescription("Ctrl:c")]);
        this.keyDescriptionsMap.set("cmdinput:cutLineLeftOfCursor", [parseKeyDescription("Ctrl:u")]);
        this.keyDescriptionsMap.set("cmdinput:previousHistoryItem", [parseKeyDescription("Ctrl:p")]);
        this.keyDescriptionsMap.set("cmdinput:nextHistoryItem", [parseKeyDescription("Ctrl:n")]);
        this.keyDescriptionsMap.set("cmdinput:cutWordLeftOfCursor", [parseKeyDescription("Ctrl:w")]);
        this.keyDescriptionsMap.set("cmdinput:paste", [parseKeyDescription("Ctrl:y")]);
        this.keyDescriptionsMap.set("cmdinput:openHistory", [parseKeyDescription("Ctrl:r")]);
        this.keyDescriptionsMap.set("cmdinput:openAIChat", [parseKeyDescription("Ctrl:Space")]);
        this.keyDescriptionsMap.set("history:closeHistory", [
            parseKeyDescription("Ctrl:g"),
            parseKeyDescription("Ctrl:c"),
        ]);
        this.keyDescriptionsMap.set("history:toggleShowRemotes", [
            parseKeyDescription("Cmd:r"),
            parseKeyDescription("Ctrl:r"),
        ]);
        this.keyDescriptionsMap.set("history:changeScope", [
            parseKeyDescription("Ctrl:s"),
            parseKeyDescription("Cmd:s"),
        ]);
        this.keyDescriptionsMap.set("history:selectNextItem", [parseKeyDescription("Ctrl:n")]);
        this.keyDescriptionsMap.set("history:selectPreviousItem", [parseKeyDescription("Ctrl:p")]);
        this.keyDescriptionsMap.set("aichat:clearHistory", [parseKeyDescription("Ctrl:l")]);
        this.keyDescriptionsMap.set("terminal:copy", [parseKeyDescription("Ctrl:Shift:c")]);
        this.keyDescriptionsMap.set("terminal:paste", [parseKeyDescription("Ctrl:Shift:v")]);
        this.keyDescriptionsMap.set("codeedit:save", [parseKeyDescription("Cmd:s")]);
        this.keyDescriptionsMap.set("codeedit:close", [parseKeyDescription("Cmd:d")]);
        this.keyDescriptionsMap.set("codeedit:togglePreview", [parseKeyDescription("Cmd:p")]);
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
            let pressed = checkKeyPressed(event, curKeyPress);
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
