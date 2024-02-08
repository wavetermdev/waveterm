// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import {
    handleJsonFetchResponse,
    base64ToString,
    base64ToArray,
    genMergeData,
    genMergeDataMap,
    genMergeSimpleData,
    isModKeyPress,
    isBlank,
} from "../util/util";
import {
    SessionDataType,
    LineType,
    RemoteType,
    RemoteInstanceType,
    CmdDataType,
    FeCmdPacketType,
    ScreenDataType,
    PtyDataUpdateType,
    ModelUpdateType,
    UpdateMessage,
    InfoType,
    StrWithPos,
    UIContextType,
    ContextMenuOpts,
    RendererContext,
    ClientDataType,
    AlertMessageType,
    ScreenLinesType,
    RemoteViewType,
    CommandRtnType,
    LineFocusType,
    CmdInputTextPacketType,
    FileInfoType,
    ExtFile,
    HistorySearchParams,
    LineStateType,
} from "../types/types";
import { WSControl } from "./ws";
import { cmdStatusIsRunning } from "../app/line/lineutil";
import * as appconst from "../app/appconst";
import { remotePtrToString, cmdPacketString } from "../util/modelutil";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent, setKeyUtilPlatform } from "../util/keyutil";
import { OV, OArr, OMap, CV } from "../types/types";
import { Session } from "./session";
import { ScreenLines } from "./screenlines";
import { InputModel } from "./input";
import { PluginsModel } from "./plugins";
import { BookmarksModel } from "./bookmarks";
import { HistoryViewModel } from "./historyview";
import { ConnectionsViewModel } from "./connectionsview";
import { ClientSettingsViewModel } from "./clientsettingsview";
import { RemotesModel } from "./remotes";
import { ModalsModel } from "./modals";
import { MainSidebarModel } from "./mainsidebar";
import { Screen } from "./screen";
import { Cmd } from "./cmd";

type KeyModsType = {
    meta?: boolean;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
};

type SWLinePtr = {
    line: LineType;
    slines: ScreenLines;
    screen: Screen;
};

type ElectronApi = {
    getId: () => string;
    getIsDev: () => boolean;
    getPlatform: () => string;
    getAuthKey: () => string;
    getWaveSrvStatus: () => boolean;
    restartWaveSrv: () => boolean;
    reloadWindow: () => void;
    openExternalLink: (url: string) => void;
    onTCmd: (callback: (mods: KeyModsType) => void) => void;
    onICmd: (callback: (mods: KeyModsType) => void) => void;
    onLCmd: (callback: (mods: KeyModsType) => void) => void;
    onHCmd: (callback: (mods: KeyModsType) => void) => void;
    onPCmd: (callback: (mods: KeyModsType) => void) => void;
    onRCmd: (callback: (mods: KeyModsType) => void) => void;
    onWCmd: (callback: (mods: KeyModsType) => void) => void;
    onMenuItemAbout: (callback: () => void) => void;
    onMetaArrowUp: (callback: () => void) => void;
    onMetaArrowDown: (callback: () => void) => void;
    onMetaPageUp: (callback: () => void) => void;
    onMetaPageDown: (callback: () => void) => void;
    onBracketCmd: (callback: (event: any, arg: { relative: number }, mods: KeyModsType) => void) => void;
    onDigitCmd: (callback: (event: any, arg: { digit: number }, mods: KeyModsType) => void) => void;
    contextScreen: (screenOpts: { screenId: string }, position: { x: number; y: number }) => void;
    contextEditMenu: (position: { x: number; y: number }, opts: ContextMenuOpts) => void;
    onWaveSrvStatusChange: (callback: (status: boolean, pid: number) => void) => void;
    getLastLogs: (numOfLines: number, callback: (logs: any) => void) => void;
};

function getApi(): ElectronApi {
    return (window as any).api;
}

class Model {
    clientId: string;
    activeSessionId: OV<string> = mobx.observable.box(null, {
        name: "activeSessionId",
    });
    sessionListLoaded: OV<boolean> = mobx.observable.box(false, {
        name: "sessionListLoaded",
    });
    sessionList: OArr<Session> = mobx.observable.array([], {
        name: "SessionList",
        deep: false,
    });
    screenMap: OMap<string, Screen> = mobx.observable.map({}, { name: "ScreenMap", deep: false });
    ws: WSControl;
    remotes: OArr<RemoteType> = mobx.observable.array([], {
        name: "remotes",
        deep: false,
    });
    remotesLoaded: OV<boolean> = mobx.observable.box(false, {
        name: "remotesLoaded",
    });
    screenLines: OMap<string, ScreenLines> = mobx.observable.map({}, { name: "screenLines", deep: false }); // key = "sessionid/screenid" (screenlines)
    termUsedRowsCache: Record<string, number> = {}; // key = "screenid/lineid"
    debugCmds: number = 0;
    debugScreen: OV<boolean> = mobx.observable.box(false);
    waveSrvRunning: OV<boolean>;
    authKey: string;
    isDev: boolean;
    platform: string;
    activeMainView: OV<
        "plugins" | "session" | "history" | "bookmarks" | "webshare" | "connections" | "clientsettings"
    > = mobx.observable.box("session", {
        name: "activeMainView",
    });
    termFontSize: CV<number>;
    alertMessage: OV<AlertMessageType> = mobx.observable.box(null, {
        name: "alertMessage",
    });
    alertPromiseResolver: (result: boolean) => void;
    aboutModalOpen: OV<boolean> = mobx.observable.box(false, {
        name: "aboutModalOpen",
    });
    screenSettingsModal: OV<{ sessionId: string; screenId: string }> = mobx.observable.box(null, {
        name: "screenSettingsModal",
    });
    sessionSettingsModal: OV<string> = mobx.observable.box(null, {
        name: "sessionSettingsModal",
    });
    clientSettingsModal: OV<boolean> = mobx.observable.box(false, {
        name: "clientSettingsModal",
    });
    lineSettingsModal: OV<number> = mobx.observable.box(null, {
        name: "lineSettingsModal",
    }); // linenum
    remotesModel: RemotesModel;

    inputModel: InputModel;
    pluginsModel: PluginsModel;
    bookmarksModel: BookmarksModel;
    historyViewModel: HistoryViewModel;
    connectionViewModel: ConnectionsViewModel;
    clientSettingsViewModel: ClientSettingsViewModel;
    modalsModel: ModalsModel;
    mainSidebarModel: MainSidebarModel;
    clientData: OV<ClientDataType> = mobx.observable.box(null, {
        name: "clientData",
    });
    showLinks: OV<boolean> = mobx.observable.box(true, {
        name: "model-showLinks",
    });
    packetSeqNum: number = 0;

