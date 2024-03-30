// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-preact";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import { debounce } from "throttle-debounce";
import dayjs from "dayjs";
import { GlobalCommandRunner, ForwardLineContainer, GlobalModel, ScreenLines, Screen, Session } from "@/models";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { Button } from "@/elements";
import { Line } from "@/app/line/linecomps";
import { LinesView } from "@/app/line/linesview";
import * as util from "@/util/util";
import * as appconst from "@/app/appconst";
import * as textmeasure from "@/util/textmeasure";
import { NewTabSettings } from "./newtabsettings";

import "./screenview.less";
import "./tabs.less";
import { MagicLayout } from "../../magiclayout";

dayjs.extend(localizedFormat);

@mobxReact.observer
class ScreenView extends React.PureComponent<{ session: Session; screen: Screen }, {}> {
    rszObs: ResizeObserver;
    screenViewRef: React.RefObject<any> = React.createRef();
    width: OV<number> = mobx.observable.box(null, { name: "screenview-width" });
    handleResize_debounced: () => void;
    sidebarShowing: OV<boolean> = mobx.observable.box(false, { name: "screenview-sidebarShowing" });
    sidebarShowingTimeoutId: any = null;

    constructor(props: { session: Session; screen: Screen }) {
        super(props);
        this.handleResize_debounced = debounce(100, this.handleResize.bind(this));
        let screen = this.props.screen;
        let hasSidebar = false;
        if (screen != null) {
            let viewOpts = screen.viewOpts.get();
            hasSidebar = viewOpts?.sidebar?.open;
        }
        this.sidebarShowing = mobx.observable.box(hasSidebar, { name: "screenview-sidebarShowing" });
    }

    componentDidMount(): void {
        let { screen } = this.props;
        let elem = this.screenViewRef.current;
        if (elem != null) {
            this.rszObs = new ResizeObserver(this.handleResize_debounced);
            this.rszObs.observe(elem);
            this.handleResize();
        }
    }

    componentDidUpdate(): void {
        let { screen } = this.props;
        if (screen == null) {
            return;
        }
        let viewOpts = screen.viewOpts.get();
        let hasSidebar = viewOpts?.sidebar?.open;
        if (hasSidebar && !this.sidebarShowing.get()) {
            this.sidebarShowingTimeoutId = setTimeout(() => {
                mobx.action(() => {
                    this.sidebarShowingTimeoutId = null;
                    this.sidebarShowing.set(true);
                })();
            }, 500);
        } else if (!hasSidebar) {
            if (this.sidebarShowingTimeoutId != null) {
                clearTimeout(this.sidebarShowingTimeoutId);
                this.sidebarShowingTimeoutId = null;
            }
            mobx.action(() => this.sidebarShowing.set(false))();
        }
    }

    componentWillUnmount(): void {
        if (this.rszObs != null) {
            this.rszObs.disconnect();
        }
    }

    handleResize() {
        let elem = this.screenViewRef.current;
        if (elem == null) {
            return;
        }
        mobx.action(() => {
            this.width.set(elem.offsetWidth);
        })();
    }

    @boundMethod
    createWorkspace() {
        GlobalCommandRunner.createNewSession();
    }

    @boundMethod
    createTab() {
        GlobalCommandRunner.createNewScreen();
    }

