// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { If } from "tsx-control-statements/components";
import { GlobalModel, GlobalCommandRunner, Cmd } from "@/models";
import { termHeightFromRows } from "@/util/textmeasure";
import cn from "classnames";
import { getTermPtyData } from "@/util/modelutil";

import { renderCmdText } from "@/common/elements";
import { SimpleBlobRenderer } from "@/plugins/core/basicrenderer";
import { IncrementalRenderer } from "@/plugins/core/incrementalrenderer";
import { TerminalRenderer } from "@/plugins/terminal/terminal";
import { isBlank } from "@/util/util";
import { PluginModel } from "@/plugins/plugins";
import { Prompt } from "@/common/prompt/prompt";
import * as lineutil from "./lineutil";
import { ErrorBoundary } from "@/common/error/errorboundary";
import * as appconst from "@/app/appconst";
import * as util from "@/util/util";

import "./line.less";

dayjs.extend(localizedFormat);

function cmdHasError(cmd: Cmd): boolean {
    return cmd.getStatus() == "error" || cmd.getExitCode() != 0;
}

function getIsHidePrompt(line: LineType): boolean {
    let rendererPlugin: RendererPluginType = null;
    const isNoneRenderer = line.renderer == "none";
    if (!isBlank(line.renderer) && line.renderer != "terminal" && !isNoneRenderer) {
        rendererPlugin = PluginModel.getRendererPluginByName(line.renderer);
    }
    const hidePrompt = rendererPlugin?.hidePrompt;
    return hidePrompt;
}

@mobxReact.observer
class LineActions extends React.Component<{ screen: LineContainerType; line: LineType; cmd: Cmd }, {}> {
    @boundMethod
    clickStar() {
        const { line } = this.props;
        if (!line.star || line.star == 0) {
            GlobalCommandRunner.lineStar(line.lineid, 1);
        } else {
            GlobalCommandRunner.lineStar(line.lineid, 0);
        }
    }

    @boundMethod
    clickPin() {
        const { line } = this.props;
        if (!line.pinned) {
            GlobalCommandRunner.linePin(line.lineid, true);
        } else {
            GlobalCommandRunner.linePin(line.lineid, false);
        }
    }

    @boundMethod
    clickBookmark() {
        const { line } = this.props;
        GlobalCommandRunner.lineBookmark(line.lineid);
    }

    @boundMethod
    clickDelete() {
        const { line } = this.props;
        GlobalCommandRunner.lineDelete(line.lineid, true);
    }

    @boundMethod
    clickRestart() {
        const { line } = this.props;
        GlobalCommandRunner.lineRestart(line.lineid, true);
    }

    @boundMethod
    clickMinimize() {
        const { line } = this.props;
        const isMinimized = line.linestate["wave:min"];
        GlobalCommandRunner.lineMinimize(line.lineid, !isMinimized, true);
    }

    @boundMethod
    clickMoveToSidebar() {
        const { line } = this.props;
        GlobalCommandRunner.screenSidebarAddLine(line.lineid);
    }

    @boundMethod
    clickRemoveFromSidebar() {
        GlobalCommandRunner.screenSidebarRemove();
    }

