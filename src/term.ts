import * as mobx from "mobx";
import {Terminal} from 'xterm';
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {GlobalWS} from "./ws";

var TermMap : Record<string, TermWrap>;

function loadPtyOut(term : Terminal, sessionId : string, cmdId : string, callback?: () => void) {
    term.clear()
    let url = sprintf("http://localhost:8080/api/ptyout?sessionid=%s&cmdid=%s", sessionId, cmdId);
    fetch(url).then((resp) => {
        if (!resp.ok) {
            throw new Error(sprintf("Bad fetch response for /api/ptyout: %d %s", resp.status, resp.statusText));
        }
        return resp.text()
    }).then((resptext) => {
        setTimeout(() => term.write(resptext, callback), 0);
    });
}

class TermWrap {
    terminal : Terminal;
    sessionId : string;
    cmdId : string;
    ptyPos : number;
    runPos : number;
    runData : string;
    renderVersion : mobx.IObservableValue<number> = mobx.observable.box(1, {name: "renderVersion"});
    isFocused : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "focus"});

    constructor(sessionId : string, cmdId : string) {
        this.terminal = new Terminal({rows: 2, cols: 80});
        this.sessionId = sessionId;
        this.cmdId = cmdId;
        this.ptyPos = 0;
        this.runPos = 0;
        this.runData = "";
        TermMap[cmdId] = this;
    }

    resizeToContent() {
        let term = this.terminal;
        let termNumLines = term._core.buffer.lines.length;
        let termYPos = term._core.buffer.y;
        if (term.rows < 25 && termNumLines > term.rows) {
            term.resize(80, Math.min(25, termNumLines));
        } else if (term.rows < 25 && termYPos >= term.rows) {
            term.resize(80, Math.min(25, termYPos+1));
        }
    }

    getSize() : {rows : number, cols : number} {
        return {rows: this.terminal.rows, cols: this.terminal.cols};
    }

    @boundMethod
    setFocus(val : boolean) {
        mobx.action(() => this.isFocused.set(val))();
    }

    getRenderVersion() : number {
        return this.renderVersion.get();
    }

    @boundMethod
    incRenderVersion() {
        mobx.action(() => this.renderVersion.set(this.renderVersion.get() + 1))();
    }

    reloadTerminal() {
        loadPtyOut(this.terminal, this.sessionId, this.cmdId, this.incRenderVersion);
    }

    connectToElem(elem : Element) {
        this.terminal.open(elem);
        this.terminal.textarea.addEventListener("focus", () => {
            this.setFocus(true);
        });
        this.terminal.textarea.addEventListener("blur", () => {
            this.setFocus(false);
        });
    }
}

if (window.TermMap == null) {
    TermMap = {};
    window.TermMap = TermMap;
}

export {TermWrap, TermMap};