    render() {
        let { session, screen } = this.props;
        let screenWidth = this.width.get();
        if (screenWidth == null) {
            return <div className="screen-view" ref={this.screenViewRef}></div>;
        }
        if (session == null) {
            let sessionCount = GlobalModel.sessionList.length;
            return (
                <div className="screen-view" ref={this.screenViewRef}>
                    <div className="window-view" style={{ width: "100%" }}>
                        <div key="lines" className="lines"></div>
                        <div key="window-empty" className={cn("window-empty")}>
                            <div className="flex-centered-column">
                                <code className="text-standard">[no workspace]</code>
                                <If condition={sessionCount == 0}>
                                    <Button onClick={this.createWorkspace} style={{ marginTop: 10 }}>
                                        Create New Workspace
                                    </Button>
                                </If>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }
        if (screen == null) {
            let screens = GlobalModel.getSessionScreens(session.sessionId);
            return (
                <div className="screen-view" ref={this.screenViewRef}>
                    <div className="window-view" style={{ width: "100%" }}>
                        <div key="lines" className="lines"></div>
                        <div key="window-empty" className={cn("window-empty")}>
                            <div className="flex-centered-column">
                                <code className="text-standard">[no active tab]</code>
                                <If condition={screens.length == 0}>
                                    <Button onClick={this.createTab} style={{ marginTop: 10 }}>
                                        Create New Tab
                                    </Button>
                                </If>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }
        let fontSize = GlobalModel.getTermFontSize();
        let dprStr = sprintf("%0.3f", GlobalModel.devicePixelRatio.get());
        let viewOpts = screen.viewOpts.get();
        let hasSidebar = viewOpts?.sidebar?.open;
        let winWidth = "100%";
        let sidebarWidth = "0px";
        if (hasSidebar) {
            let targetWidth = viewOpts?.sidebar?.width;
            let realWidth = 0;
            if (util.isBlank(targetWidth) || screenWidth < MagicLayout.ScreenSidebarMinWidth * 2) {
                realWidth = Math.floor(screenWidth / 2) - MagicLayout.ScreenSidebarWidthPadding;
            } else if (targetWidth.indexOf("%") != -1) {
                let targetPercent = parseInt(targetWidth);
                if (targetPercent > 100) {
                    targetPercent = 100;
                }
                let targetMul = targetPercent / 100;
                realWidth = Math.floor((screenWidth * targetPercent) / 100);
                realWidth = util.boundInt(
                    realWidth,
                    MagicLayout.ScreenSidebarMinWidth,
                    screenWidth - MagicLayout.ScreenSidebarMinWidth
                );
            } else {
                // screen is at least 400px wide
                let targetWidthNum = parseInt(targetWidth);
                realWidth = util.boundInt(
                    targetWidthNum,
                    MagicLayout.ScreenSidebarMinWidth,
                    screenWidth - MagicLayout.ScreenSidebarMinWidth
                );
            }
            winWidth = screenWidth - realWidth + "px";
            sidebarWidth = realWidth - MagicLayout.ScreenSidebarWidthPadding + "px";
        }
        return (
            <div className="screen-view" data-screenid={screen.screenId} ref={this.screenViewRef}>
                <ScreenWindowView
                    key={screen.screenId + ":" + fontSize + ":" + dprStr}
                    session={session}
                    screen={screen}
                    width={winWidth}
                />
                <If condition={hasSidebar && this.sidebarShowing.get()}>
                    <ScreenSidebar screen={screen} width={sidebarWidth} />
                </If>
            </div>
        );
    }
}

type SidebarLineContainerPropsType = {
    screen: Screen;
    winSize: WindowSize;
    lineId: string;
};

// note a new SidebarLineContainer will be made for every lineId (so lineId prop should never change)
// implemented using a 'key' in parent
@mobxReact.observer
class SidebarLineContainer extends React.PureComponent<SidebarLineContainerPropsType, {}> {
    container: ForwardLineContainer;
    overrideCollapsed: OV<boolean> = mobx.observable.box(false, { name: "overrideCollapsed" });
    visible: OV<boolean> = mobx.observable.box(true, { name: "visible" });
    ready: OV<boolean> = mobx.observable.box(false, { name: "ready" });

    componentDidMount(): void {
        let { screen, winSize, lineId } = this.props;
        // TODO this is a hack for now to make the timing work out.
        setTimeout(() => {
            mobx.action(() => {
                this.container = new ForwardLineContainer(screen, winSize, appconst.LineContainer_Sidebar, lineId);
                this.ready.set(true);
            })();
        }, 100);
    }

    @boundMethod
    handleHeightChange() {}

    componentDidUpdate(prevProps: SidebarLineContainerPropsType): void {
        let prevWinSize = prevProps.winSize;
        let winSize = this.props.winSize;
        if (prevWinSize.width != winSize.width || prevWinSize.height != winSize.height) {
            if (this.container != null) {
                this.container.screenSizeCallback(mobx.toJS(winSize));
            }
        }
    }

    render() {
        if (!this.ready.get() || this.container == null) {
            return null;
        }
        let { screen, winSize, lineId } = this.props;
        let line = screen.getLineById(lineId);
        if (line == null) {
            return null;
        }
        return (
            <Line
                screen={this.container}
                line={line}
                width={winSize.width}
                staticRender={false}
                visible={this.visible}
                onHeightChange={this.handleHeightChange}
                overrideCollapsed={this.overrideCollapsed}
                topBorder={false}
                renderMode="normal"
                noSelect={true}
            />
        );
    }
}

@mobxReact.observer
class ScreenSidebar extends React.PureComponent<{ screen: Screen; width: string }, {}> {
    rszObs: ResizeObserver;
    sidebarSize: OV<WindowSize> = mobx.observable.box({ height: 0, width: 0 }, { name: "sidebarSize" });
    sidebarRef: React.RefObject<any> = React.createRef();
    handleResize_debounced: (entries: ResizeObserverEntry[]) => void;

    constructor(props: any) {
        super(props);
        this.handleResize_debounced = debounce(100, this.handleResize.bind(this));
    }

    componentDidMount(): void {
        let { screen } = this.props;
        let sidebarElem = this.sidebarRef.current;
        if (sidebarElem != null) {
            this.rszObs = new ResizeObserver(this.handleResize_debounced);
            this.rszObs.observe(sidebarElem);
            this.handleResize([]);
        }
        let size = this.sidebarSize.get();
    }

    componentWillUnmount(): void {
        if (this.rszObs != null) {
            this.rszObs.disconnect();
        }
    }

    @boundMethod
    handleResize(entries: ResizeObserverEntry[]): void {
        // dont use entries (just use the ref) -- we call it with an empty array in componentDidMount to initialize it
        let sidebarElem = this.sidebarRef.current;
        if (sidebarElem == null) {
            return;
        }
        let size = {
            width: sidebarElem.offsetWidth,
            height:
                sidebarElem.offsetHeight -
                textmeasure.calcMaxLineChromeHeight(GlobalModel.lineHeightEnv) -
                MagicLayout.ScreenSidebarHeaderHeight,
        };
        mobx.action(() => this.sidebarSize.set(size))();
    }

    @boundMethod
    sidebarClose(): void {
        GlobalCommandRunner.screenSidebarClose();
    }

    @boundMethod
    sidebarOpenHalf(): void {
        GlobalCommandRunner.screenSidebarOpen("50%");
    }

    @boundMethod
    sidebarOpenPartial(): void {
        GlobalCommandRunner.screenSidebarOpen("500px");
    }

    getSidebarConfig(): ScreenSidebarOptsType {
        let { screen } = this.props;
        let viewOpts = screen.viewOpts.get();
        return viewOpts?.sidebar;
    }

    render() {
        let { screen, width } = this.props;
        let sidebarSize = this.sidebarSize.get();
        let sidebar = this.getSidebarConfig();
        let lineId = sidebar?.sidebarlineid;
        let sidebarOk = sidebarSize != null && sidebarSize.width > 0 && !util.isBlank(sidebar?.sidebarlineid);
        return (
            <div className="screen-sidebar" style={{ width: width }} ref={this.sidebarRef}>
                <div className="sidebar-header">
                    <div className="pane-name">sidebar</div>
                    <div className="flex-spacer" />
                    <div onClick={this.sidebarOpenHalf} title="Set Sidebar Width to 50%">
                        <i className="fa-sharp fa-solid fa-table-columns" />
                    </div>
                    <div onClick={this.sidebarOpenPartial} title="Set Sidebar Width to 500px">
                        <i className="fa-sharp fa-solid fa-sidebar-flip" />
                    </div>
                    <div onClick={this.sidebarClose} style={{ marginLeft: 5, marginRight: 10 }}>
                        <i className="fa-sharp fa-solid fa-xmark-large" />
                    </div>
                </div>
                <If condition={!sidebarOk}>
                    <div className="empty-sidebar">
                        <div className="sidebar-main-text">No Sidebar Line Selected</div>
                        <div className="sidebar-help-text">
                            /sidebar:open [width=[50%|500px]]
                            <br />
                            /sidebar:close
                            <br />
                            /sidebar:add line=[linenum]
                            <br />
                        </div>
                        <div onClick={this.sidebarClose} className="close-button-container">
                            <Button className="secondary" onClick={this.sidebarClose}>
                                Close Sidebar
                            </Button>
                        </div>
                    </div>
                </If>
                <If condition={sidebarOk}>
                    <SidebarLineContainer key={lineId} screen={screen} winSize={sidebarSize} lineId={lineId} />
                </If>
            </div>
        );
    }
}

// screen is not null
@mobxReact.observer
class ScreenWindowView extends React.PureComponent<{ session: Session; screen: Screen; width: string }, {}> {
    rszObs: ResizeObserver;
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
        const { screen } = this.props;
        let wvElem = this.windowViewRef.current;
        if (wvElem != null) {
            let width = wvElem.offsetWidth;
            let height = wvElem.offsetHeight;
            this.setSize(width, height);
            this.rszObs = new ResizeObserver(this.handleResize.bind(this));
            this.rszObs.observe(wvElem);
        }
        if (screen.isNew) {
            screen.isNew = false;
            mobx.action(() => {
                GlobalModel.tabSettingsOpen.set(true);
            })();
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
            <div
                className="window-view"
                ref={this.windowViewRef}
                data-screenid={screen.screenId}
                style={{ width: this.props.width }}
            >
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

    determineVisibleLines(win: ScreenLines): LineType[] {
        let { screen } = this.props;
        if (screen.filterRunning.get()) {
            return win.getRunningCmdLines();
        }
        return win.getNonArchivedLines();
    }

    @boundMethod
    disableFilter() {
        let { screen } = this.props;
        mobx.action(() => {
            screen.filterRunning.set(false);
        })();
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
        let lines = this.determineVisibleLines(win);
        let renderMode = this.renderMode.get();
        return (
            <div className="window-view" ref={this.windowViewRef} style={{ width: this.props.width }}>
                <If condition={lines.length == 0}>
                    <If condition={screen.nextLineNum.get() != 1}>
                        <div className="window-empty" ref={this.windowViewRef} data-screenid={screen.screenId}>
                            <div key="lines" className="lines"></div>
                            <div key="window-empty" className={cn("window-empty")}>
                                <div>
                                    <code className="text-standard">
                                        [workspace="{session.name.get()}" tab="{screen.name.get()}"]
                                    </code>
                                </div>
                            </div>
                        </div>
                    </If>
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
                <If condition={screen.filterRunning.get()}>
                    <div className="filter-running">
                        <div className="filter-mask" />
                        <div className="filter-content" onClick={this.disableFilter}>
                            Showing Running Commands &nbsp;
                            <i className="fa-sharp fa-solid fa-xmark-large" />
                        </div>
                    </div>
                </If>
            </div>
        );
    }
}

export { ScreenView };
