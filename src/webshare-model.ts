import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {handleJsonFetchResponse, isModKeyPress, base64ToArray} from "./util";
import * as T from "./types";
import {TermWrap} from "./term";
import * as lineutil from "./lineutil";
import {windowWidthToCols, windowHeightToRows, termWidthFromCols, termHeightFromRows} from "./textmeasure";
import {WebShareWSControl} from "./webshare-ws";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;
type CV<V> = mobx.IComputedValue<V>;

function isBlank(s : string) {
    return (s == null || s == "");
}

function getBaseUrl() {
    return "https://ot2e112zx5.execute-api.us-west-2.amazonaws.com/dev";
}

function getBaseWSUrl() {
    return "wss://5lfzlg5crl.execute-api.us-west-2.amazonaws.com/dev";
}

class WebShareModelClass {
    viewKey : string;
    screenId : string;
    errMessage : OV<string> = mobx.observable.box(null, {name: "errMessage"});
    screen : OV<T.WebFullScreen> = mobx.observable.box(null, {name: "webScreen"});
    terminals : Record<string, TermWrap> = {};        // lineid => TermWrap
    renderers : Record<string, T.RendererModel> = {};   // lineid => RendererModel
    contentHeightCache : Record<string, number> = {};  // lineid => height
    wsControl : WebShareWSControl;
    anchor : {anchorLine : number, anchorOffset : number} = {anchorLine: 0, anchorOffset: 0};
    
    constructor() {
        let urlParams = new URLSearchParams(window.location.search);
        this.viewKey = urlParams.get("viewkey");
        this.screenId = urlParams.get("screenid");
        setTimeout(() => this.loadFullScreenData(), 10);
        this.wsControl = new WebShareWSControl(getBaseWSUrl(), this.screenId, this.viewKey, this.wsMessageCallback.bind(this));
    }

    setErrMessage(msg : string) : void {
        mobx.action(() => {
            this.errMessage.set(msg);
        })();
    }

    getSelectedLine() : number {
        let fullScreen = this.screen.get();
        if (fullScreen != null) {
            return fullScreen.screen.selectedline;
        }
        return 0;
    }

    setAnchorFields(anchorLine : number, anchorOffset : number, reason : string) : void {
        this.anchor.anchorLine = anchorLine;
        this.anchor.anchorOffset = anchorOffset;
    }

    getAnchor() : {anchorLine : number, anchorOffset : number} {
        return this.anchor;
    }

    getTermFontSize() : number {
        return 12;
    }

    resizeWindow(winSize : T.WindowSize) : void {
        let cols = windowWidthToCols(winSize.width, this.getTermFontSize());
        for (let lineId in this.terminals) {
            let termWrap = this.terminals[lineId];
            termWrap.resizeCols(cols);
        }
    }

    mergeLine(fullScreen : T.WebFullScreen, newLine : T.WebLine) {
        for (let i=0; i<fullScreen.lines.length; i++) {
            let line = fullScreen.lines[i];
            if (line.lineid == newLine.lineid) {
                fullScreen.lines[i] = newLine;
                return;
            }
            if (line.linenum > newLine.linenum) {
                fullScreen.lines.splice(i, 0, newLine);
                return;
            }
        }
        fullScreen.lines.push(newLine);
    }

    removeLine(fullScreen : T.WebFullScreen, lineId : string) {
        for (let i=0; i<fullScreen.lines.length; i++) {
            let line = fullScreen.lines[i];
            if (line.lineid == lineId) {
                fullScreen.lines.splice(i, 1);
                break;
            }
        }
        for (let i=0; i<fullScreen.cmds.length; i++) {
            let cmd = fullScreen.cmds[i];
            if (cmd.lineid == lineId) {
                fullScreen.cmds.splice(i, 1);
                break;
            }
        }
        this.unloadRenderer(lineId);
    }

    setCmdDone(lineId : string) : void {
        let termWrap = this.getTermWrap(lineId);
        if (termWrap != null) {
            termWrap.cmdDone();
        }
    }

    mergeCmd(fullScreen : T.WebFullScreen, newCmd : T.WebCmd) {
        for (let i=0; i<fullScreen.cmds.length; i++) {
            let cmd = fullScreen.cmds[i];
            if (cmd.lineid == newCmd.lineid) {
                let wasRunning = lineutil.cmdStatusIsRunning(cmd.status);
                let isRunning = lineutil.cmdStatusIsRunning(newCmd.status);
                if (wasRunning && !isRunning) {
                    setTimeout(() => this.setCmdDone(cmd.lineid), 300);
                }
                fullScreen.cmds[i] = newCmd;
                return;
            }
        }
        fullScreen.cmds.push(newCmd);
    }

