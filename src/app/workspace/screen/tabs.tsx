// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { For, If } from "tsx-control-statements/components";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner, Session, Screen } from "@/models";
import { ReactComponent as AddIcon } from "@/assets/icons/add.svg";
import { Reorder } from "framer-motion";
import { ScreenTab } from "./tab";

import "./tabs.less";

@mobxReact.observer
class ScreenTabs extends React.Component<
    { session: Session },
    { showingScreens: Screen[]; scrollIntoViewTimeout: number }
> {
    tabsRef: React.RefObject<any> = React.createRef();
    lastActiveScreenId: string = null;
    dragEndTimeout = null;
    scrollIntoViewTimeoutId = null;
    deltaYHistory = [];
    disposeScreensReaction = null;

    constructor(props: any) {
        super(props);
        this.state = {
            showingScreens: [],
            scrollIntoViewTimeout: 0,
        };
    }

    componentDidMount(): void {
        // handle initial scrollIntoView
        this.componentDidUpdate();

        // populate showingScreens state
        this.setState({ showingScreens: this.getScreens() });
        // Update showingScreens state when the screens change
        this.disposeScreensReaction = mobx.reaction(
            () => this.getScreens(),
            (screens) => {
                // Different timeout for when screens are added vs removed
                let timeout = 100;
                if (screens.length < this.state.showingScreens.length) {
                    timeout = 400;
                }
                this.setState({ showingScreens: screens, scrollIntoViewTimeout: timeout });
            }
        );

        // Add the wheel event listener to the tabsRef
        if (this.tabsRef.current) {
            this.tabsRef.current.addEventListener("wheel", this.handleWheel, { passive: false });
        }
    }

    componentWillUnmount() {
        if (this.dragEndTimeout) {
            clearTimeout(this.dragEndTimeout);
        }

        if (this.disposeScreensReaction) {
            this.disposeScreensReaction(); // Clean up the reaction
        }
    }

    componentDidUpdate(): void {
        // Scroll the active screen into view
        let activeScreenId = this.getActiveScreenId();
        if (activeScreenId !== this.lastActiveScreenId) {
            if (this.scrollIntoViewTimeoutId) {
                clearTimeout(this.scrollIntoViewTimeoutId);
            }
            this.lastActiveScreenId = activeScreenId;
            this.scrollIntoViewTimeoutId = setTimeout(() => {
                if (!this.tabsRef.current) {
                    return;
                }
                let tabElem = this.tabsRef.current.querySelector(
                    sprintf('.screen-tab[data-screenid="%s"]', activeScreenId)
                );
                if (!tabElem) {
                    return;
                }
                tabElem.scrollIntoView();
            }, this.state.scrollIntoViewTimeout);
        }
    }

    @boundMethod
    getActiveScreenId(): string {
        let { session } = this.props;
        if (session) {
            return session.activeScreenId.get();
        }
        return null;
    }

    @mobx.computed
    @boundMethod
    getScreens(): Screen[] {
        let activeScreenId = this.getActiveScreenId();
        if (!activeScreenId) {
            return [];
        }

        let screens = GlobalModel.getSessionScreens(this.props.session.sessionId);
        let showingScreens = [];

        for (const screen of screens) {
            if (!screen.archived.get() || activeScreenId === screen.screenId) {
                showingScreens.push(screen);
            }
        }

        showingScreens.sort((a, b) => a.screenIdx.get() - b.screenIdx.get());

        return showingScreens;
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

    @boundMethod
    openSidebar() {
        const width = GlobalModel.mainSidebarModel.getWidth(true);
        GlobalCommandRunner.clientSetSidebar(width, false);
    }

    render() {
        let { showingScreens } = this.state;
        let { session } = this.props;
        if (session == null) {
            return null;
        }
        let screen: Screen | null = null;
        let index = 0;
        let activeScreenId = this.getActiveScreenId();
        const sidebarCollapsed = GlobalModel.mainSidebarModel.getCollapsed();
        return (
            <div
                className={cn("screen-tabs-container", {
                    "sidebar-collapsed": sidebarCollapsed,
                })}
            >
                <If condition={sidebarCollapsed}>
                    <div key="logo-button" className="logo-button-container">
                        <div className="logo-button" onClick={this.openSidebar}>
                            <img src="public/logos/wave-logo.png" alt="logo" />
                        </div>
                    </div>
                </If>
                {/* Inner container ensures that hovering over the scrollbar doesn't trigger the hover effect on the tabs. This prevents weird flickering of the icons when the mouse is moved over the scrollbar. */}
                <div
                    key="container-inner"
                    className="screen-tabs-container-inner no-highlight-scrollbar hideScrollbarUntillHover"
                >
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
                            <ScreenTab
                                key={screen.screenId}
                                screen={screen}
                                activeScreenId={activeScreenId}
                                index={index}
                                onSwitchScreen={this.handleSwitchScreen}
                            />
                        </For>
                    </Reorder.Group>
                </div>
                <div key="new-screen" className="new-screen" onClick={this.handleNewScreen}>
                    <AddIcon className="icon hoverEffect" />
                </div>
                <div key="spacer" className="tabs-end-spacer" />
            </div>
        );
    }
}

export { ScreenTabs };