    private constructor() {
        this.clientId = getApi().getId();
        this.isDev = getApi().getIsDev();
        this.authKey = getApi().getAuthKey();
        this.ws = new WSControl(this.getBaseWsHostPort(), this.clientId, this.authKey, (message: any) => {
            let interactive = message?.interactive ?? false;
            this.runUpdate(message, interactive);
        });
        this.ws.reconnect();
        this.inputModel = new InputModel(this);
        this.pluginsModel = new PluginsModel(this);
        this.bookmarksModel = new BookmarksModel(this);
        this.historyViewModel = new HistoryViewModel(this);
        this.connectionViewModel = new ConnectionsViewModel(this);
        this.clientSettingsViewModel = new ClientSettingsViewModel(this);
        this.remotesModel = new RemotesModel(this);
        this.modalsModel = new ModalsModel();
        this.mainSidebarModel = new MainSidebarModel(this);
        let isWaveSrvRunning = getApi().getWaveSrvStatus();
        this.waveSrvRunning = mobx.observable.box(isWaveSrvRunning, {
            name: "model-wavesrv-running",
        });
        this.platform = this.getPlatform();
        this.termFontSize = mobx.computed(() => {
            let cdata = this.clientData.get();
            if (cdata == null || cdata.feopts == null || cdata.feopts.termfontsize == null) {
                return appconst.DefaultTermFontSize;
            }
            let fontSize = Math.ceil(cdata.feopts.termfontsize);
            if (fontSize < appconst.MinFontSize) {
                return appconst.MinFontSize;
            }
            if (fontSize > appconst.MaxFontSize) {
                return appconst.MaxFontSize;
            }
            return fontSize;
        });
        getApi().onTCmd(this.onTCmd.bind(this));
        getApi().onICmd(this.onICmd.bind(this));
        getApi().onLCmd(this.onLCmd.bind(this));
        getApi().onHCmd(this.onHCmd.bind(this));
        getApi().onPCmd(this.onPCmd.bind(this));
        getApi().onWCmd(this.onWCmd.bind(this));
        getApi().onRCmd(this.onRCmd.bind(this));
        getApi().onMenuItemAbout(this.onMenuItemAbout.bind(this));
        getApi().onMetaArrowUp(this.onMetaArrowUp.bind(this));
        getApi().onMetaArrowDown(this.onMetaArrowDown.bind(this));
        getApi().onMetaPageUp(this.onMetaPageUp.bind(this));
        getApi().onMetaPageDown(this.onMetaPageDown.bind(this));
        getApi().onBracketCmd(this.onBracketCmd.bind(this));
        getApi().onDigitCmd(this.onDigitCmd.bind(this));
        getApi().onWaveSrvStatusChange(this.onWaveSrvStatusChange.bind(this));
        document.addEventListener("keydown", this.docKeyDownHandler.bind(this));
        document.addEventListener("selectionchange", this.docSelectionChangeHandler.bind(this));
        setTimeout(() => this.getClientDataLoop(1), 10);
    }

    static getInstance() {
        if (!(window as any).GlobalModel) {
            (window as any).GlobalModel = new Model();
        }
        return (window as any).GlobalModel;
    }

    getNextPacketSeqNum(): number {
        this.packetSeqNum++;
        return this.packetSeqNum;
    }

    getPlatform(): string {
        if (this.platform != null) {
            return this.platform;
        }
        this.platform = getApi().getPlatform();
        setKeyUtilPlatform(this.platform);
        return this.platform;
    }

    testGlobalModel() {
        return "";
    }

    needsTos(): boolean {
        let cdata = this.clientData.get();
        if (cdata == null) {
            return false;
        }
        return cdata.clientopts == null || !cdata.clientopts.acceptedtos;
    }

    refreshClient(): void {
        getApi().reloadWindow();
    }

    /**
     * Opens a new default browser window to the given url
     * @param {string} url The url to open
     */
    openExternalLink(url: string): void {
        console.log("opening external link: " + url);
        getApi().openExternalLink(url);
        console.log("finished opening external link");
    }

    refocus() {
        // givefocus() give back focus to cmd or input
        let activeScreen = this.getActiveScreen();
        if (screen == null) {
            return;
        }
        activeScreen.giveFocus();
    }

    getWebSharedScreens(): Screen[] {
        let rtn: Screen[] = [];
        for (let screen of this.screenMap.values()) {
            if (screen.shareMode.get() == "web") {
                rtn.push(screen);
            }
        }
        return rtn;
    }

    getHasClientStop(): boolean {
        if (this.clientData.get() == null) {
            return true;
        }
        let cdata = this.clientData.get();
        if (cdata.cmdstoretype == "session") {
            return true;
        }
        return false;
    }

    showAlert(alertMessage: AlertMessageType): Promise<boolean> {
        if (alertMessage.confirmflag != null) {
            let cdata = this.clientData.get();
            let noConfirm = cdata.clientopts?.confirmflags?.[alertMessage.confirmflag];
            if (noConfirm) {
                return Promise.resolve(true);
            }
        }
        mobx.action(() => {
            this.alertMessage.set(alertMessage);
            this.modalsModel.pushModal(appconst.ALERT);
        })();
        let prtn = new Promise<boolean>((resolve, reject) => {
            this.alertPromiseResolver = resolve;
        });
        return prtn;
    }

    cancelAlert(): void {
        mobx.action(() => {
            this.alertMessage.set(null);
            this.modalsModel.popModal();
        })();
        if (this.alertPromiseResolver != null) {
            this.alertPromiseResolver(false);
            this.alertPromiseResolver = null;
        }
    }

    confirmAlert(): void {
        mobx.action(() => {
            this.alertMessage.set(null);
            this.modalsModel.popModal();
        })();
        if (this.alertPromiseResolver != null) {
            this.alertPromiseResolver(true);
            this.alertPromiseResolver = null;
        }
    }

    showSessionView(): void {
        mobx.action(() => {
            this.activeMainView.set("session");
        })();
    }

    showWebShareView(): void {
        mobx.action(() => {
            this.activeMainView.set("webshare");
        })();
    }

    getBaseHostPort(): string {
        if (this.isDev) {
            return appconst.DevServerEndpoint;
        }
        return appconst.ProdServerEndpoint;
    }

    setTermFontSize(fontSize: number) {
        if (fontSize < appconst.MinFontSize) {
            fontSize = appconst.MinFontSize;
        }
        if (fontSize > appconst.MaxFontSize) {
            fontSize = appconst.MaxFontSize;
        }
        mobx.action(() => {
            this.termFontSize.set(fontSize);
        })();
    }

    getBaseWsHostPort(): string {
        if (this.isDev) {
            return appconst.DevServerWsEndpoint;
        }
        return appconst.ProdServerWsEndpoint;
    }

    getFetchHeaders(): Record<string, string> {
        return {
            "x-authkey": this.authKey,
        };
    }

    docSelectionChangeHandler(e: any) {
        // nothing for now
    }

    docKeyDownHandler(e: KeyboardEvent) {
        let waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (isModKeyPress(e)) {
            return;
        }
        if (this.alertMessage.get() != null) {
            if (checkKeyPressed(waveEvent, "Escape")) {
                e.preventDefault();
                this.cancelAlert();
                return;
            }
            if (checkKeyPressed(waveEvent, "Enter")) {
                e.preventDefault();
                this.confirmAlert();
                return;
            }
            return;
        }
        if (this.activeMainView.get() == "bookmarks") {
            this.bookmarksModel.handleDocKeyDown(e);
            return;
        }
        if (this.activeMainView.get() == "history") {
            this.historyViewModel.handleDocKeyDown(e);
            return;
        }
        if (this.activeMainView.get() == "connections") {
            this.historyViewModel.handleDocKeyDown(e);
            return;
        }
        if (this.activeMainView.get() == "clientsettings") {
            this.historyViewModel.handleDocKeyDown(e);
            return;
        }
        if (checkKeyPressed(waveEvent, "Escape")) {
            e.preventDefault();
            if (this.activeMainView.get() == "webshare") {
                this.showSessionView();
                return;
            }
            if (this.clearModals()) {
                return;
            }
            let inputModel = this.inputModel;
            inputModel.toggleInfoMsg();
            if (inputModel.inputMode.get() != null) {
                inputModel.resetInputMode();
            }
            return;
        }
        if (checkKeyPressed(waveEvent, "Cmd:b")) {
            e.preventDefault();
            GlobalCommandRunner.bookmarksView();
        }
        if (this.activeMainView.get() == "session" && checkKeyPressed(waveEvent, "Cmd:Ctrl:s")) {
            e.preventDefault();
            let activeScreen = this.getActiveScreen();
            if (activeScreen != null) {
                let isSidebarOpen = activeScreen.isSidebarOpen();
                if (isSidebarOpen) {
                    GlobalCommandRunner.screenSidebarClose();
                } else {
                    GlobalCommandRunner.screenSidebarOpen();
                }
            }
        }
        if (checkKeyPressed(waveEvent, "Cmd:d")) {
            let ranDelete = this.deleteActiveLine();
            if (ranDelete) {
                e.preventDefault();
            }
        }
    }