    mergeUpdate(msg : T.WebScreenUpdate) {
        if (msg.screenid != this.screenId) {
            console.log("bad WebScreenUpdate, wrong screenid", msg.screenid);
            return;
        }
        console.log("merge", msg);
        mobx.action(() => {
            let fullScreen = this.screen.get();
            if (msg.screen) {
                fullScreen.screen = msg.screen;
            }
            if (msg.lines != null && msg.lines.length > 0) {
                for (let line of msg.lines) {
                    this.mergeLine(fullScreen, line);
                }
            }
            if (msg.cmds != null && msg.cmds.length > 0) {
                for (let cmd of msg.cmds) {
                    this.mergeCmd(fullScreen, cmd);
                }
            }
            if (msg.ptydata != null && msg.ptydata.length > 0) {
                for (let data of msg.ptydata) {
                    let termWrap = this.getTermWrap(data.lineid);
                    if (termWrap == null) {
                        continue;
                    }
                    let dataArr = base64ToArray(data.data);
                    termWrap.receiveData(data.ptypos, dataArr, "ws:ptydata");
                }
            }
            if (msg.removedlines != null && msg.removedlines.length > 0) {
                for (let lineid of msg.removedlines) {
                    this.removeLine(fullScreen, lineid);
                }
            }
        })();
    }

    wsMessageCallback(msg : any) {
        if (msg.type == "webscreen:update") {
            this.mergeUpdate(msg);
            return;
        }
        console.log("ws message", msg);
    }

    setWebFullScreen(screen : T.WebFullScreen) {
        mobx.action(() => {
            if (screen.lines == null) {
                screen.lines = [];
            }
            if (screen.cmds == null) {
                screen.cmds = [];
            }
            this.screen.set(screen);
            this.wsControl.reconnect(true);
        })();
        
    }

    loadTerminalRenderer(elem : Element, line : T.WebLine, cmd : T.WebCmd, width : number) : void {
        let lineId = cmd.lineid;
        let termWrap = this.getTermWrap(lineId);
        if (termWrap != null) {
            console.log("term-wrap already exists for", lineId);
            return;
        }
        let cols = windowWidthToCols(width, this.getTermFontSize());
        let usedRows = this.getContentHeight(lineutil.getWebRendererContext(line));
        if (line.contentheight != null && line.contentheight != -1) {
            usedRows = line.contentheight;
        }
        let termContext = lineutil.getWebRendererContext(line);
        termWrap = new TermWrap(elem, {
            termContext: termContext,
            usedRows: usedRows,
            termOpts: cmd.termopts,
            winSize: {height: 0, width: width},
            dataHandler: null,
            focusHandler: (focus : boolean) => this.setTermFocus(line.linenum, focus),
            isRunning: lineutil.cmdStatusIsRunning(cmd.status),
            customKeyHandler: this.termCustomKeyHandler.bind(this),
            fontSize: this.getTermFontSize(),
            ptyDataSource: getTermPtyData,
            onUpdateContentHeight: (termContext : T.RendererContext, height : number) => { this.setContentHeight(termContext, height); },
        });
        this.terminals[lineId] = termWrap;
        if (this.getSelectedLine() == line.linenum) {
            termWrap.giveFocus();
        }
        return;
    }

    termCustomKeyHandler(e : any, termWrap : TermWrap) : boolean {
        if (e.type != "keydown" || isModKeyPress(e)) {
            return false;
        }
        e.stopPropagation();
        e.preventDefault();
        if (e.code == "ArrowUp") {
            termWrap.terminal.scrollLines(-1);
            return false;
        }
        if (e.code == "ArrowDown") {
            termWrap.terminal.scrollLines(1);
            return false;
        }
        if (e.code == "PageUp") {
            termWrap.terminal.scrollPages(-1);
            return false;
        }
        if (e.code == "PageDown") {
            termWrap.terminal.scrollPages(1);
            return false;
        }
        return false;
    }

    setTermFocus(lineNum : number, focus : boolean) : void {
    }

    getContentHeight(context : T.RendererContext) : number {
        let key = context.lineId;
        return this.contentHeightCache[key];
    }

