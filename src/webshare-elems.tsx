import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import {WebShareModel} from "./webshare-model";
import * as T from "./types";
import {isBlank} from "./util";
import {PluginModel} from "./plugins";
import * as lineutil from "./lineutil";
import * as util from "./util";
import {windowWidthToCols, windowHeightToRows, termHeightFromRows, termWidthFromCols} from "./textmeasure";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;

// TODO selection
// TODO websocket

function makeFullRemoteRef(ownerName : string, remoteRef : string, name : string) : string {
    if (isBlank(ownerName) && isBlank(name)) {
        return remoteRef;
    }
    if (!isBlank(ownerName) && isBlank(name)) {
        return ownerName + ":" + remoteRef;
    }
    if (isBlank(ownerName) && !isBlank(name)) {
        return remoteRef + ":" + name;
    }
    return ownerName + ":" + remoteRef + ":" + name;
}

function replaceHomePath(path : string, homeDir : string) : string {
    if (path == homeDir) {
        return "~";
    }
    if (path.startsWith(homeDir + "/")) {
        return "~" + path.substr(homeDir.length);
    }
    return path;
}

function getCwdStr(remote : T.WebRemote, state : T.FeStateType) : string {
    if (state == null || isBlank(state.cwd)) {
        return "~";
    }
    let cwd = state.cwd;
    if (remote && remote.homedir) {
        cwd = replaceHomePath(cwd, remote.homedir)
    }
    return cwd;
}

function getRemoteStr(remote : T.WebRemote) : string {
    if (remote == null) {
        return "(invalid remote)";
    }
    let remoteRef = (!isBlank(remote.alias) ? remote.alias : remote.canonicalname);
    let fullRef = makeFullRemoteRef(null, remoteRef, remote.name);
    return fullRef;
}

@mobxReact.observer
class Prompt extends React.Component<{remote : T.WebRemote, festate : T.FeStateType}, {}> {
    render() {
        let {remote, festate} = this.props;
        let remoteStr = getRemoteStr(remote);
        let cwd = getCwdStr(remote, festate);
        let isRoot = !!remote.isroot;
        let remoteColorClass = (isRoot ? "color-red" : "color-green");
        // if (remote && remote.remoteopts && remote.remoteopts.color) {
        //     remoteColorClass = "color-" + remote.remoteopts.color;
        // }
        let remoteTitle : string = null;
        if (remote && remote.canonicalname) {
            remoteTitle = remote.canonicalname;
        }
        return (
            <span className="term-prompt"><span title={remoteTitle} className={cn("term-prompt-remote", remoteColorClass)}>[{remoteStr}]</span> <span className="term-prompt-cwd">{cwd}</span> <span className="term-prompt-end">{isRoot ? "#" : "$"}</span></span>
        );
    }
}

@mobxReact.observer
class LineAvatar extends React.Component<{line : T.WebLine, cmd : T.WebCmd}, {}> {
    render() {
        let {line, cmd} = this.props;
        let lineNumStr = String(line.linenum);
        let status = (cmd != null ? cmd.status : "done");
        let rtnstate = (cmd != null ? cmd.rtnstate : false);
        let isComment = (line.linetype == "text");
        return (
            <div className={cn("avatar", "num-"+lineNumStr.length, "status-" + status, {"rtnstate": rtnstate})}>
                {lineNumStr}
                <If condition={status == "hangup" || status == "error"}>
                    <i className="fa-sharp fa-solid fa-triangle-exclamation status-icon"/>
                </If>
                <If condition={status == "detached"}>
                    <i className="fa-sharp fa-solid fa-rotate status-icon"/>
                </If>
                <If condition={isComment}>
                    <i className="fa-sharp fa-solid fa-comment comment-icon"/>
                </If>
            </div>
        );
    }
}

@mobxReact.observer
class WebLineCmdView extends React.Component<{line : T.WebLine, cmd : T.WebCmd, topBorder : boolean}, {}> {
    isCmdExpanded : OV<boolean> = mobx.observable.box(false, {name: "cmd-expanded"});
    isOverflow : OV<boolean> = mobx.observable.box(false, {name: "line-overflow"});
    cmdTextRef : React.RefObject<any> = React.createRef();
    
