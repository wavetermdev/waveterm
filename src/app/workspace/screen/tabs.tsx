// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { For } from "tsx-control-statements/components";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Session, Screen } from "../../../model/model";
import { ReactComponent as AddIcon } from "../../assets/icons/add.svg";
import * as constants from "../../appconst";
import { Reorder } from "framer-motion";
import { ScreenTab } from "./tab";

import "../workspace.less";
import "./tabs.less";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class ScreenTabs extends React.Component<
    { session: Session },
    { showingScreens: Screen[]; screenIndices: OV<number>[] }
> {
    tabsRef: React.RefObject<any> = React.createRef();
    tabRefs: { [screenId: string]: React.RefObject<any> } = {};
    lastActiveScreenId: string = null;
    dragEndTimeout = null;
    scrollIntoViewTimeout = null;
    deltaYHistory = [];
    disposeScreensReaction = null;

    constructor(props: any) {
        super(props);
        this.state = {
            showingScreens: [],
            screenIndices: [],
        };
    }

    componentDidMount(): void {
        this.componentDidUpdate();

        this.disposeScreensReaction = mobx.reaction(
            () => this.screens,
            (screens) => {
                this.setState({ showingScreens: screens });
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
                        // tabElem.scrollIntoView();
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

    @mobx.computed
    get activeScreenId(): string {
        let { session } = this.props;
        if (session) {
            return session.activeScreenId.get();
        }
    }

    @mobx.computed
    get screens(): Screen[] {
        if (!this.activeScreenId) {
            return [];
        }

        let screens = GlobalModel.getSessionScreens(this.props.session.sessionId);
        let showingScreens = [];

        // First, filter and collect relevant screens
        for (const screen of screens) {
            if (!screen.archived.get() || this.activeScreenId === screen.screenId) {
                showingScreens.push(screen);
            }
        }

        // Then, sort the filtered screens
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
    haveScreensSwitchedIdx() {
        if (!this.state.screenIndices) {
            return true; // Initial case when there's no snapshot yet
        }

        for (let i = 0; i < this.screens.length; i++) {
            const currentScreen = this.screens[i];
            const previousIndex = this.state.screenIndices[i];

            if (currentScreen.screenIdx !== previousIndex) {
                return true;
            }
        }

        return false;
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
                            <ScreenTab
                                key={screen.screenId}
                                screen={screen}
                                activeScreenId={activeScreenId}
                                index={index}
                                onSwitchScreen={this.handleSwitchScreen}
                            />
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
