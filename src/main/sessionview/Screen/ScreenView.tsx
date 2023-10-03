import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import { debounce } from "throttle-debounce";
import dayjs from "dayjs";
import type { LineType, RenderModeType, LineFactoryProps } from "../../../types/types";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Session, ScreenLines, Screen } from "../../../model";
import { Line } from "../../line/linecomps";
import { renderCmdText } from "../../../common/common";
import { LinesView } from "../../line/linesview";
import { ReactComponent as SparkleIcon } from "../../../assets/icons/tab/sparkle.svg";
import { ReactComponent as ActionsIcon } from "../../../assets/icons/tab/actions.svg";
import { ReactComponent as AddIcon } from "../../../assets/icons/add.svg";

import "../sessionview.less";
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
        let idx = 0;
        let line: LineType = null;
        let session = GlobalModel.getSessionById(screen.sessionId);
        let isActive = screen.isActive();
        let selectedLine = screen.getSelectedLine();
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
                <If condition={lines.length == 0}>
                    <div key="window-empty" className="window-empty">
                        <div>
                            <code>
                                [session="{session.name.get()}" screen="{screen.name.get()}"]
                            </code>
                        </div>
                    </div>
                </If>
            </div>
        );
    }
}

@mobxReact.observer
class ScreenTabs extends React.Component<{ session: Session }, {}> {
    tabsRef: React.RefObject<any> = React.createRef();
    lastActiveScreenId: string = null;
    scrolling: OV<boolean> = mobx.observable.box(false, { name: "screentabs-scrolling" });

    stopScrolling_debounced: () => void;

    constructor(props: any) {
        super(props);
        this.stopScrolling_debounced = debounce(1500, this.stopScrolling.bind(this));
    }

    @boundMethod
    handleNewScreen() {
        let { session } = this.props;
        GlobalCommandRunner.createNewScreen();
    }

    @boundMethod
    handleSwitchScreen(screenId: string) {
        let { session } = this.props;
        if (session == null) {
            return;
        }
        if (session.activeScreenId.get() == screenId) {
            return;
        }
        let screen = session.getScreenById(screenId);
        if (screen == null) {
            return;
        }
        GlobalCommandRunner.switchScreen(screenId);
    }

    componentDidMount(): void {
        this.componentDidUpdate();
    }

    componentDidUpdate(): void {
        let { session } = this.props;
        let activeScreenId = session.activeScreenId.get();
        if (activeScreenId != this.lastActiveScreenId && this.tabsRef.current) {
            let tabElem = this.tabsRef.current.querySelector(
                sprintf('.screen-tab[data-screenid="%s"]', activeScreenId)
            );
            if (tabElem != null) {
                tabElem.scrollIntoView();
            }
        }
        this.lastActiveScreenId = activeScreenId;
    }

    stopScrolling(): void {
        mobx.action(() => {
            this.scrolling.set(false);
        })();
    }

    @boundMethod
    handleScroll() {
        if (!this.scrolling.get()) {
            mobx.action(() => {
                this.scrolling.set(true);
            })();
        }
        this.stopScrolling_debounced();
    }

    @boundMethod
    openScreenSettings(e: any, screen: Screen): void {
        e.preventDefault();
        e.stopPropagation();
        mobx.action(() => {
            GlobalModel.screenSettingsModal.set({ sessionId: screen.sessionId, screenId: screen.screenId });
        })();
    }

    renderTab(screen: Screen, activeScreenId: string, index: number): any {
        let tabIndex = null;
        if (index + 1 <= 9) {
            tabIndex = <div className="tab-index">{renderCmdText(String(index + 1))}</div>;
        }
        let settings = (
            <div onClick={(e) => this.openScreenSettings(e, screen)} title="Actions" className="tab-gear">
                <ActionsIcon className="icon hoverEffect " />
            </div>
        );
        let archived = screen.archived.get() ? (
            <i title="archived" className="fa-sharp fa-solid fa-box-archive" />
        ) : null;

        let webShared = screen.isWebShared() ? (
            <i title="shared to web" className="fa-sharp fa-solid fa-share-nodes web-share-icon" />
        ) : null;
        return (
            <div
                key={screen.screenId}
                data-screenid={screen.screenId}
                className={cn(
                    "screen-tab",
                    { "is-active": activeScreenId == screen.screenId, "is-archived": screen.archived.get() },
                    "color-" + screen.getTabColor()
                )}
                onClick={() => this.handleSwitchScreen(screen.screenId)}
                onContextMenu={(event) => this.openScreenSettings(event, screen)}
            >
                <SparkleIcon className="icon" />
                <div className="tab-name truncate">
                    {archived}
                    {webShared}
                    {screen.name.get()}
                </div>
                {tabIndex}
                {settings}
            </div>
        );
    }

    render() {
        let { session } = this.props;
        if (session == null) {
            return null;
        }
        let screen: Screen = null;
        let index = 0;
        let showingScreens = [];
        let activeScreenId = session.activeScreenId.get();
        let screens = GlobalModel.getSessionScreens(session.sessionId);
        for (let screen of screens) {
            if (!screen.archived.get() || activeScreenId == screen.screenId) {
                showingScreens.push(screen);
            }
        }
        showingScreens.sort((a, b) => {
            let aidx = a.screenIdx.get();
            let bidx = b.screenIdx.get();
            if (aidx < bidx) {
                return -1;
            }
            if (aidx > bidx) {
                return 1;
            }
            return 0;
        });
        return (
            <div className="screen-tabs-container">
                <div
                    className={cn("screen-tabs", { scrolling: this.scrolling.get() })}
                    ref={this.tabsRef}
                    onScroll={this.handleScroll}
                >
                    <For each="screen" index="index" of={showingScreens}>
                        {this.renderTab(screen, activeScreenId, index)}
                    </For>
                    <div key="new-screen" className="screen-tab new-screen" onClick={this.handleNewScreen}>
                        <AddIcon className="icon hoverEffect" />
                    </div>
                </div>
                {/**<div className="cmd-hints">
                    <div className="hint-item color-green">move left {renderCmdText("[")}</div>
                    <div className="hint-item color-green">move right {renderCmdText("]")}</div>
                    <div className="hint-item color-green">new tab {renderCmdText("T")}</div>
        </div>*/}
            </div>
        );
    }
}

export { ScreenView, ScreenTabs };