    @boundMethod
    handleResizeButton() {
        console.log("resize button");
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
            GlobalModel.modalsModel.pushModal(appconst.LINE_SETTINGS);
        }
    }

    render() {
        let { line, screen } = this.props;
        const isMinimized = line.linestate["wave:min"];
        const containerType = screen.getContainerType();
        return (
            <div className="line-actions">
                <div key="restart" title="Restart Command" className="line-icon" onClick={this.clickRestart}>
                    <i className="fa-sharp fa-regular fa-arrows-rotate fa-fw" />
                </div>
                <div key="delete" title="Delete Line (&#x2318;D)" className="line-icon" onClick={this.clickDelete}>
                    <i className="fa-sharp fa-regular fa-trash fa-fw" />
                </div>
                <div
                    key="bookmark"
                    title="Bookmark"
                    className={cn("line-icon", "line-bookmark")}
                    onClick={this.clickBookmark}
                >
                    <i className="fa-sharp fa-regular fa-bookmark fa-fw" />
                </div>
                <If condition={containerType == appconst.LineContainer_Main}>
                    <div
                        key="minimize"
                        title={`${isMinimized ? "Show Output" : "Hide Output"}`}
                        className={cn("line-icon", isMinimized ? "active" : "")}
                        onClick={this.clickMinimize}
                    >
                        <If condition={isMinimized}>
                            <i className="fa-sharp fa-regular fa-circle-plus fa-fw" />
                        </If>
                        <If condition={!isMinimized}>
                            <i className="fa-sharp fa-regular fa-circle-minus fa-fw" />
                        </If>
                    </div>
                    <div className="line-icon line-sidebar" onClick={this.clickMoveToSidebar} title="Move to Sidebar">
                        <i className="fa-sharp fa-solid fa-right-to-line fa-fw" />
                    </div>
                    <div
                        key="settings"
                        title="Line Settings"
                        className="line-icon line-icon-shrink-left"
                        onClick={this.handleLineSettings}
                    >
                        <i className="fa-sharp fa-regular fa-ellipsis-vertical fa-fw" />
                    </div>
                </If>
                <If condition={containerType == appconst.LineContainer_Sidebar}>
                    <div
                        className="line-icon line-sidebar"
                        onClick={this.clickRemoveFromSidebar}
                        title="Move to Sidebar"
                    >
                        <i className="fa-sharp fa-solid fa-left-to-line fa-fw" />
                    </div>
                </If>
            </div>
        );
    }
}

@mobxReact.observer
class LineHeader extends React.Component<{ screen: LineContainerType; line: LineType; cmd: Cmd }, {}> {
    cmdTextRef: React.RefObject<any> = React.createRef();
    isCmdExpanded: OV<boolean> = mobx.observable.box(false, {
        name: "cmd-expanded",
    });
    isOverflow: OV<boolean> = mobx.observable.box(false, {
        name: "line-overflow",
    });

    componentDidMount() {
        this.componentDidUpdate(null, null, null);
        this.checkCmdText();
    }

    componentDidUpdate(prevProps, prevState, snapshot: { height: number }): void {
        this.checkCmdText();
    }

    @boundMethod
    handleExpandCmd(): void {
        mobx.action(() => {
            this.isCmdExpanded.set(true);
        })();
    }

    checkCmdText() {
        const metaElem = this.cmdTextRef.current;
        if (metaElem == null || metaElem.childNodes.length == 0) {
            return;
        }
        const metaElemWidth = metaElem.offsetWidth;
        if (metaElemWidth == 0) {
            return;
        }
        const metaChild = metaElem.firstChild;
        if (metaChild == null) {
            return;
        }
        const children = metaChild.childNodes;
        let childWidth = 0;
        for (let i = 0; i < children.length; i++) {
            let ch = children[i];
            childWidth += ch.offsetWidth;
        }
        const isOverflow = childWidth > metaElemWidth;
        if (isOverflow && isOverflow != this.isOverflow.get()) {
            mobx.action(() => {
                this.isOverflow.set(isOverflow);
            })();
        }
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
                            <Prompt rptr={cmd.remote} festate={cmd.getRemoteFeState()} color={true} />
                        </div>
                    </div>
                    <div key="meta3" className="meta meta-line3 cmdtext-expanded-wrapper">
                        <div className="cmdtext-expanded">{lineutil.getFullCmdText(cmd.getCmdStr())}</div>
                    </div>
                </React.Fragment>
            );
        }
        const isMultiLine = lineutil.isMultiLineCmdText(cmd.getCmdStr());
        return (
            <div key="meta2" className="meta meta-line2" ref={this.cmdTextRef}>
                <div className="metapart-mono cmdtext">
                    <span className="meta-cmdtext">{lineutil.getSingleLineCmdText(cmd.getCmdStr())}</span>
                </div>
                <If condition={this.isOverflow.get() || isMultiLine}>
                    <div className="cmdtext-overflow" onClick={this.handleExpandCmd}>
                        ...&#x25BC;
                    </div>
                </If>
            </div>
        );
    }

    renderMeta1(cmd: Cmd) {
        let { line } = this.props;
        let formattedTime: string = "";
        let restartTs = cmd.getRestartTs();
        let timeTitle: string = null;
        if (restartTs != null && restartTs > 0) {
            formattedTime = "restarted @ " + lineutil.getLineDateTimeStr(restartTs);
            timeTitle = "original start time " + lineutil.getLineDateTimeStr(line.ts);
        } else {
            formattedTime = lineutil.getLineDateTimeStr(line.ts);
        }
        let renderer = line.renderer;
        let durationMs = cmd.getDurationMs();
        return (
            <div key="meta1" className="meta meta-line1">
                <SmallLineAvatar line={line} cmd={cmd} />
                <div className="meta-divider">|</div>
                <Prompt rptr={cmd.remote} festate={cmd.getRemoteFeState()} color={false} />
                <div className="meta-divider">|</div>
                <div title={timeTitle} className="ts">
                    {formattedTime} <If condition={durationMs > 0}>({util.formatDuration(durationMs)})</If>
                </div>
                <If condition={!isBlank(renderer) && renderer != "terminal"}>
                    <div className="meta-divider">|</div>
                    <div className="renderer">
                        <i className="fa-sharp fa-solid fa-fill" />
                        {renderer}
                    </div>
                </If>
            </div>
        );
    }

    render() {
        let { line, cmd } = this.props;
        const isExpanded = this.isCmdExpanded.get();
        const hidePrompt = getIsHidePrompt(line);
        return (
            <div
                key="header"
                className={cn("line-header", { "is-expanded": isExpanded }, { "hide-prompt": hidePrompt })}
            >
                {this.renderMeta1(cmd)}
                <If condition={!hidePrompt}>{this.renderCmdText(cmd)}</If>
            </div>
        );
    }
}