    deleteActiveLine(): boolean {
        let activeScreen = this.getActiveScreen();
        if (activeScreen == null || activeScreen.getFocusType() != "cmd") {
            return false;
        }
        let selectedLine = activeScreen.selectedLine.get();
        if (selectedLine == null || selectedLine <= 0) {
            return false;
        }
        let line = activeScreen.getLineByNum(selectedLine);
        if (line == null) {
            return false;
        }
        let cmd = activeScreen.getCmd(line);
        if (cmd != null) {
            if (cmd.isRunning()) {
                let info: InfoType = { infomsg: "Cannot delete a running command" };
                this.inputModel.flashInfoMsg(info, 2000);
                return false;
            }
        }
        GlobalCommandRunner.lineDelete(String(selectedLine), true);
        return true;
    }

    onWCmd(e: any, mods: KeyModsType) {
        if (this.activeMainView.get() != "session") {
            return;
        }
        let activeScreen = this.getActiveScreen();
        if (activeScreen == null) {
            return;
        }
        let rtnp = this.showAlert({
            message: "Are you sure you want to delete this screen?",
            confirm: true,
        });
        rtnp.then((result) => {
            if (!result) {
                return;
            }
            GlobalCommandRunner.screenDelete(activeScreen.screenId, true);
        });
    }

    onRCmd(e: any, mods: KeyModsType) {
        if (this.activeMainView.get() != "session") {
            return;
        }
        let activeScreen = this.getActiveScreen();
        if (activeScreen == null) {
            return;
        }
        if (mods.shift) {
            // restart last line
            GlobalCommandRunner.lineRestart("E", true);
        } else {
            // restart selected line
            let selectedLine = activeScreen.selectedLine.get();
            if (selectedLine == null || selectedLine == 0) {
                return;
            }
            GlobalCommandRunner.lineRestart(String(selectedLine), true);
        }
    }

    clearModals(): boolean {
        let didSomething = false;
        mobx.action(() => {
            if (this.screenSettingsModal.get()) {
                this.screenSettingsModal.set(null);
                didSomething = true;
            }
            if (this.sessionSettingsModal.get()) {
                this.sessionSettingsModal.set(null);
                didSomething = true;
            }
            if (this.screenSettingsModal.get()) {
                this.screenSettingsModal.set(null);
                didSomething = true;
            }
            if (this.clientSettingsModal.get()) {
                this.clientSettingsModal.set(false);
                didSomething = true;
            }
            if (this.lineSettingsModal.get()) {
                this.lineSettingsModal.set(null);
                didSomething = true;
            }
        })();
        return didSomething;
    }

    restartWaveSrv(): void {
        getApi().restartWaveSrv();
    }

    getLocalRemote(): RemoteType {
        for (const remote of this.remotes) {
            if (remote.local) {
                return remote;
            }
        }
        return null;
    }

    getCurRemoteInstance(): RemoteInstanceType {
        let screen = this.getActiveScreen();
        if (screen == null) {
            return null;
        }
        return screen.getCurRemoteInstance();
    }

    onWaveSrvStatusChange(status: boolean): void {
        mobx.action(() => {
            this.waveSrvRunning.set(status);
        })();
    }

    getLastLogs(numbOfLines: number, cb: (logs: any) => void): void {
        getApi().getLastLogs(numbOfLines, cb);
    }

    getContentHeight(context: RendererContext): number {
        let key = context.screenId + "/" + context.lineId;
        return this.termUsedRowsCache[key];
    }

    setContentHeight(context: RendererContext, height: number): void {
        let key = context.screenId + "/" + context.lineId;
        this.termUsedRowsCache[key] = height;
        GlobalCommandRunner.setTermUsedRows(context, height);
    }

    contextScreen(e: any, screenId: string) {
        getApi().contextScreen({ screenId: screenId }, { x: e.x, y: e.y });
    }

    contextEditMenu(e: any, opts: ContextMenuOpts) {
        getApi().contextEditMenu({ x: e.x, y: e.y }, opts);
    }

    getUIContext(): UIContextType {
        let rtn: UIContextType = {
            sessionid: null,
            screenid: null,
            remote: null,
            winsize: null,
            linenum: null,
            build: appconst.VERSION + " " + appconst.BUILD,
        };
        let session = this.getActiveSession();
        if (session != null) {
            rtn.sessionid = session.sessionId;
            let screen = session.getActiveScreen();
            if (screen != null) {
                rtn.screenid = screen.screenId;
                rtn.remote = screen.curRemote.get();
                rtn.winsize = { rows: screen.lastRows, cols: screen.lastCols };
                rtn.linenum = screen.selectedLine.get();
            }
        }
        return rtn;
    }

    onTCmd(e: any, mods: KeyModsType) {
        GlobalCommandRunner.createNewScreen();
    }

    onICmd(e: any, mods: KeyModsType) {
        this.inputModel.giveFocus();
    }

    onLCmd(e: any, mods: KeyModsType) {
        let screen = this.getActiveScreen();
        if (screen != null) {
            GlobalCommandRunner.screenSetFocus("cmd");
        }
    }

    onHCmd(e: any, mods: KeyModsType) {
        this.historyViewModel.reSearch();
    }

    onPCmd(e: any, mods: KeyModsType) {
        this.modalsModel.pushModal(appconst.TAB_SWITCHER);
    }

    getFocusedLine(): LineFocusType {
        if (this.inputModel.hasFocus()) {
            return { cmdInputFocus: true };
        }
        let lineElem: any = document.activeElement.closest(".line[data-lineid]");
        if (lineElem == null) {
            return { cmdInputFocus: false };
        }
        let lineNum = parseInt(lineElem.dataset.linenum);
        return {
            cmdInputFocus: false,
            lineid: lineElem.dataset.lineid,
            linenum: isNaN(lineNum) ? null : lineNum,
            screenid: lineElem.dataset.screenid,
        };
    }

    cmdStatusUpdate(screenId: string, lineId: string, origStatus: string, newStatus: string) {
        let wasRunning = cmdStatusIsRunning(origStatus);
        let isRunning = cmdStatusIsRunning(newStatus);
        if (wasRunning && !isRunning) {
            let ptr = this.getActiveLine(screenId, lineId);
            if (ptr != null) {
                let screen = ptr.screen;
                let renderer = screen.getRenderer(lineId);
                if (renderer != null) {
                    renderer.setIsDone();
                }
                let term = screen.getTermWrap(lineId);
                if (term != null) {
                    term.cmdDone();
                }
            }
        }
    }

