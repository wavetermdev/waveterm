import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { If } from "tsx-control-statements/components";
import { GlobalModel, GlobalCommandRunner, Cmd, getTermPtyData } from "../../model/model";
import { termHeightFromRows } from "../../util/textmeasure";
import type {
    LineType,
    RemoteType,
    RemotePtrType,
    RenderModeType,
    RendererOpts,
    RendererPluginType,
    LineHeightChangeCallbackType,
    RendererModelInitializeParams,
    RendererModel,
} from "../../types/types";
import cn from "classnames";

import { ReactComponent as FavouritesIcon } from "../assets/icons/favourites.svg";
import { ReactComponent as PinIcon } from "../assets/icons/pin.svg";
import { ReactComponent as PlusIcon } from "../assets/icons/plus.svg";
import { ReactComponent as MinusIcon } from "../assets/icons/minus.svg";

import type { LineContainerModel } from "../../model/model";
import { renderCmdText } from "../common/common";
import { SimpleBlobRenderer } from "../../plugins/core/basicrenderer";
import { IncrementalRenderer } from "../../plugins/core/incrementalrenderer";
import { TerminalRenderer } from "../../plugins/terminal/terminal";
import { isBlank } from "../../util/util";
import { PluginModel } from "../../plugins/plugins";
import { Prompt } from "../common/prompt/prompt";
import * as lineutil from "./lineutil";

import { ReactComponent as CheckIcon } from "../assets/icons/line/check.svg";
import { ReactComponent as CommentIcon } from "../assets/icons/line/comment.svg";
import { ReactComponent as QuestionIcon } from "../assets/icons/line/question.svg";
import { ReactComponent as RotateIcon } from "../assets/icons/line/rotate.svg";
import { ReactComponent as WarningIcon } from "../assets/icons/line/triangle-exclamation.svg";
import { ReactComponent as XmarkIcon } from "../assets/icons/line/xmark.svg";
import { ReactComponent as FillIcon } from "../assets/icons/line/fill.svg";
import { ReactComponent as GearIcon } from "../assets/icons/line/gear.svg";

import "./lines.less";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class SmallLineAvatar extends React.Component<{ line: LineType; cmd: Cmd; onRightClick?: (e: any) => void }, {}> {
    render() {
        let { line, cmd } = this.props;
        let lineNumStr = (line.linenumtemp ? "~" : "#") + String(line.linenum);
        let status = cmd != null ? cmd.getStatus() : "done";
        let rtnstate = cmd != null ? cmd.getRtnState() : false;
        let exitcode = cmd != null ? cmd.getExitCode() : 0;
        let isComment = line.linetype == "text";
        let icon = null;
        let iconTitle = null;
        if (isComment) {
            icon = <CommentIcon />;
            iconTitle = "comment";
        } else if (status == "done") {
            if (exitcode === 0) {
                icon = <CheckIcon className="success" />;
                iconTitle = "success";
            } else {
                icon = <XmarkIcon className="fail" />;
                iconTitle = "fail";
            }
        } else if (status == "hangup" || status == "error") {
            icon = <WarningIcon className="warning" />;
            iconTitle = status;
        } else if (status == "running" || "detached") {
            icon = <RotateIcon className="warning spin" />;
            iconTitle = "running";
        } else {
            icon = <QuestionIcon />;
            iconTitle = "unknown";
        }
        return (
            <div
                onContextMenu={this.props.onRightClick}
                title={iconTitle}
                className={cn("simple-line-status", "status-" + status, rtnstate ? "has-rtnstate" : null)}
            >
                <span className="linenum">{lineNumStr}</span>
                <div className="avatar">{icon}</div>
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
        mobx.action(() => {
            this.isMinimised.set(!this.isMinimised.get());
        })();
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
        let { screen, line, width, renderMode } = this.props;
        let height = 45 + 24; // height of zero height terminal
        let usedRows = screen.getUsedRows(lineutil.getRendererContext(line), line, cmd, width);
        if (usedRows > 0) {
            height = 48 + 24 + termHeightFromRows(usedRows, GlobalModel.termFontSize.get());
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
        let { screen, line } = this.props;
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
        let mainDivCn = cn("line", "line-cmd", "line-simple");
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
                        <FillIcon />
                        {renderer}&nbsp;
                    </div>
                </If>
                <div className="termopts">
                    ({termOpts.rows}x{termOpts.cols})
                </div>
                <div className="settings hoverEffect" onClick={this.handleLineSettings}>
                    <GearIcon />
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
        let { screen, line, width, staticRender, visible } = this.props;
        let isVisible = visible.get();
        if (staticRender || !isVisible) {
            return this.renderSimple();
        }
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
        let shouldCmdFocus = mobx
            .computed(
                () => {
                    let screenFocusType = screen.getFocusType();
                    return isSelected && screenFocusType == "cmd";
                },
                { name: "computed-shouldCmdFocus" }
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
            { selected: isSelected },
            { active: isSelected && isFocused },
            { "cmd-done": !isRunning },
            { "has-rtnstate": cmd.getRtnState() }
        );
        let rendererPlugin: RendererPluginType = null;
        let isNoneRenderer = line.renderer == "none";
        if (!isBlank(line.renderer) && line.renderer != "terminal" && !isNoneRenderer) {
            rendererPlugin = PluginModel.getRendererPluginByName(line.renderer);
        }
        let rendererType = lineutil.getRendererType(line);
        let hidePrompt = rendererPlugin != null && rendererPlugin.hidePrompt;
        let termFontSize = GlobalModel.termFontSize.get();
        let rtnStateDiffSize = termFontSize - 2;
        if (rtnStateDiffSize < 10) {
            rtnStateDiffSize = Math.max(termFontSize, 10);
        }
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
                        <PinIcon className="icon" />
                    </div>
                    <div
                        key="bookmark"
                        title="Bookmark"
                        className={cn("line-icon", "line-bookmark", "hoverEffect")}
                        onClick={this.clickBookmark}
                    >
                        <FavouritesIcon className="icon" />
                    </div>
                    <div
                        key="minimise"
                        title={`${this.isMinimised.get() ? "Maximise" : "Minimise"}`}
                        className={cn(
                            "line-icon",
                            "line-minimise",
                            "hoverEffect",
                            this.isMinimised.get() ? "line-icon-show" : ""
                        )}
                        onClick={this.clickMinimise}
                    >
                        {this.isMinimised.get() ? <PlusIcon className="icon plus" /> : <MinusIcon className="icon" />}
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
                                <div className="cmd-rtnstate-diff" style={{fontSize: rtnStateDiffSize}}>{this.rtnStateDiff.get()}</div>
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
class LineText extends React.Component<
    {
        screen: LineContainerModel;
        line: LineType;
        renderMode: RenderModeType;
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
        let { screen, line, renderMode } = this.props;
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
        let mainClass = cn("line", "line-text", "focus-parent");
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