    renderSimple() {
        let {line} = this.props;
        return (
            <div className={cn("web-line line", (line.linetype == "cmd" ? "line-cmd" : "line-text"))}>
                <LineAvatar line={line} cmd={null}/>
            </div>
        );
    }

    @boundMethod
    handleExpandCmd() : void {
        mobx.action(() => {
            this.isCmdExpanded.set(true);
        })();
    }

    renderCmdText(cmd : T.WebCmd, remote : T.WebRemote) : any {
        if (cmd == null) {
            return (
                <div className="metapart-mono cmdtext">
                    <span className="term-bright-green">(cmd not found)</span>
                </div>
            );
        }
        if (this.isCmdExpanded.get()) {
            return (
                <React.Fragment>
                    <div key="meta2" className="meta meta-line2">
                        <div className="metapart-mono cmdtext">
                            <Prompt remote={cmd.remote} festate={cmd.festate}/>
                        </div>
                    </div>
                    <div key="meta3" className="meta meta-line3 cmdtext-expanded-wrapper">
                        <div className="cmdtext-expanded">{lineutil.getFullCmdText(cmd.cmdstr)}</div>
                    </div>
                </React.Fragment>
            );
        }
        let isMultiLine = lineutil.isMultiLineCmdText(cmd.cmdstr);
        return (
            <div key="meta2" className="meta meta-line2" ref={this.cmdTextRef}>
                <div className="metapart-mono cmdtext">
                    <Prompt remote={cmd.remote} festate={cmd.festate}/>
                    <span> </span>
                    <span>{lineutil.getSingleLineCmdText(cmd.cmdstr)}</span>
                </div>
                <If condition={this.isOverflow.get() || isMultiLine}>
                    <div className="cmdtext-overflow" onClick={this.handleExpandCmd}>...&#x25BC;</div>
                </If>
            </div>
        );
    }

    @boundMethod
    handleHeightChange() : void {
    }

    renderMetaWrap() {
        let {line, cmd} = this.props;
        let formattedTime = lineutil.getLineDateTimeStr(line.ts);
        let termOpts = cmd.termopts;
        let remote = cmd.remote;
        let renderer = line.renderer;
        return (
            <div key="meta" className="meta-wrap">
                <div key="meta1" className="meta meta-line1">
                    <div className="ts">{formattedTime}</div>
                    <div>&nbsp;</div>
                    <If condition={!isBlank(renderer) && renderer != "terminal"}>
                        <div className="renderer"><i className="fa-sharp fa-solid fa-fill"/>{renderer}&nbsp;</div>
                    </If>
                    <div className="termopts">
                        ({termOpts.rows}x{termOpts.cols})
                    </div>
                </div>
                {this.renderCmdText(cmd, remote)}
            </div>
        );
    }
    
    render() {
        let {line, cmd, topBorder} = this.props;
        let model = WebShareModel;
        let isSelected = mobx.computed(() => (model.getSelectedLine() == line.linenum), {name: "computed-isSelected"}).get();
        let rendererPlugin : T.RendererPluginType = null;
        let isNoneRenderer = (line.renderer == "none");
        if (!isBlank(line.renderer) && line.renderer != "terminal" && !isNoneRenderer) {
            rendererPlugin = PluginModel.getRendererPluginByName(line.renderer);
        }
        let rendererType = lineutil.getRendererType(line);
        let mainCn = cn("web-line line line-cmd", {"top-border": topBorder});
        let visObs = mobx.observable.box(true, {name: "visObs"});
        return (
            <div className={mainCn}>
                <div key="focus" className={cn("focus-indicator", {"selected active": isSelected})}/>
                <div className="line-header">
                    <LineAvatar line={line} cmd={cmd}/>
                    {this.renderMetaWrap()}
                </div>
                <TerminalRenderer line={line} cmd={cmd} width={1024} staticRender={false} visible={visObs} onHeightChange={this.handleHeightChange}/>
            </div>
        );
    }
}