@mobxReact.observer
class SmallLineAvatar extends React.Component<{ line: LineType; cmd: Cmd; onRightClick?: (e: any) => void }, {}> {
    render() {
        const { line, cmd } = this.props;
        const lineNumStr = (line.linenumtemp ? "~" : "#") + String(line.linenum);
        let status = cmd != null ? cmd.getStatus() : "done";
        const exitcode = cmd != null ? cmd.getExitCode() : 0;
        const isComment = line.linetype == "text";
        let icon = null;
        let iconTitle = null;
        if (isComment) {
            icon = <i className="fa-sharp fa-solid fa-comment" />;
            iconTitle = "comment";
        } else if (status == "done") {
            if (exitcode === 0) {
                icon = <i className="success fa-sharp fa-solid fa-check" />;
                iconTitle = "success";
            } else {
                icon = <i className="fail fa-sharp fa-solid fa-xmark" />;
                iconTitle = "exitcode " + exitcode;
            }
        } else if (status == "hangup") {
            icon = <i className="warning fa-sharp fa-solid fa-triangle-exclamation" />;
            iconTitle = status;
        } else if (status == "error") {
            icon = <i className="fail fa-sharp fa-solid fa-xmark" />;
            iconTitle = "error";
        } else if (status == "running" || status == "detached") {
            icon = <i className="warning fa-sharp fa-solid fa-rotate fa-spin" />;
            iconTitle = "running";
        } else {
            icon = <i className="fail fa-sharp fa-solid fa-question" />;
            iconTitle = "unknown";
        }
        return (
            <div
                onContextMenu={this.props.onRightClick}
                title={iconTitle}
                className={cn("simple-line-status", "status-" + status)}
            >
                <span className="linenum">{lineNumStr}</span>
                <div className="avatar">{icon}</div>
            </div>
        );
    }
}

@mobxReact.observer
class RtnState extends React.Component<{ cmd: Cmd; line: LineType }> {
    rtnStateDiff: mobx.IObservableValue<string> = mobx.observable.box(null, {
        name: "linecmd-rtn-state-diff",
    });
    rtnStateDiffFetched: boolean = false;

    componentDidMount() {
        this.componentDidUpdate();
    }

    componentDidUpdate() {
        this.checkStateDiffLoad();
    }