    onMenuItemAbout(): void {
        mobx.action(() => {
            this.modalsModel.pushModal(appconst.ABOUT);
        })();
    }

    onMetaPageUp(): void {
        GlobalCommandRunner.screenSelectLine("-1");
    }

    onMetaPageDown(): void {
        GlobalCommandRunner.screenSelectLine("+1");
    }

    onMetaArrowUp(): void {
        GlobalCommandRunner.screenSelectLine("-1");
    }

    onMetaArrowDown(): void {
        GlobalCommandRunner.screenSelectLine("+1");
    }

    onBracketCmd(e: any, arg: { relative: number }, mods: KeyModsType) {
        if (arg.relative == 1) {
            GlobalCommandRunner.switchScreen("+");
        } else if (arg.relative == -1) {
            GlobalCommandRunner.switchScreen("-");
        }
    }

    onDigitCmd(e: any, arg: { digit: number }, mods: KeyModsType) {
        if (mods.meta && mods.ctrl) {
            GlobalCommandRunner.switchSession(String(arg.digit));
            return;
        }
        GlobalCommandRunner.switchScreen(String(arg.digit));
    }

    isConnected(): boolean {
        return this.ws.open.get();
    }

    runUpdate(genUpdate: UpdateMessage, interactive: boolean) {
        mobx.action(() => {
            let oldContext = this.getUIContext();
            try {
                this.runUpdate_internal(genUpdate, oldContext, interactive);
            } catch (e) {
                console.log("error running update", e, genUpdate);
                throw e;
            }
            let newContext = this.getUIContext();
            if (oldContext.sessionid != newContext.sessionid || oldContext.screenid != newContext.screenid) {
                this.inputModel.resetInput();
                if ("cmdline" in genUpdate) {
                    // TODO a bit of a hack since this update gets applied in runUpdate_internal.
                    //   we then undo that update with the resetInput, and then redo it with the line below
                    //   not sure how else to handle this for now though
                    this.inputModel.updateCmdLine(genUpdate.cmdline);
                }
            } else if (remotePtrToString(oldContext.remote) != remotePtrToString(newContext.remote)) {
                this.inputModel.resetHistory();
            }
        })();
    }

    runUpdate_internal(genUpdate: UpdateMessage, uiContext: UIContextType, interactive: boolean) {
        if ("ptydata64" in genUpdate) {
            let ptyMsg: PtyDataUpdateType = genUpdate;
            if (isBlank(ptyMsg.remoteid)) {
                // regular update
                this.updatePtyData(ptyMsg);
            } else {
                // remote update
                let ptyData = base64ToArray(ptyMsg.ptydata64);
                this.remotesModel.receiveData(ptyMsg.remoteid, ptyMsg.ptypos, ptyData);
            }
            return;
        }
        let update: ModelUpdateType = genUpdate;
        if ("screens" in update) {
            if (update.connect) {
                this.screenMap.clear();
            }
            let mods = genMergeDataMap(
                this.screenMap,
                update.screens,
                (s: Screen) => s.screenId,
                (sdata: ScreenDataType) => sdata.screenid,
                (sdata: ScreenDataType) => new Screen(sdata, this)
            );
            for (const screenId of mods.removed) {
                this.removeScreenLinesByScreenId(screenId);
            }
        }
        if ("sessions" in update || "activesessionid" in update) {
            if (update.connect) {
                this.sessionList.clear();
            }
            let [oldActiveSessionId, oldActiveScreenId] = this.getActiveIds();
            genMergeData(
                this.sessionList,
                update.sessions,
                (s: Session) => s.sessionId,
                (sdata: SessionDataType) => sdata.sessionid,
                (sdata: SessionDataType) => new Session(sdata, this),
                (s: Session) => s.sessionIdx.get()
            );
            if ("activesessionid" in update) {
                let newSessionId = update.activesessionid;
                if (this.activeSessionId.get() != newSessionId) {
                    this.activeSessionId.set(newSessionId);
                }
            }
            let [newActiveSessionId, newActiveScreenId] = this.getActiveIds();
            if (oldActiveSessionId != newActiveSessionId || oldActiveScreenId != newActiveScreenId) {
                this.activeMainView.set("session");
                this.deactivateScreenLines();
                this.ws.watchScreen(newActiveSessionId, newActiveScreenId);
            }
        }
        if ("line" in update) {
            this.addLineCmd(update.line, update.cmd, interactive);
        } else if ("cmd" in update) {
            this.updateCmd(update.cmd);
        }
        if ("lines" in update) {
            for (const line of update.lines) {
                this.addLineCmd(line, null, interactive);
            }
        }
        if ("screenlines" in update) {
            this.updateScreenLines(update.screenlines, false);
        }
        if ("remotes" in update) {
            if (update.connect) {
                this.remotes.clear();
            }
            this.updateRemotes(update.remotes);
            // This code's purpose is to show view remote connection modal when a new connection is added
            if (update.remotes?.length && this.remotesModel.recentConnAddedState.get()) {
                this.remotesModel.openReadModal(update.remotes[0].remoteid);
            }
        }
        if ("mainview" in update) {
            if (update.mainview == "plugins") {
                this.pluginsModel.showPluginsView();
            } else if (update.mainview == "bookmarks") {
                this.bookmarksModel.showBookmarksView(update.bookmarks, update.selectedbookmark);
            } else if (update.mainview == "session") {
                this.activeMainView.set("session");
            } else if (update.mainview == "history") {
                this.historyViewModel.showHistoryView(update.historyviewdata);
            } else {
                console.log("invalid mainview in update:", update.mainview);
            }
        } else if ("bookmarks" in update) {
            this.bookmarksModel.mergeBookmarks(update.bookmarks);
        }
        if ("clientdata" in update) {
            this.clientData.set(update.clientdata);
        }
        if (interactive && "info" in update) {
            let info: InfoType = update.info;
            this.inputModel.flashInfoMsg(info, info.timeoutms);
        }
        if (interactive && "remoteview" in update) {
            let rview: RemoteViewType = update.remoteview;
            if (rview.remoteedit != null) {
                this.remotesModel.openEditModal({ ...rview.remoteedit });
            }
        }
        if (interactive && "alertmessage" in update) {
            let alertMessage: AlertMessageType = update.alertmessage;
            this.showAlert(alertMessage);
        }
        if ("cmdline" in update) {
            this.inputModel.updateCmdLine(update.cmdline);
        }
        if (interactive && "history" in update) {
            if (uiContext.sessionid == update.history.sessionid && uiContext.screenid == update.history.screenid) {
                this.inputModel.setHistoryInfo(update.history);
            }
        }
        if ("connect" in update) {
            this.sessionListLoaded.set(true);
            this.remotesLoaded.set(true);
        }
        if ("openaicmdinfochat" in update) {
            this.inputModel.setOpenAICmdInfoChat(update.openaicmdinfochat);
        }
        if ("screenstatusindicators" in update) {
            for (const indicator of update.screenstatusindicators) {
                this.getScreenById_single(indicator.screenid)?.setStatusIndicator(indicator.status);
            }
        }
        if ("screennumrunningcommands" in update) {
            for (const snc of update.screennumrunningcommands) {
                this.getScreenById_single(snc.screenid)?.setNumRunningCmds(snc.num);
            }
        }
    }

