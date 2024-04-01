// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner, Screen } from "@/models";
import { ActionsIcon, StatusIndicator, CenteredIcon } from "@/common/icons/icons";
import * as constants from "@/app/appconst";
import { Reorder } from "framer-motion";
import { MagicLayout } from "@/app/magiclayout";
import { TabIcon } from "@/elements/tabicon";

@mobxReact.observer
class ScreenTab extends React.Component<
    { screen: Screen; activeScreenId: string; index: number; onSwitchScreen: (screenId: string) => void },
    {}
> {
    tabRef = React.createRef<HTMLUListElement>();
    dragEndTimeout = null;
    scrollIntoViewTimeout = null;
    theme: string;
    themeReactionDisposer: mobx.IReactionDisposer;

    componentDidMount() {
        // this.setupThemeReaction();
    }

    componentDidUpdate() {
        // this.setupThemeReaction();
    }

    setupThemeReaction() {
        if (this.themeReactionDisposer) {
            this.themeReactionDisposer();
        }

        this.themeReactionDisposer = mobx.reaction(
            () => {
                return {
                    termTheme: GlobalModel.getTermTheme(),
                    screen: this.props.screen,
                    session: GlobalModel.getActiveSession(),
                };
            },
            ({ termTheme, screen, session }) => {
                const currTheme = screen ? termTheme[screen.screenId] : null;
                if (screen && currTheme !== this.theme && this.tabRef.current) {
                    console.log("screen", screen, this.tabRef.current, currTheme, this.theme);

                    const reset = currTheme == null;
                    const theme = currTheme ?? this.theme;
                    const sessionEl = document.querySelector(
                        `.session-view[data-sessionid="${session.sessionId}"]`
                    ) as HTMLElement;
                    // const themeSrcEl = reset ? sessionEl : this.tabRef.current;
                    const themeSrcEl = GlobalModel.getTermThemeSrcEl(termTheme);
                    const rtn = GlobalModel.updateTermTheme(this.tabRef.current, theme, reset);
                    // if (themeSrcEl == this.tabRef.current) {
                    rtn.then(() => {
                        GlobalModel.termThemeSrcEl.set(themeSrcEl);
                    }).then(() => {
                        // GlobalModel.bumpTermRenderVersion();
                    });
                    this.theme = currTheme;
                    // }
                }
            }
        );
    }

    componentWillUnmount() {
        if (this.scrollIntoViewTimeout) {
            clearTimeout(this.dragEndTimeout);
        }
        if (this.themeReactionDisposer) {
            this.themeReactionDisposer();
        }
    }

    @boundMethod
    handleDragEnd() {
        if (this.dragEndTimeout) {
            clearTimeout(this.dragEndTimeout);
        }

        // Wait for the animation to complete
        this.dragEndTimeout = setTimeout(() => {
            const tabElement = this.tabRef.current;
            if (tabElement) {
                const finalTabPosition = tabElement.offsetLeft;

                // Calculate the new index based on the final position
                const newIndex = Math.floor(finalTabPosition / MagicLayout.TabWidth);

                GlobalCommandRunner.screenReorder(this.props.screen.screenId, `${newIndex + 1}`);
            }
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

    render() {
        let { screen, activeScreenId, index, onSwitchScreen } = this.props;
        let archived = screen.archived.get() ? (
            <i title="archived" className="fa-sharp fa-solid fa-box-archive" />
        ) : null;

        const statusIndicatorLevel = screen.statusIndicator.get();
        const runningCommands = screen.numRunningCmds.get() > 0;

        return (
            <Reorder.Item
                ref={this.tabRef}
                value={screen}
                id={"screentab-" + screen.screenId}
                data-screenid={screen.screenId}
                className={cn(
                    "screen-tab",
                    { "is-active": activeScreenId == screen.screenId, "is-archived": screen.archived.get() },
                    "color-" + screen.getTabColor()
                )}
                onPointerDown={() => onSwitchScreen(screen.screenId)}
                onContextMenu={(event) => this.openScreenSettings(event, screen)}
                onDragEnd={this.handleDragEnd}
            >
                <div className="background"></div>
                <div className="screen-tab-inner">
                    <CenteredIcon className="front-icon">
                        <TabIcon icon={screen.getTabIcon()} color={screen.getTabColor()} />
                    </CenteredIcon>
                    <div className="tab-name truncate">
                        {archived}
                        {screen.name.get()}
                    </div>
                    <div className="end-icons">
                        <StatusIndicator level={statusIndicatorLevel} runningCommands={runningCommands} />
                        <ActionsIcon onClick={(e) => this.openScreenSettings(e, screen)} />
                    </div>
                </div>
                <div className="vertical-line"></div>
            </Reorder.Item>
        );
    }
}

export { ScreenTab };
