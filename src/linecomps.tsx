import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { If, For, When, Otherwise, Choose } from "tsx-control-statements/components";
import { GlobalModel, GlobalCommandRunner, Session, Cmd, ScreenLines, Screen, getTermPtyData } from "./model";
import { windowWidthToCols, windowHeightToRows, termHeightFromRows, termWidthFromCols } from "./textmeasure";
import type {
    LineType,
    CmdDataType,
    RemoteType,
    RemotePtrType,
    RenderModeType,
    RendererContext,
    RendererOpts,
    SimpleBlobRendererComponent,
    RendererPluginType,
    LineHeightChangeCallbackType,
    RendererModelInitializeParams,
    RendererModel,
} from "./types";
import cn from "classnames";
import { TermWrap } from "./term";
import type { LineContainerModel } from "./model";
import { renderCmdText } from "./elements";
import { SimpleBlobRendererModel, SimpleBlobRenderer } from "./simplerenderer";
import { FullRenderer } from "./fullrenderer";
import { isBlank } from "./util";
import { PluginModel } from "./plugins";
import { PtyDataBuffer } from "./ptydata";
import * as lineutil from "./lineutil";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K, V> = mobx.ObservableMap<K, V>;

type RendererComponentProps = {
    screen: LineContainerModel;
    line: LineType;
    width: number;
    staticRender: boolean;
    visible: OV<boolean>;
    onHeightChange: LineHeightChangeCallbackType;
    collapsed: boolean;
};
type RendererComponentType = {
    new (props: RendererComponentProps): React.Component<RendererComponentProps, {}>;
};

function getShortVEnv(venvDir: string): string {
    if (isBlank(venvDir)) {
        return "";
    }
    let lastSlash = venvDir.lastIndexOf("/");
    if (lastSlash == -1) {
        return venvDir;
    }
    return venvDir.substr(lastSlash + 1);
}