    updateRemotes(remotes: RemoteType[]): void {
        genMergeSimpleData(this.remotes, remotes, (r) => r.remoteid, null);
    }

    getActiveSession(): Session {
        return this.getSessionById(this.activeSessionId.get());
    }

    getSessionNames(): Record<string, string> {
        let rtn: Record<string, string> = {};
        for (const session of this.sessionList) {
            rtn[session.sessionId] = session.name.get();
        }
        return rtn;
    }

    getScreenNames(): Record<string, string> {
        let rtn: Record<string, string> = {};
        for (let screen of this.screenMap.values()) {
            rtn[screen.screenId] = screen.name.get();
        }
        return rtn;
    }

    getSessionById(sessionId: string): Session {
        if (sessionId == null) {
            return null;
        }
        for (const session of this.sessionList) {
            if (session.sessionId == sessionId) {
                return session;
            }
        }
        return null;
    }

    deactivateScreenLines() {
        mobx.action(() => {
            this.screenLines.clear();
        })();
    }

    getScreenLinesById(screenId: string): ScreenLines {
        return this.screenLines.get(screenId);
    }

    updateScreenLines(slines: ScreenLinesType, load: boolean) {
        mobx.action(() => {
            let existingWin = this.screenLines.get(slines.screenid);
            if (existingWin == null) {
                if (!load) {
                    console.log("cannot update screen-lines that does not exist", slines.screenid);
                    return;
                }
                let newWindow = new ScreenLines(slines.screenid);
                this.screenLines.set(slines.screenid, newWindow);
                newWindow.updateData(slines, load);
            } else {
                existingWin.updateData(slines, load);
                existingWin.loaded.set(true);
            }
        })();
    }

    removeScreenLinesByScreenId(screenId: string) {
        mobx.action(() => {
            this.screenLines.delete(screenId);
        })();
    }

    getScreenById(sessionId: string, screenId: string): Screen {
        return this.screenMap.get(screenId);
    }

    getScreenById_single(screenId: string): Screen {
        return this.screenMap.get(screenId);
    }

    getSessionScreens(sessionId: string): Screen[] {
        let rtn: Screen[] = [];
        for (let screen of this.screenMap.values()) {
            if (screen.sessionId == sessionId) {
                rtn.push(screen);
            }
        }
        return rtn;
    }

    getScreenLinesForActiveScreen(): ScreenLines {
        let screen = this.getActiveScreen();
        if (screen == null) {
            return null;
        }
        return this.screenLines.get(screen.screenId);
    }

    getActiveScreen(): Screen {
        let session = this.getActiveSession();
        if (session == null) {
            return null;
        }
        return session.getActiveScreen();
    }

    handleCmdRestart(cmd: CmdDataType) {
        if (cmd == null || !cmd.restarted) {
            return;
        }
        let screen = this.screenMap.get(cmd.screenid);
        if (screen == null) {
            return;
        }
        let termWrap = screen.getTermWrap(cmd.lineid);
        if (termWrap == null) {
            return;
        }
        termWrap.reload(0);
    }

    addLineCmd(line: LineType, cmd: CmdDataType, interactive: boolean) {
        let slines = this.getScreenLinesById(line.screenid);
        if (slines == null) {
            return;
        }
        slines.addLineCmd(line, cmd, interactive);
        this.handleCmdRestart(cmd);
    }

    updateCmd(cmd: CmdDataType) {
        let slines = this.screenLines.get(cmd.screenid);
        if (slines != null) {
            slines.updateCmd(cmd);
        }
        this.handleCmdRestart(cmd);
    }

    isInfoUpdate(update: UpdateMessage): boolean {
        if (update == null || "ptydata64" in update) {
            return false;
        }
        return update.info != null || update.history != null;
    }

    getClientDataLoop(loopNum: number): void {
        this.getClientData();
        let clientStop = this.getHasClientStop();
        if (this.clientData.get() != null && !clientStop) {
            return;
        }
        let timeoutMs = 1000;
        if (!clientStop && loopNum > 5) {
            timeoutMs = 3000;
        }
        if (!clientStop && loopNum > 10) {
            timeoutMs = 10000;
        }
        if (!clientStop && loopNum > 15) {
            timeoutMs = 30000;
        }
        setTimeout(() => this.getClientDataLoop(loopNum + 1), timeoutMs);
    }

    getClientData(): void {
        let url = new URL(this.getBaseHostPort() + "/api/get-client-data");
        let fetchHeaders = this.getFetchHeaders();
        fetch(url, { method: "post", body: null, headers: fetchHeaders })
            .then((resp) => handleJsonFetchResponse(url, resp))
            .then((data) => {
                mobx.action(() => {
                    let clientData: ClientDataType = data.data;
                    this.clientData.set(clientData);
                })();
            })
            .catch((err) => {
                this.errorHandler("calling get-client-data", err, true);
            });
    }

    submitCommandPacket(cmdPk: FeCmdPacketType, interactive: boolean): Promise<CommandRtnType> {
        if (this.debugCmds > 0) {
            console.log("[cmd]", cmdPacketString(cmdPk));
            if (this.debugCmds > 1) {
                console.trace();
            }
        }
        // adding cmdStr for debugging only (easily filter run-command calls in the network tab of debugger)
        let cmdStr = cmdPk.metacmd + (cmdPk.metasubcmd ? ":" + cmdPk.metasubcmd : "");
        let url = new URL(this.getBaseHostPort() + "/api/run-command?cmd=" + cmdStr);
        let fetchHeaders = this.getFetchHeaders();
        let prtn = fetch(url, {
            method: "post",
            body: JSON.stringify(cmdPk),
            headers: fetchHeaders,
        })
            .then((resp) => handleJsonFetchResponse(url, resp))
            .then((data) => {
                mobx.action(() => {
                    let update = data.data;
                    if (update != null) {
                        this.runUpdate(update, interactive);
                    }
                    if (interactive && !this.isInfoUpdate(update)) {
                        this.inputModel.clearInfoMsg(true);
                    }
                })();
                return { success: true };
            })
            .catch((err) => {
                this.errorHandler("calling run-command", err, interactive);
                let errMessage = "error running command";
                if (err != null && !isBlank(err.message)) {
                    errMessage = err.message;
                }
                return { success: false, error: errMessage };
            });
        return prtn;
    }

    submitCommand(
        metaCmd: string,
        metaSubCmd: string,
        args: string[],
        kwargs: Record<string, string>,
        interactive: boolean
    ): Promise<CommandRtnType> {
        let pk: FeCmdPacketType = {
            type: "fecmd",
            metacmd: metaCmd,
            metasubcmd: metaSubCmd,
            args: args,
            kwargs: { ...kwargs },
            uicontext: this.getUIContext(),
            interactive: interactive,
        };
        /** 
        console.log(
            "CMD",
            pk.metacmd + (pk.metasubcmd != null ? ":" + pk.metasubcmd : ""),
            pk.args,
            pk.kwargs,
            pk.interactive
        );
		 */
        return this.submitCommandPacket(pk, interactive);
    }

