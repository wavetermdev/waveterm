import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {Terminal} from 'xterm';
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import * as dayjs from 'dayjs'
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames"

type LineType = {
    lineid : number,
    ts : number,
    userid : string,
    linetype : string,
    text : string,
    cmdid : string,
    cmdtext : string,
};

@mobxReact.observer
class LineMeta extends React.Component<{line : LineType}, {}> {
    render() {
        let line = this.props.line;
        return (
            <div className="meta">
                <div className="lineid">{line.lineid}</div>
                <div className="user">{line.userid}</div>
                <div className="ts">{dayjs(line.ts).format("hh:mm:ss a")}</div>
            </div>
        );
    }
}

@mobxReact.observer
class LineText extends React.Component<{line : LineType}, {}> {
    render() {
        let line = this.props.line;
        return (
            <div className="line line-text">
                <div className="avatar">
                    M
                </div>
                <div className="line-content">
                    <div className="meta">
                        <div className="user">{line.userid}</div>
                        <div className="ts">{dayjs(line.ts).format("hh:mm:ss a")}</div>
                    </div>
                    <div className="text">
                        {line.text}
                    </div>
                </div>
            </div>
        );
    }
}

function loadPtyOut(term : Terminal, sessionId : string, cmdId : string) {
    let url = sprintf("http://localhost:8080/api/ptyout?sessionid=%s&cmdid=%s", sessionId, cmdId);
    fetch(url).then((resp) => {
        if (!resp.ok) {
            throw new Error(sprintf("Bad fetch response for /api/ptyout: %d %s", resp.status, resp.statusText));
        }
        return resp.text()
    }).then((resptext) => {
        console.log(resptext);
        term.write(resptext);
    });
}

@mobxReact.observer
class LineCmd extends React.Component<{line : LineType}, {}> {
    terminal : Terminal;
    focus : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "focus"});
    
    componentDidMount() {
        let {line, sessionid} = this.props;
        console.log("load terminal", sessionid, line.cmdid);
        this.terminal = new Terminal();
        this.terminal.open(document.getElementById(this.getId()));
        loadPtyOut(this.terminal, sessionid, line.cmdid);
        console.log(this.terminal, this.terminal.element);
        this.terminal.textarea.addEventListener("focus", () => {
            mobx.action(() => {
                this.focus.set(true);
            })();
        });
        this.terminal.textarea.addEventListener("blur", () => {
            mobx.action(() => {
                this.focus.set(false);
            })();
        });
    }

    getId() : string {
        let {line} = this.props;
        return "cmd-" + line.lineid + "-" + line.cmdid;
    }
    
    render() {
        let {line} = this.props;
        let lineid = line.lineid.toString();
        let running = false;
        return (
            <div className="line line-cmd">
                <div className={cn("avatar",{"num4": lineid.length == 4}, {"num5": lineid.length >= 5}, {"running": running})}>
                    {lineid}
                </div>
                <div className="line-content">
                    <div className="meta">
                        <div className="user">{line.userid}</div>
                        <div className="ts">{dayjs(line.ts).format("hh:mm:ss a")}</div>
                        <div className="cmdtext">&gt; {line.cmdtext}</div>
                    </div>
                    <div className={cn("terminal-wrapper", {"focus": this.focus.get()})}>
                        <div className="terminal" id={this.getId()}></div>
                    </div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class Line extends React.Component<{line : LineType}, {}> {
    render() {
        let line = this.props.line;
        if (line.linetype == "text") {
            return <LineText {...this.props}/>;
        }
        if (line.linetype == "cmd") {
            return <LineCmd {...this.props}/>;
        }
        return <div className="line line-invalid">[invalid line type '{line.linetype}']</div>;
    }
}

@mobxReact.observer
class CmdInput extends React.Component<{line : LineType}, {}> {
    curLine : mobx.IObservableValue<string> = mobx.observable("", {name: "command-line"});

    @mobx.action @boundMethod
    onKeyDown(e : any) {
        mobx.action(() => {
            let ctrlMod = e.getModifierState("Control") || e.getModifierState("Meta") || e.getModifierState("Shift");
            if (e.code == "Enter" && !ctrlMod) {
                let cmdLine = this.curLine.get();
                this.curLine.set("");
                console.log("START COMMAND", cmdLine);
                e.preventDefault();
                return;
            }
            console.log(e.code, e.keyCode, e.key, event.which, ctrlMod, e);
        })();
    }

    @boundMethod
    onChange(e : any) {
        mobx.action(() => {
            this.curLine.set(e.target.value);
        })();
    }
    
    render() {
        return (
            <div className="box cmd-input has-background-black">
                <div className="cmd-input-context">
                    <div className="has-text-white">
                        <span className="bold term-blue">[ mike@imac27 master ~/work/gopath/src/github.com/sawka/darktile-termutil ]</span>
                    </div>
                </div>
                <div className="cmd-input-field field has-addons">
                    <div className="control cmd-quick-context">
                        <div className="button is-static">mike@local</div>
                    </div>
                    <div className="control cmd-input-control is-expanded">
                        <textarea value={this.curLine.get()} onKeyDown={this.onKeyDown} onChange={this.onChange} className="input" type="text"></textarea>
                    </div>
                    <div className="control cmd-exec">
                        <div className="button">
                            <span className="icon">
                                <i className="fa fa-rocket"/>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class Main extends React.Component<{sessionid : string}, {}> {
    render() {
        let lines = [
            {lineid: 1, userid: "sawka", ts: 1654631122000, linetype: "text", text: "hello"},
            {lineid: 2, userid: "sawka", ts: 1654631125000, linetype: "text", text: "again"},
            {lineid: 3, userid: "sawka", ts: 1654631125000, linetype: "??", text: "again"},
            {lineid: 4, userid: "sawka", ts: 1654631125000, linetype: "cmd", cmdid: "47445c53-cfcf-4943-8339-2c04447f20a1", cmdtext: "ls -l"},
            {lineid: 5, userid: "sawka", ts: 1654631135000, linetype: "cmd", cmdid: "792a66ab-577c-4fe1-88f4-862703bdb42d", cmdtext: "ls -l | grep go"},
        ];
        return (
            <div className="main">
                <h1 className="title scripthaus-logo-small">
                    <div className="title-cursor">&#9608;</div>
                    ScriptHaus
                </h1>
                <div className="lines">
                    <For each="line" of={lines}>
                        <Line key={line.lineid} line={line} sessionid={this.props.sessionid}/>
                    </For>
                </div>
                <CmdInput/>
            </div>
        );
    }
}


export {Main};