function makeFullRemoteRef(ownerName: string, remoteRef: string, name: string): string {
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

function getRemoteStr(rptr: RemotePtrType): string {
    if (rptr == null || isBlank(rptr.remoteid)) {
        return "(invalid remote)";
    }
    let username = isBlank(rptr.ownerid) ? null : GlobalModel.resolveUserIdToName(rptr.ownerid);
    let remoteRef = GlobalModel.resolveRemoteIdToRef(rptr.remoteid);
    let fullRef = makeFullRemoteRef(username, remoteRef, rptr.name);
    return fullRef;
}

function replaceHomePath(path: string, homeDir: string): string {
    if (path == homeDir) {
        return "~";
    }
    if (path.startsWith(homeDir + "/")) {
        return "~" + path.substr(homeDir.length);
    }
    return path;
}

function getCwdStr(remote: RemoteType, state: Record<string, string>): string {
    if (state == null || isBlank(state.cwd)) {
        return "~";
    }
    let cwd = state.cwd;
    if (remote && remote.remotevars.home) {
        cwd = replaceHomePath(cwd, remote.remotevars.home);
    }
    return cwd;
}

@mobxReact.observer
class LineAvatar extends React.Component<{ line: LineType; cmd: Cmd; onRightClick?: (e: any) => void }, {}> {
    render() {
        let { line, cmd } = this.props;
        let lineNumStr = (line.linenumtemp ? "~" : "") + String(line.linenum);
        let status = cmd != null ? cmd.getStatus() : "done";
        let rtnstate = cmd != null ? cmd.getRtnState() : false;
        let isComment = line.linetype == "text";
        return (
            <div
                onContextMenu={this.props.onRightClick}
                className={cn(
                    "avatar",
                    "num-" + lineNumStr.length,
                    "status-" + status,
                    { ephemeral: line.ephemeral },
                    { rtnstate: rtnstate }
                )}
            >
                {lineNumStr}
                <If condition={status == "hangup" || status == "error"}>
                    <i className="fa-sharp fa-solid fa-triangle-exclamation status-icon" />
                </If>
                <If condition={status == "detached"}>
                    <i className="fa-sharp fa-solid fa-rotate status-icon" />
                </If>
                <If condition={isComment}>
                    <i className="fa-sharp fa-solid fa-comment comment-icon" />
                </If>
            </div>
        );
    }
}

@mobxReact.observer
class SmallLineAvatar extends React.Component<{ line: LineType; cmd: Cmd; onRightClick?: (e: any) => void }, {}> {
    render() {
        let { line, cmd } = this.props;
        let lineNumStr = (line.linenumtemp ? "~" : "#") + String(line.linenum);
        let status = cmd != null ? cmd.getStatus() : "done";
        let rtnstate = cmd != null ? cmd.getRtnState() : false;
        let exitcode = cmd != null ? cmd.getExitCode() : 0;
        let isComment = line.linetype == "text";
        let icon: string = null;
        let iconTitle = null;
        let iconColor = "auto";
        if (isComment) {
            icon = "fa-comment";
            iconTitle = "comment";
        } else if (status == "done") {
            icon = exitcode === 0 ? "fa-check" : "fa-xmark";
            iconTitle = exitcode === 0 ? "success" : "fail";
            iconColor = exitcode === 0 ? "auto" : "red";
        } else if (status == "hangup" || status == "error") {
            icon = "fa-triangle-exclamation";
            iconTitle = status;
            iconColor = "yellow";
        } else if (status == "running" || "detached") {
            icon = "fa-rotate";
            iconTitle = "running";
        } else {
            icon = "fa-square-question";
            iconTitle = "unknown";
        }
        return (
            <div
                onContextMenu={this.props.onRightClick}
                className={cn("simple-line-status", "status-" + status, rtnstate ? "has-rtnstate" : null)}
            >
                <span className="linenum">{lineNumStr}</span>
                <i title={iconTitle} className={cn("fa-sharp fa-solid", icon)} style={{ color: iconColor }} />
            </div>
        );
    }
}

@mobxReact.observer
class LineCmd extends React.Component<
    {
        screen: LineContainerModel;
        line: LineType;
        width: number;
        staticRender: boolean;
        visible: OV<boolean>;
        onHeightChange: LineHeightChangeCallbackType;
        topBorder: boolean;
        renderMode: RenderModeType;
        overrideCollapsed: OV<boolean>;
        noSelect?: boolean;
        showHints?: boolean;
    },
    {}
> {
    lineRef: React.RefObject<any> = React.createRef();
    cmdTextRef: React.RefObject<any> = React.createRef();
    rtnStateDiff: mobx.IObservableValue<string> = mobx.observable.box(null, {
        name: "linecmd-rtn-state-diff",
    });
    rtnStateDiffFetched: boolean = false;
    lastHeight: number;
    isOverflow: OV<boolean> = mobx.observable.box(false, {
        name: "line-overflow",
    });
    isMinimised: OV<boolean> = mobx.observable.box(false, {
        name: "line-minimised",
    });
    isCmdExpanded: OV<boolean> = mobx.observable.box(false, {
        name: "cmd-expanded",
    });

    constructor(props) {
        super(props);
    }

    checkStateDiffLoad(): void {
        let { screen, line, staticRender, visible } = this.props;
        if (staticRender) {
            return;
        }
        if (!visible.get()) {
            if (this.rtnStateDiffFetched) {
                this.rtnStateDiffFetched = false;
                this.setRtnStateDiff(null);
            }
            return;
        }
        let cmd = screen.getCmd(line);
        if (cmd == null || !cmd.getRtnState() || this.rtnStateDiffFetched) {
            return;
        }
        if (cmd.getStatus() != "done") {
            return;
        }
        this.fetchRtnStateDiff();
    }

    fetchRtnStateDiff(): void {
        if (this.rtnStateDiffFetched) {
            return;
        }
        let { line } = this.props;
        this.rtnStateDiffFetched = true;
        let usp = new URLSearchParams({
            linenum: String(line.linenum),
            screenid: line.screenid,
            lineid: line.lineid,
        });
        let url = GlobalModel.getBaseHostPort() + "/api/rtnstate?" + usp.toString();
        let fetchHeaders = GlobalModel.getFetchHeaders();
        fetch(url, { headers: fetchHeaders })
            .then((resp) => {
                if (!resp.ok) {
                    throw new Error(
                        sprintf("Bad fetch response for /api/rtnstate: %d %s", resp.status, resp.statusText)
                    );
                }
                return resp.text();
            })
            .then((text) => {
                this.setRtnStateDiff(text ?? "");
            })
            .catch((err) => {
                this.setRtnStateDiff("ERROR " + err.toString());
            });
    }

    setRtnStateDiff(val: string): void {
        mobx.action(() => {
            this.rtnStateDiff.set(val);
        })();
    }

    componentDidMount() {
        this.componentDidUpdate(null, null, null);
        this.checkCmdText();
    }

    @boundMethod
    handleExpandCmd(): void {
        mobx.action(() => {
            this.isCmdExpanded.set(true);
        })();
    }

    renderCmdText(cmd: Cmd): any {
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
                            <Prompt rptr={cmd.remote} festate={cmd.getRemoteFeState()} />
                        </div>
                    </div>
                    <div key="meta3" className="meta meta-line3 cmdtext-expanded-wrapper">
                        <div className="cmdtext-expanded">{lineutil.getFullCmdText(cmd.getCmdStr())}</div>
                    </div>
                </React.Fragment>
            );
        }
        let isMultiLine = lineutil.isMultiLineCmdText(cmd.getCmdStr());
        return (
            <div key="meta2" className="meta meta-line2" ref={this.cmdTextRef}>
                <div className="metapart-mono cmdtext">
                    <Prompt rptr={cmd.remote} festate={cmd.getRemoteFeState()} />
                    <span> </span>
                    <span>{lineutil.getSingleLineCmdText(cmd.getCmdStr())}</span>
                </div>
                <If condition={this.isOverflow.get() || isMultiLine}>
                    <div className="cmdtext-overflow" onClick={this.handleExpandCmd}>
                        ...&#x25BC;
                    </div>
                </If>
            </div>
        );
    }

    // TODO: this might not be necessary anymore because we're using this.lastHeight
    getSnapshotBeforeUpdate(prevProps, prevState): { height: number } {
        let elem = this.lineRef.current;
        if (elem == null) {
            return { height: 0 };
        }
        return { height: elem.offsetHeight };
    }

    componentDidUpdate(prevProps, prevState, snapshot: { height: number }): void {
        this.handleHeightChange();
        this.checkStateDiffLoad();
        this.checkCmdText();
    }

    checkCmdText() {
        let metaElem = this.cmdTextRef.current;
        if (metaElem == null || metaElem.childNodes.length == 0) {
            return;
        }
        let metaElemWidth = metaElem.offsetWidth;
        if (metaElemWidth == 0) {
            return;
        }
        let metaChild = metaElem.firstChild;
        if (metaChild == null) {
            return;
        }
        let children = metaChild.childNodes;
        let childWidth = 0;
        for (let i = 0; i < children.length; i++) {
            let ch = children[i];
            childWidth += ch.offsetWidth;
        }
        let isOverflow = childWidth > metaElemWidth;
        if (isOverflow && isOverflow != this.isOverflow.get()) {
            mobx.action(() => {
                this.isOverflow.set(isOverflow);
            })();
        }
    }

    @boundMethod
    handleHeightChange() {
        if (this.props.onHeightChange == null) {
            return;
        }
        let { line } = this.props;
        let curHeight = 0;
        let elem = this.lineRef.current;
        if (elem != null) {
            curHeight = elem.offsetHeight;
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
    handleClick() {
        let { line, noSelect } = this.props;
        if (noSelect) {
            return;
        }
        let sel = window.getSelection();
        if (this.lineRef.current != null) {
            let selText = sel.toString();
            if (sel.anchorNode != null && this.lineRef.current.contains(sel.anchorNode) && !isBlank(selText)) {
                return;
            }
        }
        GlobalCommandRunner.screenSelectLine(String(line.linenum), "cmd");
    }

    @boundMethod
    clickStar() {
        let { line } = this.props;
        if (!line.star || line.star == 0) {
            GlobalCommandRunner.lineStar(line.lineid, 1);
        } else {
            GlobalCommandRunner.lineStar(line.lineid, 0);
        }
    }

    @boundMethod
    clickPin() {
        let { line } = this.props;
        if (!line.pinned) {
            GlobalCommandRunner.linePin(line.lineid, true);
        } else {
            GlobalCommandRunner.linePin(line.lineid, false);
        }
    }

    @boundMethod
    clickBookmark() {
        let { line } = this.props;
        GlobalCommandRunner.lineBookmark(line.lineid);
    }

    @boundMethod
    clickMinimise() {
        this.isMinimised.set(!this.isMinimised.get());
    }

    @boundMethod
    handleResizeButton() {
        console.log("resize button");
    }

    getIsHidePrompt(): boolean {
        let { line } = this.props;
        let rendererPlugin: RendererPluginType = null;
        let isNoneRenderer = line.renderer == "none";
        if (!isBlank(line.renderer) && line.renderer != "terminal" && !isNoneRenderer) {
            rendererPlugin = PluginModel.getRendererPluginByName(line.renderer);
        }
        let hidePrompt = rendererPlugin != null && rendererPlugin.hidePrompt;
        return hidePrompt;
    }

    getTerminalRendererHeight(cmd: Cmd): number {
        let { screen, line, width, topBorder, renderMode } = this.props;
        // header is 36px tall, padding+border = 6px
        // zero-terminal is 0px
        // terminal-wrapper overhead is 11px (margin/padding)
        // inner-height, if zero-lines => 42
        //               else: 53+(lines*lineheight)
        let height = 36 + 6; // height of zero height terminal
        let usedRows = screen.getUsedRows(lineutil.getRendererContext(line), line, cmd, width);
        if (usedRows > 0) {
            height = 36 + 6 + 11 + termHeightFromRows(usedRows, GlobalModel.termFontSize.get());
        }
        return height;
    }

    @boundMethod
    onAvatarRightClick(e: any): void {
        let { line, noSelect } = this.props;
        if (noSelect) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (line != null) {
            mobx.action(() => {
                GlobalModel.lineSettingsModal.set(line.linenum);
            })();
        }
    }

    renderSimple() {
        let { screen, line, topBorder } = this.props;
        let cmd = screen.getCmd(line);
        let height: number = 0;
        if (isBlank(line.renderer) || line.renderer == "terminal") {
            height = this.getTerminalRendererHeight(cmd);
        } else {
            // header is 16px tall with hide-prompt, 36px otherwise
            let { screen, line, width } = this.props;
            let hidePrompt = this.getIsHidePrompt();
            let usedRows = screen.getUsedRows(lineutil.getRendererContext(line), line, cmd, width);
            height = (hidePrompt ? 16 + 6 : 36 + 6) + usedRows;
        }
        let formattedTime = lineutil.getLineDateTimeStr(line.ts);
        let mainDivCn = cn("line", "line-cmd", "line-simple", {
            "top-border": topBorder,
        });
        return (
            <div
                className={mainDivCn}
                ref={this.lineRef}
                data-lineid={line.lineid}
                data-linenum={line.linenum}
                data-screenid={line.screenid}
                style={{ height: height }}
            >
                <SmallLineAvatar line={line} cmd={cmd} />
                <div className="ts">{formattedTime}</div>
            </div>
        );
    }

    @boundMethod
    handleLineSettings(e: any): void {
        e.preventDefault();
        e.stopPropagation();
        let { line } = this.props;
        if (line != null) {
            mobx.action(() => {
                GlobalModel.lineSettingsModal.set(line.linenum);
            })();
        }
    }

    renderMeta1(cmd: Cmd) {
        let { line } = this.props;
        let termOpts = cmd.getTermOpts();
        let formattedTime = lineutil.getLineDateTimeStr(line.ts);
        let renderer = line.renderer;
        return (
            <div key="meta1" className="meta meta-line1">
                <SmallLineAvatar line={line} cmd={cmd} />
                <div className="ts">{formattedTime}</div>
                <div>&nbsp;</div>
                <If condition={!isBlank(renderer) && renderer != "terminal"}>
                    <div className="renderer">
                        <i className="fa-sharp fa-solid fa-fill" />
                        {renderer}&nbsp;
                    </div>
                </If>
                <div className="termopts">
                    ({termOpts.rows}x{termOpts.cols})
                </div>
                <div className="settings" onClick={this.handleLineSettings}>
                    <i className="fa-sharp fa-solid fa-gear" />
                </div>
            </div>
        );
    }

    getRendererOpts(cmd: Cmd): RendererOpts {
        let { screen } = this.props;
        return {
            maxSize: screen.getMaxContentSize(),
            idealSize: screen.getIdealContentSize(),
            termOpts: cmd.getTermOpts(),
            termFontSize: GlobalModel.termFontSize.get(),
        };
    }

    makeRendererModelInitializeParams(): RendererModelInitializeParams {
        let { screen, line } = this.props;
        let context = lineutil.getRendererContext(line);
        let cmd = screen.getCmd(line); // won't be null
        let savedHeight = screen.getContentHeight(context);
        if (savedHeight == null) {
            if (line.contentheight != null && line.contentheight != -1) {
                savedHeight = line.contentheight;
            } else {
                savedHeight = 0;
            }
        }
        let api = {
            saveHeight: (height: number) => {
                screen.setContentHeight(lineutil.getRendererContext(line), height);
            },
            onFocusChanged: (focus: boolean) => {
                screen.setTermFocus(line.linenum, focus);
            },
            dataHandler: (data: string, model: RendererModel) => {
                cmd.handleDataFromRenderer(data, model);
            },
        };
        return {
            context: context,
            isDone: !cmd.isRunning(),
            savedHeight: savedHeight,
            opts: this.getRendererOpts(cmd),
            ptyDataSource: getTermPtyData,
            lineState: line.linestate,
            api: api,
            rawCmd: cmd.getAsWebCmd(line.lineid),
        };
    }

    render() {
        let { screen, line, width, staticRender, visible, topBorder, renderMode } = this.props;
        let model = GlobalModel;
        let lineid = line.lineid;
        let isVisible = visible.get();
        if (staticRender || !isVisible) {
            return this.renderSimple();
        }
        let formattedTime = lineutil.getLineDateTimeStr(line.ts);
        let cmd = screen.getCmd(line);
        if (cmd == null) {
            return (
                <div
                    className="line line-invalid"
                    ref={this.lineRef}
                    data-lineid={line.lineid}
                    data-linenum={line.linenum}
                    data-screenid={line.screenid}
                >
                    [cmd not found '{line.lineid}']
                </div>
            );
        }
        let status = cmd.getStatus();
        let lineNumStr = (line.linenumtemp ? "~" : "") + String(line.linenum);
        let isSelected = mobx
            .computed(() => screen.getSelectedLine() == line.linenum, {
                name: "computed-isSelected",
            })
            .get();
        let isPhysicalFocused = mobx
            .computed(() => screen.getIsFocused(line.linenum), {
                name: "computed-getIsFocused",
            })
            .get();
        let isFocused = mobx
            .computed(
                () => {
                    let screenFocusType = screen.getFocusType();
                    return isPhysicalFocused && screenFocusType == "cmd";
                },
                { name: "computed-isFocused" }
            )
            .get();
        let isStatic = staticRender;
        let isRunning = cmd.isRunning();
        let isExpanded = this.isCmdExpanded.get();
        let rsdiff = this.rtnStateDiff.get();
        // console.log("render", "#" + line.linenum, termHeight, usedRows, cmd.getStatus(), (this.rtnStateDiff.get() != null), (!cmd.isRunning() ? "cmd-done" : "running"));
        let mainDivCn = cn(
            "line",
            "line-cmd",
            { focus: isFocused },
            { "cmd-done": !isRunning },
            { "has-rtnstate": cmd.getRtnState() },
            { "top-border": topBorder }
        );
        let rendererPlugin: RendererPluginType = null;
        let isNoneRenderer = line.renderer == "none";
        if (!isBlank(line.renderer) && line.renderer != "terminal" && !isNoneRenderer) {
            rendererPlugin = PluginModel.getRendererPluginByName(line.renderer);
        }
        let rendererType = lineutil.getRendererType(line);
        let hidePrompt = rendererPlugin != null && rendererPlugin.hidePrompt;
        return (
            <div
                className={mainDivCn}
                ref={this.lineRef}
                onClick={this.handleClick}
                data-lineid={line.lineid}
                data-linenum={line.linenum}
                data-screenid={line.screenid}
            >
                <div
                    key="focus"
                    className={cn("focus-indicator", { selected: isSelected }, { active: isSelected && isFocused })}
                />
                <div
                    key="header"
                    className={cn("line-header", { "is-expanded": isExpanded }, { "hide-prompt": hidePrompt })}
                >
                    <div key="meta" className="meta-wrap">
                        {this.renderMeta1(cmd)}
                        <If condition={!hidePrompt}>{this.renderCmdText(cmd)}</If>
                    </div>
                    <div
                        key="pin"
                        title="Pin"
                        className={cn("line-icon", { active: line.pinned })}
                        onClick={this.clickPin}
                        style={{ display: "none" }}
                    >
                        <i className="fa-sharp fa-solid fa-thumbtack" />
                    </div>
                    <div
                        key="bookmark"
                        title="Bookmark"
                        className={cn("line-icon", "line-bookmark")}
                        onClick={this.clickBookmark}
                    >
                        <i className="fa-sharp fa-regular fa-bookmark" />
                    </div>
                    <div
                        key="minimise"
                        title={`${this.isMinimised.get() ? "Maximise" : "Minimise"}`}
                        className={cn("line-icon", "line-minimise", this.isMinimised.get() ? "line-icon-show" : "")}
                        onClick={this.clickMinimise}
                    >
                        <i
                            className={`fa-sharp fa-regular ${
                                this.isMinimised.get() ? "fa-plus-circle" : "fa-minus-circle"
                            }`}
                        />
                    </div>
                </div>
                <If condition={!this.isMinimised.get()}>
                    <If condition={rendererPlugin == null && !isNoneRenderer}>
                        <TerminalRenderer
                            screen={screen}
                            line={line}
                            width={width}
                            staticRender={staticRender}
                            visible={visible}
                            onHeightChange={this.handleHeightChange}
                            collapsed={false}
                        />
                    </If>
                    <If condition={rendererPlugin != null && rendererPlugin.rendererType == "simple"}>
                        <SimpleBlobRenderer
                            rendererContainer={screen}
                            lineId={line.lineid}
                            plugin={rendererPlugin}
                            onHeightChange={this.handleHeightChange}
                            initParams={this.makeRendererModelInitializeParams()}
                        />
                    </If>
                    <If condition={rendererPlugin != null && rendererPlugin.rendererType == "full"}>
                        <FullRenderer
                            rendererContainer={screen}
                            lineId={line.lineid}
                            plugin={rendererPlugin}
                            onHeightChange={this.handleHeightChange}
                            initParams={this.makeRendererModelInitializeParams()}
                        />
                    </If>
                    <If condition={cmd.getRtnState()}>
                        <div
                            key="rtnstate"
                            className="cmd-rtnstate"
                            style={{
                                visibility: cmd.getStatus() == "done" ? "visible" : "hidden",
                            }}
                        >
                            <If condition={rsdiff == null || rsdiff == ""}>
                                <div className="cmd-rtnstate-label">state unchanged</div>
                                <div className="cmd-rtnstate-sep"></div>
                            </If>
                            <If condition={rsdiff != null && rsdiff != ""}>
                                <div className="cmd-rtnstate-label">new state</div>
                                <div className="cmd-rtnstate-sep"></div>
                                <div className="cmd-rtnstate-diff">{this.rtnStateDiff.get()}</div>
                            </If>
                        </div>
                    </If>
                    <If condition={isSelected && !isFocused && rendererType == "terminal"}>
                        <div className="cmd-hints">
                            <div className="hint-item color-nohover-white">focus line ({renderCmdText("L")})</div>
                        </div>
                    </If>
                </If>
            </div>
        );
    }
}

@mobxReact.observer
class Line extends React.Component<
    {
        screen: LineContainerModel;
        line: LineType;
        width: number;
        staticRender: boolean;
        visible: OV<boolean>;
        onHeightChange: LineHeightChangeCallbackType;
        overrideCollapsed: OV<boolean>;
        topBorder: boolean;
        renderMode: RenderModeType;
        noSelect?: boolean;
    },
    {}
> {
    render() {
        let line = this.props.line;
        if (line.archived) {
            return null;
        }
        if (line.linetype == "text") {
            return <LineText {...this.props} />;
        }
        if (line.linetype == "cmd" || line.linetype == "openai") {
            return <LineCmd {...this.props} />;
        }
        return <div className="line line-invalid">[invalid line type '{line.linetype}']</div>;
    }
}

@mobxReact.observer
class Prompt extends React.Component<{ rptr: RemotePtrType; festate: Record<string, string> }, {}> {
    render() {
        let rptr = this.props.rptr;
        if (rptr == null || isBlank(rptr.remoteid)) {
            return <span className={cn("term-prompt", "color-green")}>&nbsp;</span>;
        }
        let remote = GlobalModel.getRemote(this.props.rptr.remoteid);
        let remoteStr = getRemoteStr(rptr);
        let festate = this.props.festate ?? {};
        let cwd = getCwdStr(remote, festate);
        let isRoot = false;
        if (remote && remote.remotevars) {
            if (remote.remotevars["sudo"] || remote.remotevars["bestuser"] == "root") {
                isRoot = true;
            }
        }
        let remoteColorClass = isRoot ? "color-red" : "color-green";
        if (remote && remote.remoteopts && remote.remoteopts.color) {
            remoteColorClass = "color-" + remote.remoteopts.color;
        }
        // TESTING cwd shortening with triple colon character
        // if (cwd.startsWith("~/work/gopath/src/github.com/scripthaus-dev")) {
        //     cwd = cwd.replace("~/work/gopath/src/github.com/scripthaus-dev", "\u22EEscripthaus-dev");
        // }
        let remoteTitle: string = null;
        if (remote && remote.remotecanonicalname) {
            remoteTitle = "connected to " + remote.remotecanonicalname;
        }
        let cwdElem = (
            <span title="current directory" className="term-prompt-cwd">
                <i className="fa-solid fa-sharp fa-folder-open" />
                {cwd}
            </span>
        );
        let remoteElem = (
            <span title={remoteTitle} className={cn("term-prompt-remote", remoteColorClass)}>
                [{remoteStr}]{" "}
            </span>
        );
        let rootIndicatorElem = <span className="term-prompt-end">{isRoot ? "#" : "$"}</span>;
        let branchElem = null;
        let pythonElem = null;
        if (!isBlank(festate["PROMPTVAR_GITBRANCH"])) {
            let branchName = festate["PROMPTVAR_GITBRANCH"];
            branchElem = (
                <span title="current git branch" className="term-prompt-branch">
                    <i className="fa-sharp fa-solid fa-code-branch" />
                    {branchName}{" "}
                </span>
            );
        }
        if (!isBlank(festate["VIRTUAL_ENV"])) {
            let venvDir = festate["VIRTUAL_ENV"];
            let venv = getShortVEnv(venvDir);
            pythonElem = (
                <span title="python venv" className="term-prompt-python">
                    <i className="fa-brands fa-python" />
                    {venv}{" "}
                </span>
            );
        }
        return (
            <span className="term-prompt">
                {remoteElem} {pythonElem}
                {branchElem}
                {cwdElem} {rootIndicatorElem}
            </span>
        );
    }
}

@mobxReact.observer
class LineText extends React.Component<
    {
        screen: LineContainerModel;
        line: LineType;
        renderMode: RenderModeType;
        topBorder: boolean;
        noSelect?: boolean;
    },
    {}
> {
    @boundMethod
    clickHandler() {
        let { line, noSelect } = this.props;
        if (noSelect) {
            return;
        }
        GlobalCommandRunner.screenSelectLine(String(line.linenum));
    }

    @boundMethod
    onAvatarRightClick(e: any): void {
        let { line, noSelect } = this.props;
        if (noSelect) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (line != null) {
            mobx.action(() => {
                GlobalModel.lineSettingsModal.set(line.linenum);
            })();
        }
    }

    render() {
        let { screen, line, topBorder, renderMode } = this.props;
        let formattedTime = lineutil.getLineDateTimeStr(line.ts);
        let isSelected = mobx
            .computed(() => screen.getSelectedLine() == line.linenum, {
                name: "computed-isSelected",
            })
            .get();
        let isFocused = mobx
            .computed(() => screen.getFocusType() == "cmd", {
                name: "computed-isFocused",
            })
            .get();
        let mainClass = cn("line", "line-text", "focus-parent", {
            "top-border": topBorder,
        });
        return (
            <div
                className={mainClass}
                data-lineid={line.lineid}
                data-linenum={line.linenum}
                data-screenid={line.screenid}
                onClick={this.clickHandler}
            >
                <div className={cn("focus-indicator", { selected: isSelected }, { active: isSelected && isFocused })} />
                <div className="line-content">
                    <div className="meta">
                        <SmallLineAvatar line={line} cmd={null} onRightClick={this.onAvatarRightClick} />
                        <div className="ts">{formattedTime}</div>
                    </div>
                    <div className="text">{line.text}</div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class TerminalRenderer extends React.Component<
    {
        screen: LineContainerModel;
        line: LineType;
        width: number;
        staticRender: boolean;
        visible: OV<boolean>;
        onHeightChange: () => void;
        collapsed: boolean;
    },
    {}
> {
    termLoaded: mobx.IObservableValue<boolean> = mobx.observable.box(false, {
        name: "linecmd-term-loaded",
    });
    elemRef: React.RefObject<any> = React.createRef();
    termRef: React.RefObject<any> = React.createRef();

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

    getSnapshotBeforeUpdate(prevProps, prevState): { height: number } {
        let elem = this.elemRef.current;
        if (elem == null) {
            return { height: 0 };
        }
        return { height: elem.offsetHeight };
    }

    componentDidUpdate(prevProps, prevState, snapshot: { height: number }): void {
        if (this.props.onHeightChange == null) {
            return;
        }
        let { line } = this.props;
        let curHeight = 0;
        let elem = this.elemRef.current;
        if (elem != null) {
            curHeight = elem.offsetHeight;
        }
        if (snapshot == null) {
            snapshot = { height: 0 };
        }
        if (snapshot.height != curHeight) {
            this.props.onHeightChange();
            // console.log("term-render height change: ", line.linenum, snapshot.height, "=>", curHeight);
        }
        this.checkLoad();
    }

    checkLoad(): void {
        let { line, staticRender, visible, collapsed } = this.props;
        if (staticRender) {
            return;
        }
        let vis = visible && visible.get() && !collapsed;
        let curVis = this.termLoaded.get();
        if (vis && !curVis) {
            this.loadTerminal();
        } else if (!vis && curVis) {
            this.unloadTerminal(false);
        }
    }

    loadTerminal(): void {
        let { screen, line } = this.props;
        let model = GlobalModel;
        let cmd = screen.getCmd(line);
        if (cmd == null) {
            return;
        }
        let termElem = this.termRef.current;
        if (termElem == null) {
            console.log("cannot load terminal, no term elem found", line);
            return;
        }
        screen.loadTerminalRenderer(termElem, line, cmd, this.props.width);
        mobx.action(() => this.termLoaded.set(true))();
    }

    unloadTerminal(unmount: boolean): void {
        let { screen, line } = this.props;
        screen.unloadRenderer(line.lineid);
        if (!unmount) {
            mobx.action(() => this.termLoaded.set(false))();
            let termElem = this.termRef.current;
            if (termElem != null) {
                termElem.replaceChildren();
            }
        }
    }

    @boundMethod
    clickTermBlock(e: any) {
        let { screen, line } = this.props;
        let model = GlobalModel;
        let termWrap = screen.getTermWrap(line.lineid);
        if (termWrap != null) {
            termWrap.giveFocus();
        }
    }

    render() {
        let { screen, line, width, staticRender, visible, collapsed } = this.props;
        let isVisible = visible.get(); // for reaction
        let isPhysicalFocused = mobx
            .computed(() => screen.getIsFocused(line.linenum), {
                name: "computed-getIsFocused",
            })
            .get();
        let isFocused = mobx
            .computed(
                () => {
                    let screenFocusType = screen.getFocusType();
                    return isPhysicalFocused && screenFocusType == "cmd";
                },
                { name: "computed-isFocused" }
            )
            .get();
        let cmd = screen.getCmd(line); // will not be null
        let usedRows = screen.getUsedRows(lineutil.getRendererContext(line), line, cmd, width);
        let termHeight = termHeightFromRows(usedRows, GlobalModel.termFontSize.get());
        let termLoaded = this.termLoaded.get();
        return (
            <div
                ref={this.elemRef}
                key="term-wrap"
                className={cn(
                    "terminal-wrapper",
                    { focus: isFocused },
                    { "cmd-done": !cmd.isRunning() },
                    { "zero-height": termHeight == 0 },
                    { collapsed: collapsed }
                )}
            >
                <If condition={!isFocused}>
                    <div key="term-block" className="term-block" onClick={this.clickTermBlock}></div>
                </If>
                <div
                    key="term-connectelem"
                    className="terminal-connectelem"
                    ref={this.termRef}
                    data-lineid={line.lineid}
                    style={{ height: termHeight }}
                ></div>
                <If condition={!termLoaded}>
                    <div key="term-loading" className="terminal-loading-message">
                        ...
                    </div>
                </If>
            </div>
        );
    }
}

export { Line, Prompt };
