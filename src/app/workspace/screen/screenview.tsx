// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import { debounce } from "throttle-debounce";
import dayjs from "dayjs";
import { GlobalCommandRunner, TabColors, TabIcons } from "../../../model/model";
import type { LineType, RenderModeType, LineFactoryProps, CommandRtnType } from "../../../types/types";
import * as T from "../../../types/types";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { InlineSettingsTextEdit, RemoteStatusLight } from "../../common/common";
import { getRemoteStr } from "../../common/prompt/prompt";
import { GlobalModel, ScreenLines, Screen, Session } from "../../../model/model";
import { Line } from "../../line/linecomps";
import { LinesView } from "../../line/linesview";
import { ConnectionDropdown } from "../../connections_deprecated/connections";
import * as util from "../../../util/util";
import { TextField, InputDecoration } from "../../common/common";
import { ReactComponent as EllipseIcon } from "../../assets/icons/ellipse.svg";
import { ReactComponent as Check12Icon } from "../../assets/icons/check12.svg";
import { ReactComponent as GlobeIcon } from "../../assets/icons/globe.svg";
import { ReactComponent as StatusCircleIcon } from "../../assets/icons/statuscircle.svg";
import { ReactComponent as ArrowsUpDownIcon } from "../../assets/icons/arrowsupdown.svg";
import { ReactComponent as CircleIcon } from "../../assets/icons/circle.svg";
import { ReactComponent as AddIcon } from "../../assets/icons/add.svg";
import { ReactComponent as SquareIcon } from "../../assets/icons/tab/square.svg";

import "./screenview.less";
import "./tabs.less";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class ScreenView extends React.Component<{ session: Session; screen: Screen }, {}> {
    render() {
        let { session, screen } = this.props;
        if (screen == null) {
            return <div className="screen-view">(no screen found)</div>;
        }
        let fontSize = GlobalModel.termFontSize.get();
        return (
            <div className="screen-view" data-screenid={screen.screenId}>
                <ScreenWindowView key={screen.screenId + ":" + fontSize} session={session} screen={screen} />
            </div>
        );
    }
}

@mobxReact.observer
class NewTabSettings extends React.Component<{ screen: Screen }, {}> {
    connDropdownActive: OV<boolean> = mobx.observable.box(false, { name: "NewTabSettings-connDropdownActive" });
    errorMessage: OV<string | null> = mobx.observable.box(null, { name: "NewTabSettings-errorMessage" });

