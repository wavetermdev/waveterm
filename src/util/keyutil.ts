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
type KeybindConfig = { command: string; keys: Array<string>; commandStr?: string; info?: string };

const Callback = "callback";
const Command = "command";
const DumpLogs = false;

type Keybind = {
    domain: string;
    keybinding: string;
    action: string;
    callback: KeybindCallback;
    commandStr: string;
};

const KeybindLevels = ["system", "modal", "app", "mainview", "pane", "plugin", "control"];

class KeybindManager {
    domainCallbacks: Map<string, KeybindCallback>;
    levelMap: Map<string, Array<Keybind>>;
    levelArray: Array<string>;
    keyDescriptionsMap: Map<string, KeybindConfig>;
    userKeybindings: KeybindConfigArray;
    userKeybindingError: OV<string>;
    globalModel: any;
    activeKeybindsVersion: OV<number>;

    constructor(GlobalModel: any) {
        this.levelMap = new Map();
        this.domainCallbacks = new Map();
        this.levelArray = KeybindLevels;
        for (let index = 0; index < this.levelArray.length; index++) {
            let curLevel = this.levelArray[index];
            this.levelMap.set(curLevel, new Array<Keybind>());
        }
        this.userKeybindingError = mobx.observable.box(null, {
            name: "keybindManager-userKeybindingError",
        });
        this.activeKeybindsVersion = mobx.observable.box(0, {
            name: "keybindManager-activeKeybindsVersion",
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
                    // if user doesn't specify a command string or a description, we will revert to the old one
                    let defaultCmd = this.keyDescriptionsMap.get(curKeybind.command);
                    if (
                        defaultCmd != null &&
                        defaultCmd.commandStr != null &&
                        (curKeybind.commandStr == null || curKeybind.commandStr == "")
                    ) {
                        curKeybind.commandStr = this.keyDescriptionsMap.get(curKeybind.command).commandStr;
                    }
                    if (
                        defaultCmd != null &&
                        defaultCmd.info != null &&
                        (curKeybind.info == null || curKeybind.info == "")
                    ) {
                        curKeybind.info = this.keyDescriptionsMap.get(curKeybind.command).info;
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

    prettyPrintKeybind(keyDescription: string): string {
        let keyPress = parseKeyDescription(keyDescription);
        let returnString = "";
        if (keyPress.mods.Cmd) {
            returnString += "⌘";
        }
        if (keyPress.mods.Ctrl) {
            returnString += "⌃";
        }
        if (keyPress.mods.Option) {
            returnString += "⌥";
        }
        if (keyPress.mods.Shift) {
            returnString += "⇧";
        }
        if (keyPress.mods.Meta) {
            returnString += "M";
        }
        if (keyPress.mods.Alt) {
            returnString += "⌥";
        }
        returnString += keyPress.key;
        return returnString;
    }

    getUIDescription(keyDescription: string, prettyPrint: boolean = true): KeybindConfig {
        let keybinds = this.getKeybindsFromDescription(keyDescription, prettyPrint);
        if (!this.keyDescriptionsMap.has(keyDescription)) {
            return { keys: keybinds, info: "", command: keyDescription, commandStr: "" };
        }
        let curKeybindConfig = this.keyDescriptionsMap.get(keyDescription);
        let curInfo = "";
        if (curKeybindConfig.info) {
            curInfo = curKeybindConfig.info;
        }
        let curCommandStr = "";
        if (curKeybindConfig.commandStr) {
            curCommandStr = curKeybindConfig.commandStr;
        }
        return { keys: keybinds, info: curInfo, commandStr: curCommandStr, command: keyDescription };
    }

    getKeybindsFromDescription(keyDescription: string, prettyPrint: boolean = true): Array<string> {
        if (!this.keyDescriptionsMap.has(keyDescription)) {
            return [];
        }
        let keyBinds = this.keyDescriptionsMap.get(keyDescription).keys;
        if (!prettyPrint) {
            return keyBinds;
        }
        let keybindsArray = [];
        for (let index = 0; index < keyBinds.length; index++) {
            let curKeybind = keyBinds[index];
            let curPrettyPrintString = this.prettyPrintKeybind(curKeybind);
            keybindsArray.push(curPrettyPrintString);
        }
        return keybindsArray;
    }

    getAllKeybindUIDescriptions(prettyPrint: boolean = true): KeybindConfigArray {
        let keybindsList = [];
        let keybindDescriptions = this.keyDescriptionsMap.keys();
        for (let keyDesc of keybindDescriptions) {
            keybindsList.push(this.getUIDescription(keyDesc, prettyPrint));
        }
        return keybindsList;
    }

    getAllKeybinds(prettyPrint: boolean = true): Array<Array<string>> {
        let keybindsList = [];
        let keybindDescriptions = this.keyDescriptionsMap.keys();
        for (let keyDesc of keybindDescriptions) {
            keybindsList.push(this.getKeybindsFromDescription(keyDesc, prettyPrint));
        }
        return keybindsList;
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

    runDomainCallbacks(event: WaveKeyboardEvent, curDomainCallbacks: Map<string, KeybindCallback>) {
        for (let key of curDomainCallbacks.keys()) {
            let callback = curDomainCallbacks.get(key);
            if (callback != null) {
                callback(event);
            }
        }
    }

    processLevel(nativeEvent: any, event: WaveKeyboardEvent, keybindsArray: Array<Keybind>): boolean {
        // iterate through keybinds in backwards order
        let domainCallbacksToRun: Map<string, KeybindCallback> = new Map();
        for (let index = keybindsArray.length - 1; index >= 0; index--) {
            let curKeybind = keybindsArray[index];
            if (this.domainCallbacks.has(curKeybind.domain)) {
                let curDomainCallback = this.domainCallbacks.get(curKeybind.domain);
                if (curDomainCallback != null) {
                    domainCallbacksToRun.set(curKeybind.domain, curDomainCallback);
                }
            }
            if (this.checkKeyPressed(event, curKeybind.keybinding)) {
                if (DumpLogs) {
                    console.log("keybind found", curKeybind);
                }
                let shouldReturn = false;
                let shouldRunCommand = true;
                if (curKeybind.callback != null) {
                    shouldReturn = curKeybind.callback(event);
                    shouldRunCommand = false;
                }
                if (shouldRunCommand) {
                    shouldReturn = this.runSlashCommand(curKeybind);
                }
                if (shouldReturn) {
                    nativeEvent.preventDefault();
                    nativeEvent.stopPropagation();
                    this.runDomainCallbacks(event, domainCallbacksToRun);
                    return true;
                }
            }
        }
        this.runDomainCallbacks(event, domainCallbacksToRun);
        return false;
    }

    processKeyEvent(nativeEvent: any, event: WaveKeyboardEvent): boolean {
        let modalLevel = this.levelMap.get("modal");
        if (modalLevel.length != 0) {
            // console.log("processing modal");
            // special case when modal keybindings are present
            let controlLevel = this.levelMap.get("control");
            let shouldReturn = this.processLevel(nativeEvent, event, controlLevel);
            if (shouldReturn) {
                return true;
            }
            shouldReturn = this.processLevel(nativeEvent, event, modalLevel);
            if (shouldReturn) {
                return true;
            }
            let systemLevel = this.levelMap.get("system");
            return this.processLevel(nativeEvent, event, systemLevel);
        }
        if (DumpLogs) {
            console.log("levels:", this.levelMap, "event:", event);
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
                return true;
            }
        }
        return false;
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

    getActiveKeybindsVersion() {
        return this.activeKeybindsVersion.get();
    }

    checkKeyInKeybinding(key: string, keyDescription: string) {
        if (keyDescription == "any") {
            return true;
        }
        if (!this.keyDescriptionsMap.has(keyDescription)) {
            return false;
        }
        let keyPressArray = this.keyDescriptionsMap.get(keyDescription).keys;
        for (let index = 0; index < keyPressArray.length; index++) {
            let curKeyPress = keyPressArray[index];
            if (keybindingIsEqual(key, curKeyPress)) {
                return true;
            }
        }
        return false;
    }

    lookupKeyInLevel(key: string, level: Array<Keybind>): Array<Keybind> {
        let toReturn: Array<Keybind> = [];
        for (let index = level.length - 1; index >= 0; index--) {
            let curKeybind = level[index];
            console.log("index", index, "curKeybind: ", curKeybind);
            if (this.checkKeyInKeybinding(key, curKeybind.keybinding)) {
                toReturn.push({ ...curKeybind }); // shallow copy
            }
        }
        return toReturn;
    }

    lookupKey(key: string) {
        let modalLevel = this.levelMap.get("modal");
        let toReturn: Array<Keybind> = [];
        if (modalLevel.length != 0) {
            let controlLevel = this.levelMap.get("control");
            toReturn = toReturn.concat(this.lookupKeyInLevel(key, controlLevel));
            toReturn = toReturn.concat(this.lookupKeyInLevel(key, modalLevel));
            let systemLevel = this.levelMap.get("system");
            toReturn = toReturn.concat(this.lookupKeyInLevel(key, systemLevel));
            return toReturn;
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
            toReturn = toReturn.concat(this.lookupKeyInLevel(key, curKeybindsArray));
        }
        return toReturn;
    }

    getDomainListForLevel(level: Array<Keybind>): Array<string> {
        let toReturn: Array<string> = [];
        for (let index = 0; index < level.length; index++) {
            let curDomain = level[index].domain;
            if (!toReturn.includes(curDomain)) {
                toReturn.push(curDomain);
            }
        }
        return toReturn;
    }

    getActiveKeybindings(): Array<{ name: string; domains: Array<string> }> {
        let modalLevel = this.levelMap.get("modal");
        let toReturn: Array<{ name: string; domains: Array<string> }> = [];
        if (modalLevel.length != 0) {
            let controlLevel = this.levelMap.get("control");
            toReturn.push({ name: "control", domains: this.getDomainListForLevel(controlLevel) });
            toReturn.push({ name: "modal", domains: this.getDomainListForLevel(modalLevel) });
            let systemLevel = this.levelMap.get("system");
            toReturn.push({ name: "system", domains: this.getDomainListForLevel(systemLevel) });
            return toReturn;
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
            toReturn.push({ name: curLevel, domains: this.getDomainListForLevel(curKeybindsArray) });
        }
        return toReturn;
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
        mobx.action(() => {
            this.activeKeybindsVersion.set(this.activeKeybindsVersion.get() + 1);
        })();
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
                return true;
            }
            mobx.action(() => {
                this.activeKeybindsVersion.set(this.activeKeybindsVersion.get() + 1);
            })();
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
        mobx.action(() => {
            this.activeKeybindsVersion.set(this.activeKeybindsVersion.get() + 1);
        })();
        return foundKeybind;
    }

    registerDomainCallback(domain: string, callback: KeybindCallback) {
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

function notMod(keyPressMod, eventMod) {
    if (keyPressMod != true) {
        keyPressMod = false;
    }
    return (keyPressMod && !eventMod) || (eventMod && !keyPressMod);
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
