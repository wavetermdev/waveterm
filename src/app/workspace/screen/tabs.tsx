// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { For } from "tsx-control-statements/components";
import cn from "classnames";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Session, Screen } from "../../../model/model";
import { renderCmdText } from "../../common/common";
import { ReactComponent as SquareIcon } from "../../assets/icons/tab/square.svg";
import { ReactComponent as ActionsIcon } from "../../assets/icons/tab/actions.svg";
import { ReactComponent as AddIcon } from "../../assets/icons/add.svg";
import * as constants from "../../appconst";
import { Reorder } from "framer-motion";
import { MagicLayout } from "../../magiclayout";

import "../workspace.less";
import "./tabs.less";

dayjs.extend(localizedFormat);

@mobxReact.observer
class ScreenTabs extends React.Component<{ session: Session }, { showingScreens: Screen[] }> {
    tabsRef: React.RefObject<any> = React.createRef();
    tabRefs: { [screenId: string]: React.RefObject<any> } = {};
    lastActiveScreenId: string = null;
    dragEndTimeout = null;
    scrollIntoViewTimeout = null;
    deltaYHistory = [];

    constructor(props: any) {
        super(props);
        this.state = {
            showingScreens: [],
        };
    }

    @mobx.computed
    get activeScreenId(): string {
        let { session } = this.props;
        if (session) {
            return session.activeScreenId.get();
        }
    }

    @mobx.computed
    get screens(): Screen[] {
        if (this.activeScreenId) {
            let screens = GlobalModel.getSessionScreens(this.props.session.sessionId);
            let showingScreens = screens
                .filter((screen) => !screen.archived.get() || this.activeScreenId === screen.screenId)
                .sort((a, b) => a.screenIdx.get() - b.screenIdx.get());
            return showingScreens;
        }
    }

