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
import { GlobalCommandRunner, TabColors } from "../../../model/model";
import type { LineType, RenderModeType, LineFactoryProps, CommandRtnType } from "../../../types/types";
import * as T from "../../../types/types";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { InlineSettingsTextEdit, RemoteStatusLight } from "../../common/common";
import { getRemoteStr } from "../../common/prompt/prompt";
import { GlobalModel, ScreenLines, Screen } from "../../../model/model";
import { Line } from "../../line/linecomps";
import { LinesView } from "../../line/linesview";
import * as util from  "../../../util/util";
import { ReactComponent as EllipseIcon } from "../../assets/icons/ellipse.svg";
import { ReactComponent as Check12Icon } from "../../assets/icons/check12.svg";
import { ReactComponent as GlobeIcon } from "../../assets/icons/globe.svg";
import { ReactComponent as StatusCircleIcon } from "../../assets/icons/statuscircle.svg";
import { ReactComponent as ArrowsUpDownIcon } from "../../assets/icons/arrowsupdown.svg";
import { ReactComponent as CircleIcon } from "../../assets/icons/circle.svg";
import { ReactComponent as AddIcon } from "../../assets/icons/add.svg";

import "./screenview.less";
import "./tabs.less";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class ScreenView extends React.Component<{ screen: Screen }, {}> {
    render() {
        let { screen } = this.props;
        if (screen == null) {
            return <div className="screen-view">(no screen found)</div>;
        }
        let fontSize = GlobalModel.termFontSize.get();
        return (
            <div className="screen-view" data-screenid={screen.screenId}>
                <ScreenWindowView key={screen.screenId + ":" + fontSize} screen={screen} />
            </div>
        );
    }
}

@mobxReact.observer
class NewTabSettings extends React.Component<{ screen: Screen }, {}> {
    connDropdownActive: OV<boolean> = mobx.observable.box(false, { name: "NewTabSettings-connDropdownActive" });
    errorMessage: OV<string> = mobx.observable.box(null, { name: "NewTabSettings-errorMessage" });
    
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
    inlineUpdateName(val: string): void {
        let { screen } = this.props;
        if (util.isStrEq(val, screen.name.get())) {
            return;
        }
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
        mobx.action(() => {
            this.connDropdownActive.set(false);
        })();
        let prtn = GlobalCommandRunner.screenSetRemote(cname, true, false);
        util.commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    clickNewConnection(): void {
        mobx.action(() => {
            this.connDropdownActive.set(false);
        })();
        GlobalModel.remotesModalModel.openModalForEdit({remoteedit: true}, true);
    }

    renderConnDropdown(): any {
        let { screen } = this.props;
        let allRemotes = util.sortAndFilterRemotes(GlobalModel.remotes.slice());
        let remote: T.RemoteType = null;
        let curRemote = GlobalModel.getRemote(GlobalModel.getActiveScreen().getCurRemoteInstance().remoteid);
        // TODO no remote?
        return (
            <div className={cn("dropdown", "conn-dropdown", { "is-active": this.connDropdownActive.get() })}>
                <div className="dropdown-trigger" onClick={this.toggleConnDropdown}>
                    <div className="conn-dd-trigger">
                        <div className="lefticon">
                            <GlobeIcon className="globe-icon"/>
                            <StatusCircleIcon className={cn("status-icon", "status-" + curRemote.status)}/>
                        </div>
                        <div className="conntext">
                            <If condition={util.isBlank(curRemote.remotealias)}>
                                <div className="text-standard conntext-solo">
                                    {curRemote.remotecanonicalname}
                                </div>
                            </If>
                            <If condition={!util.isBlank(curRemote.remotealias)}>
                                <div className="text-secondary conntext-1">
                                    {curRemote.remotealias}
                                </div>
                                <div className="text-caption conntext-2">
                                    {curRemote.remotecanonicalname}
                                </div>
                            </If>
                        </div>
                        <div className="dd-control">
                            <ArrowsUpDownIcon className="icon"/>
                        </div>
                    </div>
                </div>
                <div className="dropdown-menu" role="menu">
                    <div className="dropdown-content conn-dd-menu">
                        <For each="remote" of={allRemotes}>
                            <div className="dropdown-item" key={remote.remoteid} onClick={() => this.selectRemote(remote.remotecanonicalname)}>
                                <div className="status-div">
                                    <CircleIcon className={cn("status-icon", "status-" + remote.status)}/>
                                </div>
                                <If condition={util.isBlank(remote.remotealias)}>
                                    <div className="text-standard">{remote.remotecanonicalname}</div>
                                </If>
                                <If condition={!util.isBlank(remote.remotealias)}>
                                    <div className="text-standard">{remote.remotealias}</div>
                                    <div className="text-caption">{remote.remotecanonicalname}</div>
                                </If>
                            </div>
                        </For>
                        <div className="dropdown-item" onClick={this.clickNewConnection}>
                            <div className="add-div">
                                <AddIcon className="add-icon"/>
                            </div>
                            <div className="text-standard">New Connection</div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    
    render() {
        let { screen } = this.props;
        let rptr = screen.curRemote.get();
        let curColor = screen.getTabColor();
        if (util.isBlank(curColor) || curColor == "default") {
            curColor = "green";
        }
        let color: string = null;
        return (
            <div className="newtab-container">
                <div className="newtab-section conn-section">
                    <div className="text-s1">
                        You're connected to [{getRemoteStr(rptr)}].  Do you want to change it?
                    </div>
                    <div>
                        {this.renderConnDropdown()}
                    </div>
                </div>
                <div className="newtab-spacer"/>
                <div className="newtab-section settings-field">
                    <div className="text-s1">
                        Name
                    </div>
                    <div className="settings-input">
                        <InlineSettingsTextEdit
                            placeholder="name"
                            text={screen.name.get() ?? "(none)"}
                            value={screen.name.get() ?? ""}
                            onChange={this.inlineUpdateName}
                            maxLength={50}
                            showIcon={true}
                        />
                    </div>
                </div>
                <div className="newtab-spacer"/>
                <div className="newtab-section">
                    <div className="text-s1">
                        Select the color
                    </div>
                    <div className="control-iconlist">
                        <For each="color" of={TabColors}>
                            <div className="icondiv" key={color} title={color} onClick={() => this.selectTabColor(color)}>
                                <EllipseIcon className={cn("icon", "color-" + color)}/>
                                <If condition={color == curColor}>
                                    <Check12Icon className="check-icon"/>
                                </If>
                            </div>
                        </For>
                    </div>
                </div>
            </div>
        );
    }
}

// screen is not null
@mobxReact.observer
class ScreenWindowView extends React.Component<{ screen: Screen }, {}> {
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
                    <div>{message}</div>
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
        let { screen } = this.props;
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
                    <NewTabSettings screen={screen}/>
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
