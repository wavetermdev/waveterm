import * as React from "react";
import * as mobx from "mobx";
import * as electron from "electron";
import { parse } from "node:path";
import { v4 as uuidv4 } from "uuid";
import defaultKeybindingsFile from "../../assets/default-keybindings.json";
const defaultKeybindings: KeybindConfigArray = defaultKeybindingsFile;

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

const KeyTypeCodeRegex = /c{(.*)}/;
const KeyTypeKey = "key";
const KeyTypeCode = "code";

type KeybindCallback = (event: WaveKeyboardEvent) => boolean;
type KeybindConfigArray = Array<KeybindConfig>;
type KeybindConfig = { command: string; keys: Array<string>; commandStr?: string };

const Callback = "callback";
const Command = "command";

type Keybind = {
    domain: string;
    keybinding: string;
    action: string;
    callback: KeybindCallback;
    commandStr: string;
};

const KeybindLevels = ["system", "modal", "app", "pane", "plugin"];

class KeybindManager {
    domainCallbacks: Map<string, KeybindCallback>;
    levelMap: Map<string, Array<Keybind>>;
    levelArray: Array<string>;
    keyDescriptionsMap: Map<string, KeybindConfig>;
    userKeybindings: KeybindConfigArray;
    userKeybindingError: OV<string>;
    globalModel: any;

    constructor(GlobalModel: any) {
        this.levelMap = new Map();
        this.domainCallbacks = new Map();
        this.levelArray = KeybindLevels;
        for (let index = 0; index < this.levelArray.length; index++) {
            let curLevel = this.levelArray[index];
            this.levelMap.set(curLevel, new Array<Keybind>());
        }
        this.userKeybindingError = mobx.observable.box(null, {
            name: "keyutil-userKeybindingError",
        });
        this.globalModel = GlobalModel;
        this.initKeyDescriptionsMap();
    }

    initKeyDescriptionsMap() {
        mobx.action(() => {
            this.userKeybindingError.set(null);
        })();
        let newKeyDescriptions = new Map();
        for (let index = 0; index < defaultKeybindings.length; index++) {
            let curKeybind = defaultKeybindings[index];
            newKeyDescriptions.set(curKeybind.command, curKeybind);
        }
        let curUserCommand = "";
        if (this.userKeybindings != null && this.userKeybindings instanceof Array) {
            try {
                for (let index = 0; index < this.userKeybindings.length; index++) {
                    let curKeybind = this.userKeybindings[index];
                    if (curKeybind == null) {
                        throw new Error("keybind entry is null");
                    }
                    curUserCommand = curKeybind.command;
                    if (typeof curKeybind.command != "string") {
                        throw new Error("invalid keybind command");
                    }
                    if (curKeybind.keys == null || !(curKeybind.keys instanceof Array)) {
                        throw new Error("invalid keybind keys");
                    }
                    for (let key of curKeybind.keys) {
                        if (typeof key != "string") {
                            throw new Error("invalid keybind key");
                        }
                    }
                    let defaultCmd = this.keyDescriptionsMap.get(curKeybind.command);
                    if (
                        defaultCmd != null &&
                        defaultCmd.commandStr != null &&
                        (curKeybind.commandStr == null || curKeybind.commandStr == "")
                    ) {
                        curKeybind.commandStr = this.keyDescriptionsMap.get(curKeybind.command).commandStr;
                    }
                    newKeyDescriptions.set(curKeybind.command, curKeybind);
                }
            } catch (e) {
                let userError = `${curUserCommand} is invalid: error: ${e}`;
                console.log(userError);
                mobx.action(() => {
                    this.userKeybindingError.set(userError);
                })();
            }
        }
        this.keyDescriptionsMap = newKeyDescriptions;
    }

    runSlashCommand(curKeybind: Keybind): boolean {
        let curConfigKeybind = this.keyDescriptionsMap.get(curKeybind.keybinding);
        if (curConfigKeybind == null || curConfigKeybind.commandStr == null || curKeybind.commandStr == "") {
            return false;
        }
        let commandsList = curConfigKeybind.commandStr.trim().split(";");
        this.runIndividualSlashCommand(commandsList);
        return true;
    }