    @boundMethod
    handleNewScreen() {
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

    @boundMethod
    handleWheel(event: WheelEvent) {
        if (!this.tabsRef.current) return;

        // Add the current deltaY to the history
        this.deltaYHistory.push(Math.abs(event.deltaY));
        if (this.deltaYHistory.length > 5) {
            this.deltaYHistory.shift(); // Keep only the last 5 entries
        }

        // Check if any of the last 5 deltaY values are greater than a threshold
        let isMouseWheel = this.deltaYHistory.some((deltaY) => deltaY > 0);

        if (isMouseWheel) {
            // It's likely a mouse wheel event, so handle it for horizontal scrolling
            this.tabsRef.current.scrollLeft += event.deltaY;

            // Prevent default vertical scroll
            event.preventDefault();
        }
        // For touchpad events, do nothing and let the browser handle it
    }

    componentDidMount(): void {
        this.componentDidUpdate();

        // Add the wheel event listener to the tabsRef
        if (this.tabsRef.current) {
            this.tabsRef.current.addEventListener("wheel", this.handleWheel, { passive: false });
        }
    }

    componentWillUnmount() {
        if (this.dragEndTimeout) {
            clearTimeout(this.dragEndTimeout);
            clearTimeout(this.scrollIntoViewTimeout);
        }
    }

    componentDidUpdate(): void {
        // Scroll the active screen into view
        let { session } = this.props;
        let activeScreenId = session.activeScreenId.get();
        if (activeScreenId !== this.lastActiveScreenId) {
            if (this.scrollIntoViewTimeout) {
                clearTimeout(this.scrollIntoViewTimeout);
            }
            this.scrollIntoViewTimeout = setTimeout(() => {
                if (this.tabsRef.current) {
                    let tabElem = this.tabsRef.current.querySelector(
                        sprintf('.screen-tab[data-screenid="%s"]', activeScreenId)
                    );
                    if (tabElem) {
                        tabElem.scrollIntoView();
                    }
                }
                this.lastActiveScreenId = activeScreenId;
            }, 100);
        }

        // Set the showingScreens state if it's not set or if the number of screens has changed.
        // Individual screen update are handled automatically by mobx.
        if (this.screens && this.state.showingScreens.length !== this.screens.length) {
            this.setState({ showingScreens: this.screens });
        }
    }

    @boundMethod
    handleDragEnd(screenId) {
        if (this.dragEndTimeout) {
            clearTimeout(this.dragEndTimeout);
        }

        // Wait for the animation to complete
        this.dragEndTimeout = setTimeout(() => {
            const tabElement = this.tabRefs[screenId].current;
            const finalTabPosition = tabElement.offsetLeft;

            // Calculate the new index based on the final position
            const newIndex = Math.floor(finalTabPosition / MagicLayout.TabWidth);

            GlobalCommandRunner.screenReorder(screenId, `${newIndex + 1}`);
        }, 100);
    }

    @boundMethod
    openScreenSettings(e: any, screen: Screen): void {
        e.preventDefault();
        e.stopPropagation();
        mobx.action(() => {
            GlobalModel.screenSettingsModal.set({ sessionId: screen.sessionId, screenId: screen.screenId });
        })();
        GlobalModel.modalsModel.pushModal(constants.SCREEN_SETTINGS);
    }

    renderTabIcon = (screen: Screen): React.ReactNode => {
        const tabIcon = screen.getTabIcon();
        if (tabIcon === "default" || tabIcon === "square") {
            return (
                <div className="icon svg-icon">
                    <SquareIcon className="left-icon" />
                </div>
            );
        }
        return (
            <div className="icon fa-icon">
                <i className={`fa-sharp fa-solid fa-${tabIcon}`}></i>
            </div>
        );
    };

    renderTab(screen: Screen, activeScreenId: string, index: number): JSX.Element {
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

        // Create a ref for the tab if it doesn't exist
        if (!this.tabRefs[screen.screenId]) {
            this.tabRefs[screen.screenId] = React.createRef();
        }

        return (
            <Reorder.Item
                ref={this.tabRefs[screen.screenId]}
                value={screen}
                id={screen.name.get()}
                whileDrag={{
                    backgroundColor: "rgba(13, 13, 13, 0.85)",
                }}
                data-screenid={screen.screenId}
                className={cn(
                    "screen-tab",
                    { "is-active": activeScreenId == screen.screenId, "is-archived": screen.archived.get() },
                    "color-" + screen.getTabColor()
                )}
                onPointerDown={() => this.handleSwitchScreen(screen.screenId)}
                onContextMenu={(event) => this.openScreenSettings(event, screen)}
                onDragEnd={() => this.handleDragEnd(screen.screenId)}
            >
                {this.renderTabIcon(screen)}
                <div className="tab-name truncate">
                    {archived}
                    {webShared}
                    {screen.name.get()}
                </div>
                {tabIndex}
                {settings}
            </Reorder.Item>
        );
    }

    render() {
        let { showingScreens } = this.state;
        let { session } = this.props;
        if (session == null) {
            return null;
        }
        let screen: Screen | null = null;
        let index = 0;
        let activeScreenId = session.activeScreenId.get();
        return (
            <div className="screen-tabs-container">
                <Reorder.Group
                    className="screen-tabs"
                    ref={this.tabsRef}
                    as="ul"
                    axis="x"
                    onReorder={(tabs: Screen[]) => {
                        this.setState({ showingScreens: tabs });
                    }}
                    values={showingScreens}
                >
                    <For each="screen" index="index" of={showingScreens}>
                        <React.Fragment key={screen.screenId}>
                            {this.renderTab(screen, activeScreenId, index)}
                        </React.Fragment>
                    </For>
                </Reorder.Group>
                <div key="new-screen" className="new-screen" onClick={this.handleNewScreen}>
                    <AddIcon className="icon hoverEffect" />
                </div>
            </div>
        );
    }
}

export { ScreenTabs };