    submitChatInfoCommand(chatMsg: string, curLineStr: string, clear: boolean): Promise<CommandRtnType> {
        let commandStr = "/chat " + chatMsg;
        let interactive = false;
        let pk: FeCmdPacketType = {
            type: "fecmd",
            metacmd: "eval",
            args: [commandStr],
            kwargs: {},
            uicontext: this.getUIContext(),
            interactive: interactive,
            rawstr: chatMsg,
        };
        pk.kwargs["nohist"] = "1";
        if (clear) {
            pk.kwargs["cmdinfoclear"] = "1";
        } else {
            pk.kwargs["cmdinfo"] = "1";
        }
        pk.kwargs["curline"] = curLineStr;
        return this.submitCommandPacket(pk, interactive);
    }

    submitRawCommand(cmdStr: string, addToHistory: boolean, interactive: boolean): Promise<CommandRtnType> {
        let pk: FeCmdPacketType = {
            type: "fecmd",
            metacmd: "eval",
            args: [cmdStr],
            kwargs: null,
            uicontext: this.getUIContext(),
            interactive: interactive,
            rawstr: cmdStr,
        };
        if (!addToHistory && pk.kwargs) {
            pk.kwargs["nohist"] = "1";
        }
        return this.submitCommandPacket(pk, interactive);
    }

    // returns [sessionId, screenId]
    getActiveIds(): [string, string] {
        let activeSession = this.getActiveSession();
        let activeScreen = this.getActiveScreen();
        return [activeSession?.sessionId, activeScreen?.screenId];
    }

    _loadScreenLinesAsync(newWin: ScreenLines) {
        this.screenLines.set(newWin.screenId, newWin);
        let usp = new URLSearchParams({ screenid: newWin.screenId });
        let url = new URL(this.getBaseHostPort() + "/api/get-screen-lines?" + usp.toString());
        let fetchHeaders = this.getFetchHeaders();
        fetch(url, { headers: fetchHeaders })
            .then((resp) => handleJsonFetchResponse(url, resp))
            .then((data) => {
                if (data.data == null) {
                    console.log("null screen-lines returned from get-screen-lines");
                    return;
                }
                let slines: ScreenLinesType = data.data;
                this.updateScreenLines(slines, true);
            })
            .catch((err) => {
                this.errorHandler(sprintf("getting screen-lines=%s", newWin.screenId), err, false);
            });
    }

    loadScreenLines(screenId: string): ScreenLines {
        let newWin = new ScreenLines(screenId);
        setTimeout(() => this._loadScreenLinesAsync(newWin), 0);
        return newWin;
    }

    getRemote(remoteId: string): RemoteType {
        if (remoteId == null) {
            return null;
        }
        return this.remotes.find((remote) => remote.remoteid === remoteId);
    }

    getRemoteNames(): Record<string, string> {
        let rtn: Record<string, string> = {};
        for (const remote of this.remotes) {
            if (!isBlank(remote.remotealias)) {
                rtn[remote.remoteid] = remote.remotealias;
            } else {
                rtn[remote.remoteid] = remote.remotecanonicalname;
            }
        }
        return rtn;
    }

    getRemoteByName(name: string): RemoteType {
        for (const remote of this.remotes) {
            if (remote.remotecanonicalname == name || remote.remotealias == name) {
                return remote;
            }
        }
        return null;
    }

    getCmd(line: LineType): Cmd {
        return this.getCmdByScreenLine(line.screenid, line.lineid);
    }

    getCmdByScreenLine(screenId: string, lineId: string): Cmd {
        let slines = this.getScreenLinesById(screenId);
        if (slines == null) {
            return null;
        }
        return slines.getCmd(lineId);
    }

    getActiveLine(screenId: string, lineid: string): SWLinePtr {
        let slines = this.screenLines.get(screenId);
        if (slines == null) {
            return null;
        }
        if (!slines.loaded.get()) {
            return null;
        }
        let cmd = slines.getCmd(lineid);
        if (cmd == null) {
            return null;
        }
        let line: LineType = null;
        for (const element of slines.lines) {
            if (element.lineid == lineid) {
                line = element;
                break;
            }
        }
        if (line == null) {
            return null;
        }
        let screen = this.getScreenById_single(slines.screenId);
        return { line: line, slines: slines, screen: screen };
    }

    updatePtyData(ptyMsg: PtyDataUpdateType): void {
        let linePtr = this.getActiveLine(ptyMsg.screenid, ptyMsg.lineid);
        if (linePtr != null) {
            linePtr.screen.updatePtyData(ptyMsg);
        }
    }

    errorHandler(str: string, err: any, interactive: boolean) {
        console.log("[error]", str, err);
        if (interactive) {
            let errMsg = "error running command";
            if (err?.message) {
                errMsg = err.message;
            }
            this.inputModel.flashInfoMsg({ infoerror: errMsg }, null);
        }
    }

    sendInputPacket(inputPacket: any) {
        this.ws.pushMessage(inputPacket);
    }

    sendCmdInputText(screenId: string, sp: StrWithPos) {
        let pk: CmdInputTextPacketType = {
            type: "cmdinputtext",
            seqnum: this.getNextPacketSeqNum(),
            screenid: screenId,
            text: sp,
        };
        this.ws.pushMessage(pk);
    }

    resolveUserIdToName(userid: string): string {
        return "@[unknown]";
    }

    resolveRemoteIdToRef(remoteId: string) {
        let remote = this.getRemote(remoteId);
        if (remote == null) {
            return "[unknown]";
        }
        if (!isBlank(remote.remotealias)) {
            return remote.remotealias;
        }
        return remote.remotecanonicalname;
    }

    resolveRemoteIdToFullRef(remoteId: string) {
        let remote = this.getRemote(remoteId);
        if (remote == null) {
            return "[unknown]";
        }
        if (!isBlank(remote.remotealias)) {
            return remote.remotealias + " (" + remote.remotecanonicalname + ")";
        }
        return remote.remotecanonicalname;
    }

    readRemoteFile(screenId: string, lineId: string, path: string): Promise<ExtFile> {
        let urlParams = {
            screenid: screenId,
            lineid: lineId,
            path: path,
        };
        let usp = new URLSearchParams(urlParams);
        let url = new URL(this.getBaseHostPort() + "/api/read-file?" + usp.toString());
        let fetchHeaders = this.getFetchHeaders();
        let fileInfo: FileInfoType = null;
        let badResponseStr: string = null;
        let prtn = fetch(url, { method: "get", headers: fetchHeaders })
            .then((resp) => {
                if (!resp.ok) {
                    badResponseStr = sprintf(
                        "Bad fetch response for /api/read-file: %d %s",
                        resp.status,
                        resp.statusText
                    );
                    return resp.text() as any;
                }
                fileInfo = JSON.parse(base64ToString(resp.headers.get("X-FileInfo")));
                return resp.blob();
            })
            .then((blobOrText: any) => {
                if (blobOrText instanceof Blob) {
                    let blob: Blob = blobOrText;
                    let file = new File([blob], fileInfo.name, { type: blob.type, lastModified: fileInfo.modts });
                    let isWriteable = (fileInfo.perm & 0o222) > 0; // checks for unix permission "w" bits
                    (file as any).readOnly = !isWriteable;
                    (file as any).notFound = !!fileInfo.notfound;
                    return file as ExtFile;
                } else {
                    let textError: string = blobOrText;
                    if (textError == null || textError.length == 0) {
                        throw new Error(badResponseStr);
                    }
                    throw new Error(textError);
                }
            });
        return prtn;
    }

