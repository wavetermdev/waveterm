// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { For } from "tsx-control-statements/components";
import cn from "classnames";
import { debounce } from "throttle-debounce";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Session, ScreenLines, Screen } from "../../../model/model";
import { renderCmdText } from "../../common/common";
import { ReactComponent as SquareIcon } from "../../assets/icons/tab/square.svg";
import { ReactComponent as ActionsIcon } from "../../assets/icons/tab/actions.svg";
import { ReactComponent as AddIcon } from "../../assets/icons/add.svg";

import "../workspace.less";
import "./tabs.less";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

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
                <SquareIcon className="icon left-icon" />
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
                    <div key="new-screen" className="new-screen" onClick={this.handleNewScreen}>
                        <AddIcon className="icon hoverEffect" />
                    </div>
                </div>
            </div>
        );
    }
}

export { ScreenTabs };
