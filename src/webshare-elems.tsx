import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import {WebShareModel, getTermPtyData} from "./webshare-model";
import * as T from "./types";
import {isBlank} from "./util";
import {PluginModel} from "./plugins";
import * as lineutil from "./lineutil";
import * as util from "./util";
import {windowWidthToCols, windowHeightToRows, termHeightFromRows, termWidthFromCols} from "./textmeasure";
import {debounce, throttle} from "throttle-debounce";
import {LinesView} from "./linesview";
import {Toggle} from "./elements";
import {SimpleBlobRendererModel, SimpleBlobRenderer} from "./simplerenderer";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;

let foo = LinesView;

// TODO reshare
// TODO debounce some of the updates

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
class WebLineCmdView extends React.Component<{line : T.WebLine, cmd : T.WebCmd, topBorder : boolean, width: number, onHeightChange : T.LineHeightChangeCallbackType, staticRender : boolean, visible : OV<boolean>}, {}> {
    lineRef : React.RefObject<any> = React.createRef();
    isCmdExpanded : OV<boolean> = mobx.observable.box(false, {name: "cmd-expanded"});
    isOverflow : OV<boolean> = mobx.observable.box(false, {name: "line-overflow"});
    cmdTextRef : React.RefObject<any> = React.createRef();
    copiedIndicator : OV<boolean> =  mobx.observable.box(false, {name: "copiedIndicator"});
    lastHeight : number;

    componentDidMount() : void {
        this.checkCmdText();
        this.componentDidUpdate();
    }

    componentDidUpdate() : void {
        this.handleHeightChange();
    }
    
    renderSimple() {
        let {line, cmd, topBorder} = this.props;
        let height : number = 0;
        if (isBlank(line.renderer) || line.renderer == "terminal") {
            height = this.getTerminalRendererHeight(cmd);
        }
        else {
            let {line, width} = this.props;
            let usedRows = WebShareModel.getUsedRows(lineutil.getWebRendererContext(line), line, cmd, width);
            height = 36 + usedRows;
        }
        let mainCn = cn(
            "line",
            "line-cmd",
            {"top-border": topBorder},
        );
        return (
            <div ref={this.lineRef} className={mainCn} data-lineid={line.lineid} data-linenum={line.linenum} style={{height: height}}>
                <LineAvatar line={line} cmd={null}/>
            </div>
        );
    }