    writeRemoteFile(
        screenId: string,
        lineId: string,
        path: string,
        data: Uint8Array,
        opts?: { useTemp?: boolean }
    ): Promise<void> {
        opts = opts || {};
        let params = {
            screenid: screenId,
            lineid: lineId,
            path: path,
            usetemp: !!opts.useTemp,
        };
        let formData = new FormData();
        formData.append("params", JSON.stringify(params));
        let blob = new Blob([data], { type: "application/octet-stream" });
        formData.append("data", blob);
        let url = new URL(this.getBaseHostPort() + "/api/write-file");
        let fetchHeaders = this.getFetchHeaders();
        let prtn = fetch(url, { method: "post", headers: fetchHeaders, body: formData });
        return prtn
            .then((resp) => handleJsonFetchResponse(url, resp))
            .then((_) => {
                return;
            });
    }
}

class CommandRunner {
    private constructor() {}

    static getInstance() {
        if (!(window as any).GlobalCommandRunner) {
            (window as any).GlobalCommandRunner = new CommandRunner();
        }
        return (window as any).GlobalCommandRunner;
    }

    loadHistory(show: boolean, htype: string) {
        let kwargs = { nohist: "1" };
        if (!show) {
            kwargs["noshow"] = "1";
        }
        if (htype != null && htype != "screen") {
            kwargs["type"] = htype;
        }
        GlobalModel.submitCommand("history", null, null, kwargs, true);
    }

    resetShellState() {
        GlobalModel.submitCommand("reset", null, null, null, true);
    }

    historyPurgeLines(lines: string[]): Promise<CommandRtnType> {
        let prtn = GlobalModel.submitCommand("history", "purge", lines, { nohist: "1" }, false);
        return prtn;
    }

    switchSession(session: string) {
        mobx.action(() => {
            GlobalModel.activeMainView.set("session");
        })();
        GlobalModel.submitCommand("session", null, [session], { nohist: "1" }, false);
    }

    switchScreen(screen: string, session?: string) {
        mobx.action(() => {
            GlobalModel.activeMainView.set("session");
        })();
        let kwargs = { nohist: "1" };
        if (session != null) {
            kwargs["session"] = session;
        }
        GlobalModel.submitCommand("screen", null, [screen], kwargs, false);
    }