    setContentHeight(context : T.RendererContext, height : number) : void {
        let key = context.cmdId;
        this.contentHeightCache[key] = height;
    }

    unloadRenderer(lineId : string) : void {
        let rmodel = this.renderers[lineId];
        if (rmodel != null) {
            rmodel.dispose();
            delete this.renderers[lineId];
        }
        let term = this.terminals[lineId];
        if (term != null) {
            term.dispose();
            delete this.terminals[lineId];
        }
    }

    getUsedRows(context : T.RendererContext, line : T.WebLine, cmd : T.WebCmd, width : number) : number {
        if (cmd == null) {
            return 0;
        }
        let termOpts = cmd.termopts;
        if (!termOpts.flexrows) {
            return termOpts.rows;
        }
        let termWrap = this.getTermWrap(cmd.lineid);
        if (termWrap == null) {
            let cols = windowWidthToCols(width, this.getTermFontSize());
            let usedRows = this.getContentHeight(context);
            if (usedRows != null) {
                return usedRows;
            }
            if (line.contentheight != null && line.contentheight != -1) {
                return line.contentheight;
            }
            return (lineutil.cmdStatusIsRunning(cmd.status) ? 1 : 0);
        }
        return termWrap.getUsedRows();
    }

    getTermWrap(lineId : string) : TermWrap {
        return this.terminals[lineId];
    }

    getRenderer(lineId : string) : T.RendererModel {
        return this.renderers[lineId];
    }

    loadFullScreenData() : void {
        if (isBlank(this.screenId)) {
            this.setErrMessage("No ScreenId Specified, Cannot Load.");
            return;
        }
        if (isBlank(this.viewKey)) {
            this.setErrMessage("No ViewKey Specified, Cannot Load.");
            return;
        }
        let usp = new URLSearchParams({screenid: this.screenId, viewkey: this.viewKey});
        let url = new URL(getBaseUrl() + "/webshare/screen?" + usp.toString());
        fetch(url, {method: "GET", mode: "cors", cache: "no-cache"}).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                let screen : T.WebFullScreen = data;
                this.setWebFullScreen(screen);
            })();
        }).catch((err) => {
            this.errMessage.set("Cannot get screen: " + err.message);
        });
    }

    getLineIndex(lineNum : number) : number {
        let fullScreen = this.screen.get();
        if (fullScreen == null) {
            return -1;
        }
        for (let i=0; i<fullScreen.lines.length; i++) {
            let line = fullScreen.lines[i];
            if (line.linenum == lineNum) {
                return i;
            }
        }
        return -1;
    }

    getNumLines() : number {
        let fullScreen = this.screen.get();
        if (fullScreen == null) {
            return 0;
        }
        return fullScreen.lines.length;
    }

    getCmdById(lineId : string) : T.WebCmd {
        let fullScreen = this.screen.get();
        if (fullScreen == null) {
            return null;
        }
        for (let cmd of fullScreen.cmds) {
            if (cmd.lineid == lineId) {
                return cmd;
            }
        }
        return null;
    }
}

function getTermPtyData(termContext : T.TermContextUnion) : Promise<T.PtyDataType> {
    if ("remoteId" in termContext) {
        throw new Error("remote term ptydata is not supported in webshare");
    }
    let ptyOffset = 0;
    let viewKey = WebShareModel.viewKey;
    let usp = new URLSearchParams({screenid: termContext.screenId, viewkey: viewKey, lineid: termContext.lineId});
    let url = new URL(getBaseUrl() + "/webshare/ptydata?" + usp.toString());
    return fetch(url, {method: "GET", mode: "cors", cache: "no-cache"}).then((resp) => {
        if (!resp.ok) {
            throw new Error(sprintf("Bad fetch response for /webshare/ptydata: %d %s", resp.status, resp.statusText));
        }
        let ptyOffsetStr = resp.headers.get("X-PtyDataOffset");
        if (ptyOffsetStr != null && !isNaN(parseInt(ptyOffsetStr))) {
            ptyOffset = parseInt(ptyOffsetStr);
        }
        return resp.arrayBuffer();
    }).then((buf) => {
        return {pos: ptyOffset, data: new Uint8Array(buf)};
    });
}

let WebShareModel : WebShareModelClass = null;
if ((window as any).WebShareModel == null) {
    WebShareModel = new WebShareModelClass();
    (window as any).WebShareModel = WebShareModel;
}

export {WebShareModel};
