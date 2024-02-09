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
    OV,
    OArr,
    OMap,
    CV,
} from "../types/types";
import { WSControl } from "./ws";
import { cmdStatusIsRunning } from "../app/line/lineutil";
import * as appconst from "../app/appconst";
import { remotePtrToString, cmdPacketString } from "../util/modelutil";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent, setKeyUtilPlatform } from "../util/keyutil";
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
import { GlobalCommandRunner } from "./global";

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
            const interactive = message?.interactive ?? false;
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
        const isWaveSrvRunning = getApi().getWaveSrvStatus();
        this.waveSrvRunning = mobx.observable.box(isWaveSrvRunning, {
            name: "model-wavesrv-running",
        });
        this.platform = this.getPlatform();
        this.termFontSize = mobx.computed(() => {
            const cdata = this.clientData.get();
            if (cdata?.feopts?.termfontsize == null) {
                return appconst.DefaultTermFontSize;
            }
            const fontSize = Math.ceil(cdata.feopts.termfontsize);
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
        const cdata = this.clientData.get();
        if (cdata == null) {
            return false;
        }
        return !cdata.clientopts?.acceptedtos;
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
        const activeScreen = this.getActiveScreen();
        if (screen == null) {
            return;
        }
        activeScreen.giveFocus();
    }

    getWebSharedScreens(): Screen[] {
        const rtn: Screen[] = [];
        for (const screen of this.screenMap.values()) {
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
        const cdata = this.clientData.get();
        if (cdata.cmdstoretype == "session") {
            return true;
        }
        return false;
    }

    showAlert(alertMessage: AlertMessageType): Promise<boolean> {
        if (alertMessage.confirmflag != null) {
            const cdata = this.clientData.get();
            const noConfirm = cdata.clientopts?.confirmflags?.[alertMessage.confirmflag];
            if (noConfirm) {
                return Promise.resolve(true);
            }
        }
        mobx.action(() => {
            this.alertMessage.set(alertMessage);
            this.modalsModel.pushModal(appconst.ALERT);
        })();
        const prtn = new Promise<boolean>((resolve, reject) => {
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
        const waveEvent = adaptFromReactOrNativeKeyEvent(e);
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
            const inputModel = this.inputModel;
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
            const activeScreen = this.getActiveScreen();
            if (activeScreen != null) {
                const isSidebarOpen = activeScreen.isSidebarOpen();
                if (isSidebarOpen) {
                    GlobalCommandRunner.screenSidebarClose();
                } else {
                    GlobalCommandRunner.screenSidebarOpen();
                }
            }
        }
        if (checkKeyPressed(waveEvent, "Cmd:d")) {
            const ranDelete = this.deleteActiveLine();
            if (ranDelete) {
                e.preventDefault();
            }
        }
    }

    deleteActiveLine(): boolean {
        const activeScreen = this.getActiveScreen();
        if (activeScreen == null || activeScreen.getFocusType() != "cmd") {
            return false;
        }
        const selectedLine = activeScreen.selectedLine.get();
        if (selectedLine == null || selectedLine <= 0) {
            return false;
        }
        const line = activeScreen.getLineByNum(selectedLine);
        if (line == null) {
            return false;
        }
        const cmd = activeScreen.getCmd(line);
        if (cmd != null) {
            if (cmd.isRunning()) {
                const info: InfoType = { infomsg: "Cannot delete a running command" };
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
        const activeScreen = this.getActiveScreen();
        if (activeScreen == null) {
            return;
        }
        const rtnp = this.showAlert({
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
        const activeScreen = this.getActiveScreen();
        if (activeScreen == null) {
            return;
        }
        if (mods.shift) {
            // restart last line
            GlobalCommandRunner.lineRestart("E", true);
        } else {
            // restart selected line
            const selectedLine = activeScreen.selectedLine.get();
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
        const screen = this.getActiveScreen();
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
        const key = context.screenId + "/" + context.lineId;
        return this.termUsedRowsCache[key];
    }

    setContentHeight(context: RendererContext, height: number): void {
        const key = context.screenId + "/" + context.lineId;
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
        const rtn: UIContextType = {
            sessionid: null,
            screenid: null,
            remote: null,
            winsize: null,
            linenum: null,
            build: appconst.VERSION + " " + appconst.BUILD,
        };
        const session = this.getActiveSession();
        if (session != null) {
            rtn.sessionid = session.sessionId;
            const screen = session.getActiveScreen();
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
        const screen = this.getActiveScreen();
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
        const lineElem: any = document.activeElement.closest(".line[data-lineid]");
        if (lineElem == null) {
            return { cmdInputFocus: false };
        }
        const lineNum = parseInt(lineElem.dataset.linenum);
        return {
            cmdInputFocus: false,
            lineid: lineElem.dataset.lineid,
            linenum: isNaN(lineNum) ? null : lineNum,
            screenid: lineElem.dataset.screenid,
        };
    }

    cmdStatusUpdate(screenId: string, lineId: string, origStatus: string, newStatus: string) {
        const wasRunning = cmdStatusIsRunning(origStatus);
        const isRunning = cmdStatusIsRunning(newStatus);
        if (wasRunning && !isRunning) {
            const ptr = this.getActiveLine(screenId, lineId);
            if (ptr != null) {
                const screen = ptr.screen;
                const renderer = screen.getRenderer(lineId);
                if (renderer != null) {
                    renderer.setIsDone();
                }
                const term = screen.getTermWrap(lineId);
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
            const oldContext = this.getUIContext();
            try {
                this.runUpdate_internal(genUpdate, oldContext, interactive);
            } catch (e) {
                console.log("error running update", e, genUpdate);
                throw e;
            }
            const newContext = this.getUIContext();
            if (oldContext.sessionid != newContext.sessionid || oldContext.screenid != newContext.screenid) {
                this.inputModel.resetInput();
                if (!("ptydata64" in genUpdate)) {
                    const reversedGenUpdate = genUpdate.slice().reverse();
                    const lastCmdLine = reversedGenUpdate.find((update) => "cmdline" in update);
                    if (lastCmdLine) {
                        // TODO a bit of a hack since this update gets applied in runUpdate_internal.
                        //   we then undo that update with the resetInput, and then redo it with the line below
                        //   not sure how else to handle this for now though
                        this.inputModel.updateCmdLine(lastCmdLine.cmdline);
                    }
                }
            } else if (remotePtrToString(oldContext.remote) != remotePtrToString(newContext.remote)) {
                this.inputModel.resetHistory();
            }
        })();
    }

    runUpdate_internal(genUpdate: UpdateMessage, uiContext: UIContextType, interactive: boolean) {
        if ("ptydata64" in genUpdate) {
            const ptyMsg: PtyDataUpdateType = genUpdate;
            if (isBlank(ptyMsg.remoteid)) {
                // regular update
                this.updatePtyData(ptyMsg);
            } else {
                // remote update
                const ptyData = base64ToArray(ptyMsg.ptydata64);
                this.remotesModel.receiveData(ptyMsg.remoteid, ptyMsg.ptypos, ptyData);
            }
            return;
        }
        let showedRemotesModal = false;
        genUpdate.forEach((update) => {
            if (update.screen != null) {
                if (update.connect) {
                    this.screenMap.clear();
                }
                const mods = genMergeDataMap(
                    this.screenMap,
                    [update.screen],
                    (s: Screen) => s.screenId,
                    (sdata: ScreenDataType) => sdata.screenid,
                    (sdata: ScreenDataType) => new Screen(sdata, this)
                );
                for (const screenId of mods.removed) {
                    this.removeScreenLinesByScreenId(screenId);
                }
            }
            if (update.session != null || update.activesessionid != null) {
                if (update.connect) {
                    this.sessionList.clear();
                }
                const [oldActiveSessionId, oldActiveScreenId] = this.getActiveIds();
                genMergeData(
                    this.sessionList,
                    [update.session],
                    (s: Session) => s.sessionId,
                    (sdata: SessionDataType) => sdata.sessionid,
                    (sdata: SessionDataType) => new Session(sdata, this),
                    (s: Session) => s.sessionIdx.get()
                );
                if (update.activesessionid != null) {
                    const newSessionId = update.activesessionid;
                    if (this.activeSessionId.get() != newSessionId) {
                        this.activeSessionId.set(newSessionId);
                    }
                }
                const [newActiveSessionId, newActiveScreenId] = this.getActiveIds();
                if (oldActiveSessionId != newActiveSessionId || oldActiveScreenId != newActiveScreenId) {
                    this.activeMainView.set("session");
                    this.deactivateScreenLines();
                    this.ws.watchScreen(newActiveSessionId, newActiveScreenId);
                }
            }
            if (update.line != null) {
                this.addLineCmd(update.line, update.cmd, interactive);
            }
            if (update.cmd != null) {
                this.updateCmd(update.cmd);
            }
            if (update.screenlines != null) {
                this.updateScreenLines(update.screenlines, false);
            }
            if (update.remote != null) {
                console.log("update.remote", update.remote);
                if (update.connect) {
                    this.remotes.clear();
                }
                this.updateRemotes([update.remote]);
                // This code's purpose is to show view remote connection modal when a new connection is added
                if (!showedRemotesModal && this.remotesModel.recentConnAddedState.get()) {
                    console.log("showing remotes modal");
                    showedRemotesModal = true;
                    this.remotesModel.openReadModal(update.remote.remoteid);
                }
            }
            if (update.mainview != null) {
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
            }
            if (update.bookmarks != null) {
                this.bookmarksModel.mergeBookmarks(update.bookmarks);
            }
            if (update.clientdata != null) {
                this.clientData.set(update.clientdata);
            }
            if (interactive) {
                if (update.info != null) {
                    const info: InfoType = update.info;
                    this.inputModel.flashInfoMsg(info, info.timeoutms);
                }
                if (update.remoteview != null) {
                    const rview: RemoteViewType = update.remoteview;
                    if (rview.remoteedit != null) {
                        this.remotesModel.openEditModal({ ...rview.remoteedit });
                    }
                }
                if (update.alertmessage != null) {
                    const alertMessage: AlertMessageType = update.alertmessage;
                    this.showAlert(alertMessage);
                }
                if (update.history != null) {
                    if (
                        uiContext.sessionid == update.history.sessionid &&
                        uiContext.screenid == update.history.screenid
                    ) {
                        this.inputModel.setHistoryInfo(update.history);
                    }
                }
            }

            if (update.cmdline != null) {
                this.inputModel.updateCmdLine(update.cmdline);
            }
            if (update.connect != null) {
                this.sessionListLoaded.set(true);
                this.remotesLoaded.set(true);
            }
            if (update.openaicmdinfochat != null) {
                this.inputModel.setOpenAICmdInfoChat(update.openaicmdinfochat);
            }
            if (update.screenstatusindicator != null) {
                this.getScreenById_single(update.screenstatusindicator.screenid)?.setStatusIndicator(
                    update.screenstatusindicator.status
                );
            }
            if (update.screennumrunningcommand != null) {
                this.getScreenById_single(update.screennumrunningcommand.screenid)?.setNumRunningCmds(
                    update.screennumrunningcommand.num
                );
            }
        });
    }

    updateRemotes(remotes: RemoteType[]): void {
        genMergeSimpleData(this.remotes, remotes, (r) => r.remoteid, null);
    }

    getActiveSession(): Session {
        return this.getSessionById(this.activeSessionId.get());
    }

    getSessionNames(): Record<string, string> {
        const rtn: Record<string, string> = {};
        for (const session of this.sessionList) {
            rtn[session.sessionId] = session.name.get();
        }
        return rtn;
    }

    getScreenNames(): Record<string, string> {
        const rtn: Record<string, string> = {};
        for (const screen of this.screenMap.values()) {
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
            const existingWin = this.screenLines.get(slines.screenid);
            if (existingWin == null) {
                if (!load) {
                    console.log("cannot update screen-lines that does not exist", slines.screenid);
                    return;
                }
                const newWindow = new ScreenLines(slines.screenid);
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
        const rtn: Screen[] = [];
        for (const screen of this.screenMap.values()) {
            if (screen.sessionId == sessionId) {
                rtn.push(screen);
            }
        }
        return rtn;
    }

    getScreenLinesForActiveScreen(): ScreenLines {
        const screen = this.getActiveScreen();
        if (screen == null) {
            return null;
        }
        return this.screenLines.get(screen.screenId);
    }

    getActiveScreen(): Screen {
        const session = this.getActiveSession();
        if (session == null) {
            return null;
        }
        return session.getActiveScreen();
    }

    handleCmdRestart(cmd: CmdDataType) {
        if (cmd == null || !cmd.restarted) {
            return;
        }
        const screen = this.screenMap.get(cmd.screenid);
        if (screen == null) {
            return;
        }
        const termWrap = screen.getTermWrap(cmd.lineid);
        if (termWrap == null) {
            return;
        }
        termWrap.reload(0);
    }

    addLineCmd(line: LineType, cmd: CmdDataType, interactive: boolean) {
        const slines = this.getScreenLinesById(line.screenid);
        if (slines == null) {
            return;
        }
        slines.addLineCmd(line, cmd, interactive);
        this.handleCmdRestart(cmd);
    }

    updateCmd(cmd: CmdDataType) {
        const slines = this.screenLines.get(cmd.screenid);
        if (slines != null) {
            slines.updateCmd(cmd);
        }
        this.handleCmdRestart(cmd);
    }

    isInfoUpdate(update: UpdateMessage): boolean {
        if (update == null || "ptydata64" in update) {
            return false;
        }
        return update.some((u) => u.info != null || u.history != null);
    }

    getClientDataLoop(loopNum: number): void {
        this.getClientData();
        const clientStop = this.getHasClientStop();
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
        const url = new URL(this.getBaseHostPort() + "/api/get-client-data");
        const fetchHeaders = this.getFetchHeaders();
        fetch(url, { method: "post", body: null, headers: fetchHeaders })
            .then((resp) => handleJsonFetchResponse(url, resp))
            .then((data) => {
                mobx.action(() => {
                    const clientData: ClientDataType = data.data;
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
        const cmdStr = cmdPk.metacmd + (cmdPk.metasubcmd ? ":" + cmdPk.metasubcmd : "");
        const url = new URL(this.getBaseHostPort() + "/api/run-command?cmd=" + cmdStr);
        const fetchHeaders = this.getFetchHeaders();
        const prtn = fetch(url, {
            method: "post",
            body: JSON.stringify(cmdPk),
            headers: fetchHeaders,
        })
            .then((resp) => handleJsonFetchResponse(url, resp))
            .then((data) => {
                mobx.action(() => {
                    const update = data.data;
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
        const pk: FeCmdPacketType = {
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
        const commandStr = "/chat " + chatMsg;
        const interactive = false;
        const pk: FeCmdPacketType = {
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
        const pk: FeCmdPacketType = {
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
        const activeSession = this.getActiveSession();
        const activeScreen = this.getActiveScreen();
        return [activeSession?.sessionId, activeScreen?.screenId];
    }

    _loadScreenLinesAsync(newWin: ScreenLines) {
        this.screenLines.set(newWin.screenId, newWin);
        const usp = new URLSearchParams({ screenid: newWin.screenId });
        const url = new URL(this.getBaseHostPort() + "/api/get-screen-lines?" + usp.toString());
        const fetchHeaders = this.getFetchHeaders();
        fetch(url, { headers: fetchHeaders })
            .then((resp) => handleJsonFetchResponse(url, resp))
            .then((data) => {
                if (data.data == null) {
                    console.log("null screen-lines returned from get-screen-lines");
                    return;
                }
                const slines: ScreenLinesType = data.data;
                this.updateScreenLines(slines, true);
            })
            .catch((err) => {
                this.errorHandler(sprintf("getting screen-lines=%s", newWin.screenId), err, false);
            });
    }

    loadScreenLines(screenId: string): ScreenLines {
        const newWin = new ScreenLines(screenId);
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
        const rtn: Record<string, string> = {};
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
        const slines = this.getScreenLinesById(screenId);
        if (slines == null) {
            return null;
        }
        return slines.getCmd(lineId);
    }

    getActiveLine(screenId: string, lineid: string): SWLinePtr {
        const slines = this.screenLines.get(screenId);
        if (slines == null) {
            return null;
        }
        if (!slines.loaded.get()) {
            return null;
        }
        const cmd = slines.getCmd(lineid);
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
        const screen = this.getScreenById_single(slines.screenId);
        return { line: line, slines: slines, screen: screen };
    }

    updatePtyData(ptyMsg: PtyDataUpdateType): void {
        const linePtr = this.getActiveLine(ptyMsg.screenid, ptyMsg.lineid);
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
        const pk: CmdInputTextPacketType = {
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
        const remote = this.getRemote(remoteId);
        if (remote == null) {
            return "[unknown]";
        }
        if (!isBlank(remote.remotealias)) {
            return remote.remotealias;
        }
        return remote.remotecanonicalname;
    }

    resolveRemoteIdToFullRef(remoteId: string) {
        const remote = this.getRemote(remoteId);
        if (remote == null) {
            return "[unknown]";
        }
        if (!isBlank(remote.remotealias)) {
            return remote.remotealias + " (" + remote.remotecanonicalname + ")";
        }
        return remote.remotecanonicalname;
    }

    readRemoteFile(screenId: string, lineId: string, path: string): Promise<ExtFile> {
        const urlParams = {
            screenid: screenId,
            lineid: lineId,
            path: path,
        };
        const usp = new URLSearchParams(urlParams);
        const url = new URL(this.getBaseHostPort() + "/api/read-file?" + usp.toString());
        const fetchHeaders = this.getFetchHeaders();
        let fileInfo: FileInfoType = null;
        let badResponseStr: string = null;
        const prtn = fetch(url, { method: "get", headers: fetchHeaders })
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
                    const blob: Blob = blobOrText;
                    const file = new File([blob], fileInfo.name, { type: blob.type, lastModified: fileInfo.modts });
                    const isWriteable = (fileInfo.perm & 0o222) > 0; // checks for unix permission "w" bits
                    (file as any).readOnly = !isWriteable;
                    (file as any).notFound = !!fileInfo.notfound;
                    return file as ExtFile;
                } else {
                    const textError: string = blobOrText;
                    if (textError == null || textError.length == 0) {
                        throw new Error(badResponseStr);
                    }
                    throw new Error(textError);
                }
            });
        return prtn;
    }

    async writeRemoteFile(
        screenId: string,
        lineId: string,
        path: string,
        data: Uint8Array,
        opts?: { useTemp?: boolean }
    ): Promise<void> {
        opts = opts || {};
        const params = {
            screenid: screenId,
            lineid: lineId,
            path: path,
            usetemp: !!opts.useTemp,
        };
        const formData = new FormData();
        formData.append("params", JSON.stringify(params));
        const blob = new Blob([data], { type: "application/octet-stream" });
        formData.append("data", blob);
        const url = new URL(this.getBaseHostPort() + "/api/write-file");
        const fetchHeaders = this.getFetchHeaders();
        const prtn = fetch(url, { method: "post", headers: fetchHeaders, body: formData });
        const resp = await prtn;
        const _ = await handleJsonFetchResponse(url, resp);
    }
}

export { Model };