    getTerminalRendererHeight(cmd : T.WebCmd) : number {
        let {line, width} = this.props;
        let height = 42; // height of zero height terminal
        let usedRows = WebShareModel.getUsedRows(lineutil.getWebRendererContext(line), line, cmd, width);
        if (usedRows > 0) {
            height = 53 + termHeightFromRows(usedRows, WebShareModel.getTermFontSize());
        }
        return height;
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

    checkCmdText() {
        let metaElem = this.cmdTextRef.current;
        if (metaElem == null || metaElem.childNodes.length == 0) {
            return;
        }
        let metaElemWidth = metaElem.offsetWidth;
        let metaChild = metaElem.firstChild;
        let children = metaChild.childNodes;
        let childWidth = 0;
        for (let i=0; i<children.length; i++) {
            let ch = children[i];
            childWidth += ch.offsetWidth;
        }
        let isOverflow = (childWidth > metaElemWidth);
        if (isOverflow != this.isOverflow.get()) {
            mobx.action(() => {
                this.isOverflow.set(isOverflow);
            })();
        }
    }

    @boundMethod
    handleHeightChange() : void {
        let {line} = this.props;
        let curHeight = 0;
        let curWidth = 0;
        let elem = this.lineRef.current;
        if (elem != null) {
            curHeight = elem.offsetHeight;
            curWidth = elem.offsetWidth;
        }
        if (this.lastHeight == curHeight) {
            return;
        }
        let lastHeight = this.lastHeight;
        this.lastHeight = curHeight;
        this.props.onHeightChange(line.linenum, curHeight, lastHeight);
        // console.log("line height change: ", line.linenum, lastHeight, "=>", curHeight);
    }

    @boundMethod
    handleClick() : void {
        WebShareModel.setSelectedLine(this.props.line.linenum);
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

    copyAllowed() : boolean {
        return (navigator.clipboard != null);
    }

    @boundMethod
    clickCopy() : void {
        if (this.copyAllowed()) {
            let {cmd} = this.props;
            navigator.clipboard.writeText(cmd.cmdstr);
        }
        mobx.action(() => {
            this.copiedIndicator.set(true);
        })();
        setTimeout(() => {
            mobx.action(() => {
                this.copiedIndicator.set(false);
            })();
        }, 600);
    }

    getRendererOpts(cmd : T.WebCmd) : T.RendererOpts {
        return {
            maxSize: WebShareModel.getMaxContentSize(),
            idealSize: WebShareModel.getIdealContentSize(),
            termOpts: mobx.toJS(cmd.termopts),
            termFontSize: WebShareModel.getTermFontSize(),
        };
    }

    makeRendererModelInitializeParams() : T.RendererModelInitializeParams {
        let {line, cmd} = this.props;
        let context = lineutil.getWebRendererContext(line);
        let savedHeight = WebShareModel.getContentHeight(context);
        if (savedHeight == null) {
            if (line.contentheight != null && line.contentheight != -1) {
                savedHeight = line.contentheight;
            }
            else {
                savedHeight = 0;
            }
        }
        let api = {
            saveHeight: (height : number) => {
                WebShareModel.setContentHeight(lineutil.getWebRendererContext(line), height);
            },
            onFocusChanged: (focus : boolean) => {
                // nothing
            },
            dataHandler: (data : string, model : T.RendererModel) => {
                // nothing
            },
        };
        return {
            context: context,
            isDone: !lineutil.cmdStatusIsRunning(cmd.status),
            savedHeight: savedHeight,
            opts: this.getRendererOpts(cmd),
            ptyDataSource: getTermPtyData,
            api: api,
        };
    }
    
    render() {
        let {line, cmd, topBorder, staticRender, visible} = this.props;
        let isVisible = visible.get();
        if (staticRender || !isVisible) {
            return this.renderSimple();
        }
        let model = WebShareModel;
        let isSelected = mobx.computed(() => (model.getSelectedLine() == line.linenum), {name: "computed-isSelected"}).get();
        let isServerSelected = mobx.computed(() => (model.getServerSelectedLine() == line.linenum), {name: "computed-isServerSelected"}).get();
        let rendererPlugin : T.RendererPluginType = null;
        let isNoneRenderer = (line.renderer == "none");
        if (!isBlank(line.renderer) && line.renderer != "terminal" && !isNoneRenderer) {
            rendererPlugin = PluginModel.getRendererPluginByName(line.renderer);
        }
        let rendererType = lineutil.getRendererType(line);
        let mainCn = cn("web-line line line-cmd", {"top-border": topBorder});
        let visObs = mobx.observable.box(true, {name: "visObs"});
        let width = this.props.width;
        if (width == 0) {
            width = 1024;
        }
        let isExpanded = this.isCmdExpanded.get();
        return (
            <div ref={this.lineRef} className={mainCn} data-lineid={line.lineid} data-linenum={line.linenum} onClick={this.handleClick}>
                <If condition={this.copiedIndicator.get()}>
                    <div key="copied" className="copied-indicator">
                        <div>copied</div>
                    </div>
                </If>
                <div key="focus" className={cn("focus-indicator", {"selected": isSelected || isServerSelected}, {"active": isSelected})}/>
                <div className={cn("line-header", {"is-expanded": isExpanded})}>
                    <LineAvatar line={line} cmd={cmd}/>
                    {this.renderMetaWrap()}
                    <If condition={this.copyAllowed()}>
                        <div key="copy" title="Copy Command" className={cn("line-icon copy-icon")} onClick={this.clickCopy} style={{marginLeft: 5}}>
                            <i className="fa-sharp fa-solid fa-copy"/>
                        </div>
                    </If>
                </div>
                <If condition={rendererPlugin == null && !isNoneRenderer}>
                    <TerminalRenderer line={line} cmd={cmd} width={width} staticRender={staticRender} visible={visible} onHeightChange={this.handleHeightChange}/>
                </If>
                <If condition={rendererPlugin != null}>
                    <SimpleBlobRenderer rendererContainer={WebShareModel} cmdId={line.lineid} plugin={rendererPlugin} onHeightChange={this.handleHeightChange} initParams={this.makeRendererModelInitializeParams()}/>
                </If>
                <If condition={cmd && cmd.rtnstate}>
                    <div key="rtnstate" className="cmd-rtnstate" style={{visibility: ((cmd.status == "done") ? "visible" : "hidden")}}>
                        <If condition={isBlank(cmd.rtnstatestr)}>
                            <div className="cmd-rtnstate-label">state unchanged</div>
                            <div className="cmd-rtnstate-sep"></div>
                        </If>
                        <If condition={!isBlank(cmd.rtnstatestr)}>
                            <div className="cmd-rtnstate-label">new state</div>
                            <div className="cmd-rtnstate-sep"></div>
                            <div className="cmd-rtnstate-diff">{cmd.rtnstatestr}</div>
                        </If>
                    </div>
                </If>
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
            <div className={mainCn} data-lineid={line.lineid} data-linenum={line.linenum}>
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
        mobx.action(() => {
            WebShareModel.setSelectedLine(line.linenum);
        })();
    }
    
    render() {
        let {cmd, line, width, staticRender, visible} = this.props;
        let isVisible = visible.get(); // for reaction
        let usedRows = WebShareModel.getUsedRows(lineutil.getWebRendererContext(line), line, cmd, width);
        let termHeight = termHeightFromRows(usedRows, WebShareModel.getTermFontSize());
        let termLoaded = this.termLoaded.get();
        let isFocused = (WebShareModel.getSelectedLine() == line.linenum);
        return (
            <div ref={this.elemRef} key="term-wrap" className={cn("terminal-wrapper", {"cmd-done": !lineutil.cmdStatusIsRunning(cmd.status)}, {"zero-height": (termHeight == 0)})}>
                <If condition={!isFocused}>
                    <div key="term-block" className="term-block" onClick={this.clickTermBlock}></div>
                </If>
                <div key="term-connectelem" className="terminal-connectelem" ref={this.termRef} data-cmdid={line.lineid} style={{height: termHeight}}></div>
                <If condition={!termLoaded}><div key="term-loading" className="terminal-loading-message">...</div></If>

            </div>
        );
    }
}

@mobxReact.observer
class WebLineView extends React.Component<{line : T.WebLine, cmd : T.WebCmd, topBorder : boolean, width : number, onHeightChange : T.LineHeightChangeCallbackType, staticRender : boolean, visible : OV<boolean>}, {}> {
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
class WebScreenView extends React.Component<{}, {}> {
    viewRef : React.RefObject<any> = React.createRef();
    width : OV<number> = mobx.observable.box(0, {name: "WebScreenView-width"});
    handleResize_debounced : () => void;
    rszObs : ResizeObserver;

    constructor(props : any) {
        super(props);
        this.handleResize_debounced = debounce(1000, this.handleResize.bind(this));
    }

    componentDidMount() : void {
        if (this.viewRef.current != null) {
            let viewElem = this.viewRef.current;
            this.rszObs = new ResizeObserver(this.handleResize_debounced.bind(this));
            this.rszObs.observe(viewElem);
            let width = viewElem.offsetWidth;
            if (width > 0) {
                mobx.action(() => {
                    this.width.set(width);
                    this.handleResize();
                })();
            }
        }
    }

    handleResize() : void {
        let viewElem = this.viewRef.current;
        if (viewElem == null) {
            return;
        }
        let width = viewElem.offsetWidth;
        let height = viewElem.offsetHeight;
        WebShareModel.setLastScreenSize({width, height});
        if (width != this.width.get()) {
            WebShareModel.resizeWindow({width: width, height: height});
            mobx.action(() => {
                this.width.set(width);
            })();
        }
    }

    @boundMethod
    buildLineComponent(lineProps : T.LineFactoryProps) : JSX.Element {
        let line : T.WebLine = (lineProps.line as T.WebLine);
        let cmd = WebShareModel.getCmdById(lineProps.line.lineid);
        return (
            <WebLineView key={line.lineid} line={line} cmd={cmd} topBorder={lineProps.topBorder} width={lineProps.width} onHeightChange={lineProps.onHeightChange} staticRender={lineProps.staticRender} visible={lineProps.visible}/>
        );
    }

    renderEmpty() : any {
        return (
            <div className="web-screen-view" ref={this.viewRef}>
                <div className="web-lines lines">
                    <div key="spacer" className="lines-spacer"></div>
                </div>
            </div>
        );
    }
    
    render() {
        let fullScreen = WebShareModel.screen.get();
        if (fullScreen == null || fullScreen.lines.length == 0) {
            return this.renderEmpty();
        }
        return (
            <div className="web-screen-view" ref={this.viewRef}>
                <LinesView screen={WebShareModel} width={this.width.get()} lines={fullScreen.lines} renderMode="normal" lineFactory={this.buildLineComponent}/>
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
        let shareName = "";
        if (screen != null) {
            shareName = isBlank(screen.screen.sharename) ? "(no name)" : screen.screen.sharename;
        }
        return (
            <div id="main">
                <div className="logo-header">
                    <div className="logo-text">
                        <a target="_blank" href="https://www.getprompt.dev">[prompt]</a>
                    </div>
                    <div className="flex-spacer"/>
                    <a href="https://getprompt.dev/download/" target="_blank" className="download-button button is-link">
                        <span>Download Prompt</span>
                        <span className="icon is-small">
                            <i className="fa-sharp fa-solid fa-cloud-arrow-down"/>
                        </span>
                    </a>
                </div>
                <div className="webshare-controls">
                    <div className="screen-sharename">{shareName}</div>
                    <div className="flex-spacer"/>
                    <div className="sync-control">
                        <div>Sync Selection</div>
                        <Toggle checked={WebShareModel.syncSelectedLine.get()} onChange={(val) => WebShareModel.setSyncSelectedLine(val)}/>
                    </div>
                </div>
                <div className="prompt-content">
                    <If condition={screen != null}>
                        <WebScreenView/>
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