    checkStateDiffLoad(): void {
        let cmd = this.props.cmd;
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
        const { line } = this.props;
        this.rtnStateDiffFetched = true;
        const usp = new URLSearchParams({
            linenum: String(line.linenum),
            screenid: line.screenid,
            lineid: line.lineid,
        });
        const url = GlobalModel.getBaseHostPort() + "/api/rtnstate?" + usp.toString();
        const fetchHeaders = GlobalModel.getFetchHeaders();
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

    render() {
        let { cmd } = this.props;
        const rsdiff = this.rtnStateDiff.get();
        const termFontSize = GlobalModel.getTermFontSize();
        let rtnStateDiffSize = termFontSize - 2;
        if (rtnStateDiffSize < 10) {
            rtnStateDiffSize = Math.max(termFontSize, 10);
        }
        return (
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
                    <div className="cmd-rtnstate-diff" style={{ fontSize: rtnStateDiffSize }}>
                        <div className="cmd-rtnstate-diff-inner">{this.rtnStateDiff.get()}</div>
                    </div>
                </If>
            </div>
        );
    }
}

@mobxReact.observer
class LineCmd extends React.Component<
    {
        screen: LineContainerType;
        line: LineType;
        width: number;
        staticRender: boolean;
        visible: OV<boolean>;
        onHeightChange: LineHeightChangeCallbackType;
        renderMode: RenderModeType;
        overrideCollapsed: OV<boolean>;
        noSelect?: boolean;
        showHints?: boolean;
    },
    {}
> {
    lineRef: React.RefObject<any> = React.createRef();
    lastHeight: number;

    constructor(props) {
        super(props);
    }

    componentDidMount() {
        this.componentDidUpdate(null, null, null);
    }

    // TODO: this might not be necessary anymore because we're using this.lastHeight
    getSnapshotBeforeUpdate(prevProps, prevState): { height: number } {
        const elem = this.lineRef.current;
        if (elem == null) {
            return { height: 0 };
        }
        return { height: elem.offsetHeight };
    }

    componentDidUpdate(prevProps, prevState, snapshot: { height: number }): void {
        this.handleHeightChange();
    }

    @boundMethod
    handleHeightChange() {
        if (this.props.onHeightChange == null) {
            return;
        }
        const { line } = this.props;
        let curHeight = 0;
        const elem = this.lineRef.current;
        if (elem != null) {
            curHeight = elem.offsetHeight;
        }
        if (this.lastHeight == curHeight) {
            return;
        }
        const lastHeight = this.lastHeight;
        this.lastHeight = curHeight;
        this.props.onHeightChange(line.linenum, curHeight, lastHeight);
        // console.log("line height change: ", line.linenum, lastHeight, "=>", curHeight);
    }

    @boundMethod
    handleClick() {
        const { line, noSelect } = this.props;
        if (noSelect) {
            return;
        }
        const sel = window.getSelection();
        if (this.lineRef.current != null) {
            const selText = sel.toString();
            if (sel.anchorNode != null && this.lineRef.current.contains(sel.anchorNode) && !isBlank(selText)) {
                return;
            }
        }
        GlobalCommandRunner.screenSelectLine(String(line.linenum), "cmd");
    }

    getTerminalRendererHeight(cmd: Cmd): number {
        const { screen, line, width } = this.props;
        let height = 45 + 24; // height of zero height terminal
        const usedRows = screen.getUsedRows(lineutil.getRendererContext(line), line, cmd, width);
        if (usedRows > 0) {
            height = 48 + 24 + termHeightFromRows(usedRows, GlobalModel.getTermFontSize(), cmd.getTermMaxRows());
        }
        return height;
    }

    @boundMethod
    onAvatarRightClick(e: any): void {
        const { line, noSelect } = this.props;
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
        const { screen, line } = this.props;
        const cmd = screen.getCmd(line);
        let height: number = 0;
        if (isBlank(line.renderer) || line.renderer == "terminal") {
            height = this.getTerminalRendererHeight(cmd);
        } else {
            // header is 16px tall with hide-prompt, 36px otherwise
            const { screen, line, width } = this.props;
            const hidePrompt = getIsHidePrompt(line);
            const usedRows = screen.getUsedRows(lineutil.getRendererContext(line), line, cmd, width);
            height = (hidePrompt ? 16 + 6 : 36 + 6) + usedRows;
        }
        const formattedTime = lineutil.getLineDateTimeStr(line.ts);
        const mainDivCn = cn("line", "line-cmd", "line-simple");
        return (
            <div
                className={mainDivCn}
                ref={this.lineRef}
                data-lineid={line.lineid}
                data-linenum={line.linenum}
                data-screenid={line.screenid}
                style={{ height: height }}
            >
                <div className="simple-line-header">
                    <SmallLineAvatar line={line} cmd={cmd} />
                    <div className="ts">{formattedTime}</div>
                </div>
            </div>
        );
    }

    getRendererOpts(cmd: Cmd): RendererOpts {
        const { screen } = this.props;
        return {
            maxSize: screen.getMaxContentSize(),
            idealSize: screen.getIdealContentSize(),
            termOpts: cmd.getTermOpts(),
            termFontSize: GlobalModel.getTermFontSize(),
            termFontFamily: GlobalModel.getTermFontFamily(),
        };
    }

    makeRendererModelInitializeParams(): RendererModelInitializeParams {
        const { screen, line } = this.props;
        const context = lineutil.getRendererContext(line);
        const cmd = screen.getCmd(line); // won't be null
        let savedHeight = screen.getContentHeight(context);
        if (savedHeight == null) {
            if (line.contentheight != null && line.contentheight != -1) {
                savedHeight = line.contentheight;
            } else {
                savedHeight = 0;
            }
        }
        const api = {
            saveHeight: (height: number) => {
                screen.setContentHeight(lineutil.getRendererContext(line), height);
            },
            onFocusChanged: (focus: boolean) => {
                screen.setLineFocus(line.linenum, focus);
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

    scrollToBringIntoViewport = (delay = 1) => {
        const container = document.getElementsByClassName("lines")[0];
        const targetDiv = this.lineRef.current;
        const targetPosition = targetDiv.getBoundingClientRect();
        const containerPosition = container.getBoundingClientRect();

        setTimeout(() => doScroll(), delay);
        const doScroll = () => {
            // Check if the top of the targetDiv is above the container's visible area
            if (targetPosition.top < containerPosition.top) {
                // Scroll up to make the top of the targetDiv visible
                const scrollAmount = container.scrollTop + targetPosition.top - containerPosition.top;
                container.scrollTo({
                    top: scrollAmount,
                    behavior: "smooth",
                });
            }
            // Check if the bottom of the targetDiv is below the container's visible area
            else if (targetPosition.bottom > containerPosition.bottom) {
                // Scroll down to make the bottom of the targetDiv visible
                const scrollAmount = container.scrollTop + targetPosition.bottom - containerPosition.bottom;
                container.scrollTo({
                    top: scrollAmount,
                    behavior: "smooth",
                });
            }
            // If both conditions are false, then targetDiv is already fully visible, no scrolling needed
        };
    };

    render() {
        const { screen, line, width, staticRender, visible } = this.props;
        const isVisible = visible.get();
        if (staticRender || !isVisible) {
            return this.renderSimple();
        }
        const cmd = screen.getCmd(line);
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
        const isRtnState = cmd.getRtnState() && false; // turning off rtnstate for now
        const isSelected = mobx
            .computed(() => screen.getSelectedLine() == line.linenum, {
                name: "computed-isSelected",
            })
            .get();
        const isPhysicalFocused = mobx
            .computed(() => screen.getIsFocused(line.linenum), {
                name: "computed-getIsFocused",
            })
            .get();
        const isFocused = mobx
            .computed(
                () => {
                    let screenFocusType = screen.getFocusType();
                    return isPhysicalFocused && screenFocusType == "cmd";
                },
                { name: "computed-isFocused" }
            )
            .get();
        const shouldCmdFocus = mobx
            .computed(
                () => {
                    let screenFocusType = screen.getFocusType();
                    return isSelected && screenFocusType == "cmd";
                },
                { name: "computed-shouldCmdFocus" }
            )
            .get();
        const isInSidebar = mobx
            .computed(
                () => {
                    return screen.isSidebarOpen() && screen.isLineIdInSidebar(line.lineid);
                },
                { name: "computed-isInSidebar" }
            )
            .get();
        const isRunning = cmd.isRunning();
        const cmdError = cmdHasError(cmd);
        const mainDivCn = cn(
            "line",
            "line-cmd",
            { selected: isSelected },
            { active: isSelected && isFocused },
            { "cmd-done": !isRunning },
            { "has-rtnstate": isRtnState },
            { "has-error": cmdError }
        );
        let rendererPlugin: RendererPluginType = null;
        const isNoneRenderer = line.renderer == "none";
        if (!isBlank(line.renderer) && line.renderer != "terminal" && !isNoneRenderer) {
            rendererPlugin = PluginModel.getRendererPluginByName(line.renderer);
        }
        const rendererType = lineutil.getRendererType(line);
        const hidePrompt = rendererPlugin?.hidePrompt;
        const termFontSize = GlobalModel.getTermFontSize();
        const containerType = screen.getContainerType();
        const isMinimized = line.linestate["wave:min"] && containerType == appconst.LineContainer_Main;
        return (
            <div
                className={mainDivCn}
                ref={this.lineRef}
                onClick={this.handleClick}
                data-lineid={line.lineid}
                data-linenum={line.linenum}
                data-screenid={line.screenid}
            >
                <If condition={isSelected || cmdError}>
                    <div key="mask" className={cn("line-mask", { "error-mask": cmdError })}></div>
                </If>
                <LineActions screen={screen} line={line} cmd={cmd} />
                <LineHeader screen={screen} line={line} cmd={cmd} />
                <If condition={!isMinimized && isInSidebar}>
                    <div className="sidebar-message" style={{ fontSize: termFontSize }}>
                        &nbsp;&nbsp;showing in sidebar =&gt;
                    </div>
                </If>
                <If condition={!isMinimized && !isInSidebar}>
                    <ErrorBoundary plugin={rendererPlugin?.name} lineContext={lineutil.getRendererContext(line)}>
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
                                scrollToBringIntoViewport={this.scrollToBringIntoViewport}
                                isSelected={isSelected}
                                shouldFocus={shouldCmdFocus}
                            />
                        </If>
                        <If condition={rendererPlugin != null && rendererPlugin.rendererType == "full"}>
                            <IncrementalRenderer
                                rendererContainer={screen}
                                lineId={line.lineid}
                                plugin={rendererPlugin}
                                onHeightChange={this.handleHeightChange}
                                initParams={this.makeRendererModelInitializeParams()}
                                isSelected={isSelected}
                            />
                        </If>
                    </ErrorBoundary>
                    <If condition={isRtnState}>
                        <RtnState cmd={cmd} line={line} />
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
        screen: LineContainerType;
        line: LineType;
        width: number;
        staticRender: boolean;
        visible: OV<boolean>;
        onHeightChange: LineHeightChangeCallbackType;
        overrideCollapsed: OV<boolean>;
        renderMode: RenderModeType;
        noSelect?: boolean;
        topBorder: boolean;
    },
    {}
> {
    render() {
        const line = this.props.line;
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
class LineText extends React.Component<
    {
        screen: LineContainerType;
        line: LineType;
        renderMode: RenderModeType;
        noSelect?: boolean;
    },
    {}
> {
    @boundMethod
    clickHandler() {
        const { line, noSelect } = this.props;
        if (noSelect) {
            return;
        }
        GlobalCommandRunner.screenSelectLine(String(line.linenum));
    }

    @boundMethod
    onAvatarRightClick(e: any): void {
        const { line, noSelect } = this.props;
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
        const { screen, line } = this.props;
        const formattedTime = lineutil.getLineDateTimeStr(line.ts);
        const isSelected = mobx
            .computed(() => screen.getSelectedLine() == line.linenum, {
                name: "computed-isSelected",
            })
            .get();
        const isFocused = mobx
            .computed(() => screen.getFocusType() == "cmd", {
                name: "computed-isFocused",
            })
            .get();
        const mainClass = cn("line", "line-text", "focus-parent");
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

export { Line };