@mobxReact.observer
class WebLineTextView extends React.Component<{line : T.WebLine, cmd : T.WebCmd, topBorder : boolean}, {}> {
    render() {
        let {line, topBorder} = this.props;
        let model = WebShareModel;
        let isSelected = mobx.computed(() => (model.getSelectedLine() == line.linenum), {name: "computed-isSelected"}).get();
        let mainCn = cn("web-line line line-text", {"top-border": topBorder});
        return (
            <div className={mainCn}>
                <div key="focus" className={cn("focus-indicator", {"selected active": isSelected})}/>
                <div className="line-header">
                    <LineAvatar line={line} cmd={null}/>
                </div>
                <div>
                    <div>{line.text}</div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class TerminalRenderer extends React.Component<{line : T.WebLine, cmd : T.WebCmd, width : number, staticRender : boolean, visible : OV<boolean>, onHeightChange : () => void}, {}> {
    termLoaded : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "termrenderer-termLoaded"});
    elemRef : React.RefObject<any> = React.createRef();
    termRef : React.RefObject<any> = React.createRef();

    constructor(props) {
        super(props);
    }

    componentDidMount() {
        this.componentDidUpdate(null, null, null);
    }

    componentWillUnmount() {
        if (this.termLoaded.get()) {
            this.unloadTerminal(true);
        }
    }

    getSnapshotBeforeUpdate(prevProps, prevState) : {height : number} {
        let elem = this.elemRef.current;
        if (elem == null) {
            return {height: 0};
        }
        return {height: elem.offsetHeight};
    }

    componentDidUpdate(prevProps, prevState, snapshot : {height : number}) : void {
        if (this.props.onHeightChange == null) {
            return;
        }
        let {line} = this.props;
        let curHeight = 0;
        let elem = this.elemRef.current;
        if (elem != null) {
            curHeight = elem.offsetHeight;
        }
        if (snapshot == null) {
            snapshot = {height: 0};
        }
        if (snapshot.height != curHeight) {
            this.props.onHeightChange();
            // console.log("term-render height change: ", line.linenum, snapshot.height, "=>", curHeight);
        }
        this.checkLoad();
    }

    checkLoad() : void {
        let {line, staticRender, visible} = this.props;
        if (staticRender) {
            return;
        }
        let vis = visible && visible.get();
        let curVis = this.termLoaded.get();
        if (vis && !curVis) {
            this.loadTerminal();
        }
        else if (!vis && curVis) {
            this.unloadTerminal(false);
        }
    }

    loadTerminal() : void {
        let {line, cmd} = this.props;
        if (cmd == null) {
            return;
        }
        let termElem = this.termRef.current;
        if (termElem == null) {
            console.log("cannot load terminal, no term elem found", line);
            return;
        }
        WebShareModel.loadTerminalRenderer(termElem, line, cmd, this.props.width);
        mobx.action(() => this.termLoaded.set(true))();
    }

    unloadTerminal(unmount : boolean) : void {
        let {line} = this.props;
        WebShareModel.unloadRenderer(line.lineid);
        if (!unmount) {
            mobx.action(() => this.termLoaded.set(false))();
            let termElem = this.termRef.current;
            if (termElem != null) {
                termElem.replaceChildren();
            }
        }
    }
    
    @boundMethod
    clickTermBlock(e : any) {
        let {line} = this.props;
        let termWrap = WebShareModel.getTermWrap(line.lineid);
        if (termWrap != null) {
            termWrap.giveFocus();
        }
    }
    
    render() {
        let {cmd, line, width, staticRender, visible} = this.props;
        let isVisible = visible.get(); // for reaction
        let usedRows = WebShareModel.getUsedRows(lineutil.getWebRendererContext(line), line, cmd, width);
        let termHeight = termHeightFromRows(usedRows, WebShareModel.getTermFontSize());
        let termLoaded = this.termLoaded.get();
        return (
            <div ref={this.elemRef} key="term-wrap" className={cn("terminal-wrapper", {"cmd-done": !lineutil.cmdStatusIsRunning(cmd.status)}, {"zero-height": (termHeight == 0)})}>
                <div key="term-connectelem" className="terminal-connectelem" ref={this.termRef} data-cmdid={line.lineid} style={{height: termHeight}}></div>
                <If condition={!termLoaded}><div key="term-loading" className="terminal-loading-message">...</div></If>

            </div>
        );
    }
}

@mobxReact.observer
class WebLineView extends React.Component<{line : T.WebLine, cmd : T.WebCmd, topBorder : boolean}, {}> {
    render() {
        let {line} = this.props;
        if (line.linetype == "text") {
            return <WebLineTextView {...this.props}/>
        }
        if (line.linetype == "cmd") {
            return <WebLineCmdView {...this.props}/>
        }
        return (
            <div className="web-line line">invalid linetype "{line.linetype}"</div>
        );
    }
}

@mobxReact.observer
class WebScreenView extends React.Component<{screen : T.WebFullScreen}, {}> {
    render() {
        let {screen} = this.props;
        let lines = screen.lines ?? [];
        let cmds = screen.cmds ?? [];
        let cmdMap : Record<string, T.WebCmd> = {};
        for (let i=0; i<cmds.length; i++) {
            let cmd = cmds[i];
            cmdMap[cmd.lineid] = cmd;
        }
        let lineElements : any[] = [];
        let todayStr = util.getTodayStr();
        let yesterdayStr = util.getYesterdayStr();
        let prevDateStr : string = null;
        for (let idx=0; idx<lines.length; idx++) {
            let line = lines[idx];
            let lineNumStr = String(line.linenum);
            let dateSepStr = null;
            let curDateStr = lineutil.getLineDateStr(todayStr, yesterdayStr, line.ts);
            if (curDateStr != prevDateStr) {
                dateSepStr = curDateStr;
            }
            prevDateStr = curDateStr;
            if (dateSepStr != null) {
                let sepElem = <div key={"sep-" + line.lineid} className="line-sep">{dateSepStr}</div>
                lineElements.push(sepElem);
            }
            let topBorder = (dateSepStr == null) && (idx != 0);
            let lineElem = <WebLineView key={line.lineid} line={line} cmd={cmdMap[line.lineid]} topBorder={topBorder}/>;
            lineElements.push(lineElem);
        }
        return (
            <div className="web-screen-view">
                <div className="web-lines lines">
                    <div className="lines-spacer"></div>
                    {lineElements}
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class WebShareMain extends React.Component<{}, {}> {
    renderCopy() {
        return (<div className="footer-copy">&copy; 2023 Dashborg Inc</div>);
    }
            
    render() {
        let screen = WebShareModel.screen.get();
        let errMessage = WebShareModel.errMessage.get();
        return (
            <div id="main">
                <div className="logo-header">
                    <div className="logo-text">
                        <a target="_blank" href="https://www.getprompt.dev">[prompt]</a>
                    </div>
                    <If condition={screen != null}>
                        <div className="screen-name">{screen.screen.sharename}</div>
                    </If>
                    <div className="flex-spacer"/>
                    <a href="https://getprompt.dev/download/" target="_blank" className="download-button button is-link">
                        <span>Download Prompt</span>
                        <span className="icon is-small">
                            <i className="fa-sharp fa-solid fa-cloud-arrow-down"/>
                        </span>
                    </a>
                </div>
                <div className="prompt-content">
                    <If condition={screen != null}>
                        <WebScreenView screen={screen}/>
                    </If>
                    <If condition={errMessage != null}>
                        <div className="err-message">{WebShareModel.errMessage.get()}</div>
                    </If>
                </div>
                <div className="prompt-footer">
                    {this.renderCopy()}
                    <div className="flex-spacer"/>
                    <a target="_blank" href="https://discord.gg/XfvZ334gwU" className="button is-link is-small">
                        <span className="icon is-small">
                            <i className="fa-brands fa-discord"/>
                        </span>
                        <span>Discord</span>
                    </a>
                </div>
            </div>
        );
    }
}

export {WebShareMain};