    runIndividualSlashCommand(commandsList: Array<string>): boolean {
        if (commandsList.length == 0) {
            return true;
        }
        let curCommand = commandsList.shift();
        console.log("running: ", curCommand);
        let prtn = this.globalModel.submitRawCommand(curCommand, false, false);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("error running command ", curCommand);
                return false;
            }
            return this.runIndividualSlashCommand(commandsList);
        }).catch((error) => {
            console.log("caught error running command ", curCommand, ": ", error);
            return false;
        });
    }

    processLevel(nativeEvent: any, event: WaveKeyboardEvent, keybindsArray: Array<Keybind>): boolean {
        // iterate through keybinds in backwards order
        for (let index = keybindsArray.length - 1; index >= 0; index--) {
            let curKeybind = keybindsArray[index];
            if (this.checkKeyPressed(event, curKeybind.keybinding)) {
                let shouldReturn = false;
                let shouldRunCommand = true;
                if (curKeybind.callback != null) {
                    shouldReturn = curKeybind.callback(event);
                    shouldRunCommand = false;
                }
                if (!shouldReturn && this.domainCallbacks.has(curKeybind.domain)) {
                    shouldRunCommand = false;
                    let curDomainCallback = this.domainCallbacks.get(curKeybind.domain);
                    if (curDomainCallback != null) {
                        shouldReturn = curDomainCallback(event);
                    } else {
                        console.log("domain callback for ", curKeybind.domain, " is null. This should never happen");
                    }
                }
                if (shouldRunCommand) {
                    shouldReturn = this.runSlashCommand(curKeybind);
                }
                if (shouldReturn) {
                    nativeEvent.preventDefault();
                    nativeEvent.stopPropagation();
                    return true;
                }
            }
        }
        return false;
    }

    processKeyEvent(nativeEvent: any, event: WaveKeyboardEvent) {
        let modalLevel = this.levelMap.get("modal");
        if (modalLevel.length != 0) {
            // console.log("processing modal");
            // special case when modal keybindings are present
            let shouldReturn = this.processLevel(nativeEvent, event, modalLevel);
            if (shouldReturn) {
                return;
            }
            let systemLevel = this.levelMap.get("system");
            this.processLevel(nativeEvent, event, systemLevel);
            return;
        }
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

    registerAndProcessKeyEvent(
        nativeEvent: any,
        waveEvent: WaveKeyboardEvent,
        level: string,
        domain: string,
        keybinding: string,
        callback: KeybindCallback
    ) {
        this.registerKeybinding(level, domain, keybinding, callback);
        this.processKeyEvent(nativeEvent, waveEvent);
        this.unregisterKeybinding(level, domain, keybinding);
    }

    unregisterKeybinding(level: string, domain: string, keybinding: string): boolean {
        if (!this.levelMap.has(level)) {
            return false;
        }
        let keybindsArray = this.levelMap.get(level);
        for (let index = 0; index < keybindsArray.length; index++) {
            let curKeybind = keybindsArray[index];
            if (curKeybind.domain == domain && keybindingIsEqual(curKeybind.keybinding, keybinding)) {
                // console.log("unregistering keybinding");
                keybindsArray.splice(index, 1);
                index--;
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

    setUserKeybindings(userKeybindings) {
        this.userKeybindings = userKeybindings;
        this.initKeyDescriptionsMap();
    }

    checkKeyPressed(event: WaveKeyboardEvent, keyDescription: string): boolean {
        if (keyDescription == "any") {
            return true;
        }
        if (!this.keyDescriptionsMap.has(keyDescription)) {
            return false;
        }
        let keyPressArray = this.keyDescriptionsMap.get(keyDescription).keys;
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

function checkKeyPressed(event: WaveKeyboardEvent, keyDescription: string): boolean {
    let keyPress = parseKeyDescription(keyDescription);
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

export {
    KeybindManager,
    adaptFromElectronKeyEvent,
    adaptFromReactOrNativeKeyEvent,
    setKeyUtilPlatform,
    checkKeyPressed,
};
export type { WaveKeyboardEvent };