    lineView(sessionId: string, screenId: string, lineNum?: number) {
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen != null && lineNum != null) {
            screen.setAnchorFields(lineNum, 0, "line:view");
        }
        let lineNumStr = lineNum == null || lineNum == 0 ? "E" : String(lineNum);
        GlobalModel.submitCommand("line", "view", [sessionId, screenId, lineNumStr], { nohist: "1" }, false);
    }

    lineArchive(lineArg: string, archive: boolean): Promise<CommandRtnType> {
        let kwargs = { nohist: "1" };
        let archiveStr = archive ? "1" : "0";
        return GlobalModel.submitCommand("line", "archive", [lineArg, archiveStr], kwargs, false);
    }

    lineDelete(lineArg: string, interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("line", "delete", [lineArg], { nohist: "1" }, interactive);
    }

    lineRestart(lineArg: string, interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("line", "restart", [lineArg], { nohist: "1" }, interactive);
    }

    lineSet(lineArg: string, opts: { renderer?: string }): Promise<CommandRtnType> {
        let kwargs = { nohist: "1" };
        if ("renderer" in opts) {
            kwargs["renderer"] = opts.renderer ?? "";
        }
        return GlobalModel.submitCommand("line", "set", [lineArg], kwargs, false);
    }

    createNewSession() {
        GlobalModel.submitCommand("session", "open", null, { nohist: "1" }, false);
    }

    createNewScreen() {
        GlobalModel.submitCommand("screen", "open", null, { nohist: "1" }, false);
    }

    closeScreen(screen: string) {
        GlobalModel.submitCommand("screen", "close", [screen], { nohist: "1" }, false);
    }

    // include is lineIds to include, exclude is lineIds to exclude
    // if include is given then it *only* does those ids.  if exclude is given (or not),
    // it does all running commands in the screen except for excluded.
    resizeScreen(screenId: string, rows: number, cols: number, opts?: { include?: string[]; exclude?: string[] }) {
        let kwargs: Record<string, string> = {
            nohist: "1",
            screen: screenId,
            cols: String(cols),
            rows: String(rows),
        };
        if (opts?.include != null && opts?.include.length > 0) {
            kwargs.include = opts.include.join(",");
        }
        if (opts?.exclude != null && opts?.exclude.length > 0) {
            kwargs.exclude = opts.exclude.join(",");
        }
        GlobalModel.submitCommand("screen", "resize", null, kwargs, false);
    }

    screenArchive(screenId: string, shouldArchive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand(
            "screen",
            "archive",
            [screenId, shouldArchive ? "1" : "0"],
            { nohist: "1" },
            false
        );
    }

    screenDelete(screenId: string, interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("screen", "delete", [screenId], { nohist: "1" }, interactive);
    }

    screenWebShare(screenId: string, shouldShare: boolean): Promise<CommandRtnType> {
        let kwargs: Record<string, string> = { nohist: "1" };
        kwargs["screen"] = screenId;
        return GlobalModel.submitCommand("screen", "webshare", [shouldShare ? "1" : "0"], kwargs, false);
    }

    showRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "show", null, { nohist: "1", remote: remoteid }, true);
    }

    showAllRemotes() {
        GlobalModel.submitCommand("remote", "showall", null, { nohist: "1" }, true);
    }

    connectRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "connect", null, { nohist: "1", remote: remoteid }, true);
    }

    disconnectRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "disconnect", null, { nohist: "1", remote: remoteid }, true);
    }

    installRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "install", null, { nohist: "1", remote: remoteid }, true);
    }

    installCancelRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "installcancel", null, { nohist: "1", remote: remoteid }, true);
    }

    createRemote(cname: string, kwargsArg: Record<string, string>, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = Object.assign({}, kwargsArg);
        kwargs["nohist"] = "1";
        return GlobalModel.submitCommand("remote", "new", [cname], kwargs, interactive);
    }

    openCreateRemote(): void {
        GlobalModel.submitCommand("remote", "new", null, { nohist: "1", visual: "1" }, true);
    }

    screenSetRemote(remoteArg: string, nohist: boolean, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = {};
        if (nohist) {
            kwargs["nohist"] = "1";
        }
        return GlobalModel.submitCommand("connect", null, [remoteArg], kwargs, interactive);
    }

    editRemote(remoteid: string, kwargsArg: Record<string, string>): void {
        let kwargs = Object.assign({}, kwargsArg);
        kwargs["nohist"] = "1";
        kwargs["remote"] = remoteid;
        GlobalModel.submitCommand("remote", "set", null, kwargs, true);
    }

    openEditRemote(remoteid: string): void {
        GlobalModel.submitCommand("remote", "set", null, { remote: remoteid, nohist: "1", visual: "1" }, true);
    }

    archiveRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "archive", null, { remote: remoteid, nohist: "1" }, true);
    }

    importSshConfig() {
        GlobalModel.submitCommand("remote", "parse", null, { nohist: "1", visual: "1" }, true);
    }

    screenSelectLine(lineArg: string, focusVal?: string) {
        let kwargs: Record<string, string> = {
            nohist: "1",
            line: lineArg,
        };
        if (focusVal != null) {
            kwargs["focus"] = focusVal;
        }
        GlobalModel.submitCommand("screen", "set", null, kwargs, false);
    }

    screenReorder(screenId: string, index: string) {
        let kwargs: Record<string, string> = {
            nohist: "1",
            screenId: screenId,
            index: index,
        };
        GlobalModel.submitCommand("screen", "reorder", null, kwargs, false);
    }

    setTermUsedRows(termContext: RendererContext, height: number) {
        let kwargs: Record<string, string> = {};
        kwargs["screen"] = termContext.screenId;
        kwargs["hohist"] = "1";
        let posargs = [String(termContext.lineNum), String(height)];
        GlobalModel.submitCommand("line", "setheight", posargs, kwargs, false);
    }

    screenSetAnchor(sessionId: string, screenId: string, anchorVal: string): void {
        let kwargs = {
            nohist: "1",
            anchor: anchorVal,
            session: sessionId,
            screen: screenId,
        };
        GlobalModel.submitCommand("screen", "set", null, kwargs, false);
    }

    screenSetFocus(focusVal: string): void {
        GlobalModel.submitCommand("screen", "set", null, { focus: focusVal, nohist: "1" }, false);
    }

    screenSetSettings(
        screenId: string,
        settings: { tabcolor?: string; tabicon?: string; name?: string; sharename?: string },
        interactive: boolean
    ): Promise<CommandRtnType> {
        let kwargs: { [key: string]: any } = Object.assign({}, settings);
        kwargs["nohist"] = "1";
        kwargs["screen"] = screenId;
        return GlobalModel.submitCommand("screen", "set", null, kwargs, interactive);
    }

    sessionArchive(sessionId: string, shouldArchive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand(
            "session",
            "archive",
            [sessionId, shouldArchive ? "1" : "0"],
            { nohist: "1" },
            false
        );
    }

    sessionDelete(sessionId: string): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("session", "delete", [sessionId], { nohist: "1" }, false);
    }

    sessionSetSettings(sessionId: string, settings: { name?: string }, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = Object.assign({}, settings);
        kwargs["nohist"] = "1";
        kwargs["session"] = sessionId;
        return GlobalModel.submitCommand("session", "set", null, kwargs, interactive);
    }

    lineStar(lineId: string, starVal: number) {
        GlobalModel.submitCommand("line", "star", [lineId, String(starVal)], { nohist: "1" }, true);
    }

    lineBookmark(lineId: string) {
        GlobalModel.submitCommand("line", "bookmark", [lineId], { nohist: "1" }, true);
    }

    linePin(lineId: string, val: boolean) {
        GlobalModel.submitCommand("line", "pin", [lineId, val ? "1" : "0"], { nohist: "1" }, true);
    }

    bookmarksView() {
        GlobalModel.submitCommand("bookmarks", "show", null, { nohist: "1" }, true);
    }

    connectionsView() {
        GlobalModel.connectionViewModel.showConnectionsView();
    }

    clientSettingsView() {
        GlobalModel.clientSettingsViewModel.showClientSettingsView();
    }

    historyView(params: HistorySearchParams) {
        let kwargs = { nohist: "1" };
        kwargs["offset"] = String(params.offset);
        kwargs["rawoffset"] = String(params.rawOffset);
        if (params.searchText != null) {
            kwargs["text"] = params.searchText;
        }
        if (params.searchSessionId != null) {
            kwargs["searchsession"] = params.searchSessionId;
        }
        if (params.searchRemoteId != null) {
            kwargs["searchremote"] = params.searchRemoteId;
        }
        if (params.fromTs != null) {
            kwargs["fromts"] = String(params.fromTs);
        }
        if (params.noMeta) {
            kwargs["meta"] = "0";
        }
        if (params.filterCmds) {
            kwargs["filter"] = "1";
        }
        GlobalModel.submitCommand("history", "viewall", null, kwargs, true);
    }

    telemetryOff(interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("telemetry", "off", null, { nohist: "1" }, interactive);
    }

    telemetryOn(interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("telemetry", "on", null, { nohist: "1" }, interactive);
    }

    releaseCheckAutoOff(interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("releasecheck", "autooff", null, { nohist: "1" }, interactive);
    }

    releaseCheckAutoOn(interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("releasecheck", "autoon", null, { nohist: "1" }, interactive);
    }

    setTermFontSize(fsize: number, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = {
            nohist: "1",
            termfontsize: String(fsize),
        };
        return GlobalModel.submitCommand("client", "set", null, kwargs, interactive);
    }

    setClientOpenAISettings(opts: { model?: string; apitoken?: string; maxtokens?: string }): Promise<CommandRtnType> {
        let kwargs = {
            nohist: "1",
        };
        if (opts.model != null) {
            kwargs["openaimodel"] = opts.model;
        }
        if (opts.apitoken != null) {
            kwargs["openaiapitoken"] = opts.apitoken;
        }
        if (opts.maxtokens != null) {
            kwargs["openaimaxtokens"] = opts.maxtokens;
        }
        return GlobalModel.submitCommand("client", "set", null, kwargs, false);
    }

    clientAcceptTos(): void {
        GlobalModel.submitCommand("client", "accepttos", null, { nohist: "1" }, true);
    }

    clientSetConfirmFlag(flag: string, value: boolean): Promise<CommandRtnType> {
        let kwargs = { nohist: "1" };
        let valueStr = value ? "1" : "0";
        return GlobalModel.submitCommand("client", "setconfirmflag", [flag, valueStr], kwargs, false);
    }

    clientSetSidebar(width: number, collapsed: boolean): Promise<CommandRtnType> {
        let kwargs = { nohist: "1", width: `${width}`, collapsed: collapsed ? "1" : "0" };
        return GlobalModel.submitCommand("client", "setsidebar", null, kwargs, false);
    }

    editBookmark(bookmarkId: string, desc: string, cmdstr: string) {
        let kwargs = {
            nohist: "1",
            desc: desc,
            cmdstr: cmdstr,
        };
        GlobalModel.submitCommand("bookmark", "set", [bookmarkId], kwargs, true);
    }

    deleteBookmark(bookmarkId: string): void {
        GlobalModel.submitCommand("bookmark", "delete", [bookmarkId], { nohist: "1" }, true);
    }

    openSharedSession(): void {
        GlobalModel.submitCommand("session", "openshared", null, { nohist: "1" }, true);
    }

    setLineState(
        screenId: string,
        lineId: string,
        state: LineStateType,
        interactive: boolean
    ): Promise<CommandRtnType> {
        let stateStr = JSON.stringify(state);
        return GlobalModel.submitCommand(
            "line",
            "set",
            [lineId],
            { screen: screenId, nohist: "1", state: stateStr },
            interactive
        );
    }

    screenSidebarAddLine(lineId: string) {
        GlobalModel.submitCommand("sidebar", "add", null, { nohist: "1", line: lineId }, false);
    }

    screenSidebarRemove() {
        GlobalModel.submitCommand("sidebar", "remove", null, { nohist: "1" }, false);
    }

    screenSidebarClose(): void {
        GlobalModel.submitCommand("sidebar", "close", null, { nohist: "1" }, false);
    }

    screenSidebarOpen(width?: string): void {
        let kwargs: Record<string, string> = { nohist: "1" };
        if (width != null) {
            kwargs.width = width;
        }
        GlobalModel.submitCommand("sidebar", "open", null, kwargs, false);
    }
}

const GlobalModel = Model.getInstance();
const GlobalCommandRunner = CommandRunner.getInstance();
export { Model, CommandRunner, GlobalModel, GlobalCommandRunner };