    @boundMethod
    selectTabColor(color: string): void {
        let { screen } = this.props;
        if (screen.getTabColor() == color) {
            return;
        }
        let prtn = GlobalCommandRunner.screenSetSettings(screen.screenId, { tabcolor: color }, false);
        util.commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    selectTabIcon(icon: string): void {
        let { screen } = this.props;
        if (screen.getTabIcon() == icon) {
            return;
        }
        let prtn = GlobalCommandRunner.screenSetSettings(screen.screenId, { tabicon: icon }, false);
        util.commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    updateName(val: string): void {
        let { screen } = this.props;
        let prtn = GlobalCommandRunner.screenSetSettings(screen.screenId, { name: val }, false);
        util.commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    toggleConnDropdown(): void {
        mobx.action(() => {
            this.connDropdownActive.set(!this.connDropdownActive.get());
        })();
    }

    @boundMethod
    selectRemote(cname: string): void {
        let prtn = GlobalCommandRunner.screenSetRemote(cname, true, false);
        util.commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    clickNewConnection(): void {
        GlobalModel.remotesModalModel.openModalForEdit({ remoteedit: true, old: false }, true);
    }

    renderTabIconSelector(): React.ReactNode {
        let { screen } = this.props;
        let curIcon = screen.getTabIcon();
        if (util.isBlank(curIcon) || curIcon == "default") {
            curIcon = "square";
        }
        let icon: string | null = null;

        return (
            <>
                <div className="text-s1 unselectable">Select the icon</div>
                <div className="control-iconlist tabicon-list">
                    <div key="square" className="icondiv" title="square" onClick={() => this.selectTabIcon("square")}>
                        <SquareIcon className="icon square-icon" />
                    </div>
                    <For each="icon" of={TabIcons}>
                        <div
                            className="icondiv tabicon"
                            key={icon}
                            title={icon || ""}
                            onClick={() => this.selectTabIcon(icon || "")}
                        >
                            <i className={`fa-sharp fa-solid fa-${icon}`}></i>
                        </div>
                    </For>
                </div>
            </>
        );
    }

    renderTabColorSelector(): React.ReactNode {
        let { screen } = this.props;
        let curColor = screen.getTabColor();
        if (util.isBlank(curColor) || curColor == "default") {
            curColor = "green";
        }
        let color: string | null = null;

        return (
            <>
                <div className="text-s1 unselectable">Select the color</div>
                <div className="control-iconlist">
                    <For each="color" of={TabColors}>
                        <div
                            className="icondiv"
                            key={color}
                            title={color || ""}
                            onClick={() => this.selectTabColor(color || "")}
                        >
                            <EllipseIcon className={cn("icon", "color-" + color)} />
                            <If condition={color == curColor}>
                                <Check12Icon className="check-icon" />
                            </If>
                        </div>
                    </For>
                </div>
            </>
        );
    }

    render() {
        let { screen } = this.props;
        let rptr = screen.curRemote.get();
        let curRemote = GlobalModel.getRemote(GlobalModel.getActiveScreen().getCurRemoteInstance().remoteid);
        return (
            <div className="newtab-container">
                <div className="newtab-section name-section">
                    <TextField
                        label="Name"
                        required={true}
                        defaultValue={screen.name.get() ?? ""}
                        onChange={this.updateName}
                    />
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section conn-section">
                    <div className="text-s1 unselectable">
                        You're connected to [{getRemoteStr(rptr)}]. Do you want to change it?
                    </div>
                    <div>
                        <ConnectionDropdown
                            curRemote={curRemote}
                            allowNewConn={true}
                            onSelectRemote={this.selectRemote}
                            onNewConn={this.clickNewConnection}
                        />
                    </div>
                    <div className="text-caption cr-help-text">
                        To change connection from the command line use `cr [alias|user@host]`
                    </div>
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section">
                    <div>{this.renderTabIconSelector()}</div>
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section">
                    <div>{this.renderTabColorSelector()}</div>
                </div>
            </div>
        );
    }
}

// screen is not null
@mobxReact.observer
class ScreenWindowView extends React.Component<{ session: Session; screen: Screen }, {}> {
    rszObs: any;
    windowViewRef: React.RefObject<any>;

    width: mobx.IObservableValue<number> = mobx.observable.box(0, { name: "sw-view-width" });
    height: mobx.IObservableValue<number> = mobx.observable.box(0, { name: "sw-view-height" });
    setSize_debounced: (width: number, height: number) => void;

    renderMode: OV<RenderModeType> = mobx.observable.box("normal", { name: "renderMode" });
    shareCopied: OV<boolean> = mobx.observable.box(false, { name: "sw-shareCopied" });

    constructor(props: any) {
        super(props);
        this.setSize_debounced = debounce(1000, this.setSize.bind(this));
        this.windowViewRef = React.createRef();
    }

    setSize(width: number, height: number): void {
        let { screen } = this.props;
        if (screen == null) {
            return;
        }
        if (width == null || height == null || width == 0 || height == 0) {
            return;
        }
        mobx.action(() => {
            this.width.set(width);
            this.height.set(height);
            screen.screenSizeCallback({ height: height, width: width });
        })();
    }

    componentDidMount() {
        let wvElem = this.windowViewRef.current;
        if (wvElem != null) {
            let width = wvElem.offsetWidth;
            let height = wvElem.offsetHeight;
            this.setSize(width, height);
            this.rszObs = new ResizeObserver(this.handleResize.bind(this));
            this.rszObs.observe(wvElem);
        }
    }

    componentWillUnmount() {
        if (this.rszObs) {
            this.rszObs.disconnect();
        }
    }

    handleResize(entries: any) {
        if (entries.length == 0) {
            return;
        }
        let entry = entries[0];
        let width = entry.target.offsetWidth;
        let height = entry.target.offsetHeight;
        mobx.action(() => {
            this.setSize_debounced(width, height);
        })();
    }

    getScreenLines(): ScreenLines {
        let { screen } = this.props;
        let win = GlobalModel.getScreenLinesById(screen.screenId);
        if (win == null) {
            win = GlobalModel.loadScreenLines(screen.screenId);
        }
        return win;
    }

    @boundMethod
    toggleRenderMode() {
        let renderMode = this.renderMode.get();
        mobx.action(() => {
            this.renderMode.set(renderMode == "normal" ? "collapsed" : "normal");
        })();
    }

    renderError(message: string, fade: boolean) {
        let { screen } = this.props;
        return (
            <div className="window-view" ref={this.windowViewRef} data-screenid={screen.screenId}>
                <div key="lines" className="lines"></div>
                <div key="window-empty" className={cn("window-empty", { "should-fade": fade })}>
                    <div className="text-standard">{message}</div>
                </div>
            </div>
        );
    }

    @boundMethod
    copyShareLink(): void {
        let { screen } = this.props;
        let shareLink = screen.getWebShareUrl();
        if (shareLink == null) {
            return;
        }
        navigator.clipboard.writeText(shareLink);
        mobx.action(() => {
            this.shareCopied.set(true);
        })();
        setTimeout(() => {
            mobx.action(() => {
                this.shareCopied.set(false);
            })();
        }, 600);
    }

    @boundMethod
    openScreenSettings(): void {
        let { screen } = this.props;
        mobx.action(() => {
            GlobalModel.screenSettingsModal.set({ sessionId: screen.sessionId, screenId: screen.screenId });
        })();
    }

    @boundMethod
    buildLineComponent(lineProps: LineFactoryProps): JSX.Element {
        let { screen } = this.props;
        let { line, ...restProps } = lineProps;
        let realLine: LineType = line as LineType;
        return <Line key={realLine.lineid} screen={screen} line={realLine} {...restProps} />;
    }

    render() {
        let { session, screen } = this.props;
        let win = this.getScreenLines();
        if (win == null || !win.loaded.get()) {
            return this.renderError("...", true);
        }
        if (win.loadError.get() != null) {
            return this.renderError(sprintf("(%s)", win.loadError.get()), false);
        }
        if (this.width.get() == 0) {
            return this.renderError("", false);
        }
        let cdata = GlobalModel.clientData.get();
        if (cdata == null) {
            return this.renderError("loading client data", true);
        }
        let isActive = screen.isActive();
        let lines = win.getNonArchivedLines();
        let renderMode = this.renderMode.get();
        return (
            <div className="window-view" ref={this.windowViewRef}>
                <div
                    key="rendermode-tag"
                    className={cn("rendermode-tag", { "is-active": isActive })}
                    style={{ display: "none" }}
                >
                    <div className="render-mode" onClick={this.toggleRenderMode}>
                        <If condition={renderMode == "normal"}>
                            <i title="collapse" className="fa-sharp fa-solid fa-arrows-to-line" />
                        </If>
                        <If condition={renderMode == "collapsed"}>
                            <i title="expand" className="fa-sharp fa-solid fa-arrows-from-line" />
                        </If>
                    </div>
                </div>
                <If condition={lines.length == 0}>
                    <If condition={screen.nextLineNum.get() == 1}>
                        <NewTabSettings screen={screen} />
                    </If>
                    <If condition={screen.nextLineNum.get() != 1}>
                        <div className="window-view" ref={this.windowViewRef} data-screenid={screen.screenId}>
                            <div key="lines" className="lines"></div>
                            <div key="window-empty" className={cn("window-empty")}>
                                <div>
                                    <code className="text-standard">
                                        [workspace="{session.name.get()}" screen="{screen.name.get()}"]
                                    </code>
                                </div>
                            </div>
                        </div>
                    </If>
                </If>
                <If condition={screen.isWebShared()}>
                    <div key="share-tag" className="share-tag">
                        <If condition={this.shareCopied.get()}>
                            <div className="copied-indicator" />
                        </If>
                        <div className="share-tag-title">
                            <i title="archived" className="fa-sharp fa-solid fa-share-nodes" /> web shared
                        </div>
                        <div className="share-tag-link">
                            <div className="button is-prompt-green is-outlined is-small" onClick={this.copyShareLink}>
                                <span>copy link</span>
                                <span className="icon">
                                    <i className="fa-sharp fa-solid fa-copy" />
                                </span>
                            </div>
                            <div
                                className="button is-prompt-green is-outlined is-small"
                                onClick={this.openScreenSettings}
                            >
                                <span>open settings</span>
                                <span className="icon">
                                    <i className="fa-sharp fa-solid fa-cog" />
                                </span>
                            </div>
                        </div>
                    </div>
                </If>
                <If condition={lines.length > 0}>
                    <LinesView
                        screen={screen}
                        width={this.width.get()}
                        lines={lines}
                        renderMode={renderMode}
                        lineFactory={this.buildLineComponent}
                    />
                </If>
            </div>
        );
    }
}

export { ScreenView };
