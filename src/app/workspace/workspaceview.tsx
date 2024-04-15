// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import cn from "classnames";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { If } from "tsx-control-statements/components";
import { GlobalModel, GlobalCommandRunner } from "@/models";
import { CmdInput } from "./cmdinput/cmdinput";
import { ScreenView } from "./screen/screenview";
import { ScreenTabs } from "./screen/tabs";
import { ErrorBoundary } from "@/common/error/errorboundary";
import { boundMethod } from "autobind-decorator";
import type { Screen } from "@/models";
import { Button, TermStyleBlock } from "@/elements";
import { commandRtnHandler } from "@/util/util";
import { getTermThemes } from "@/util/themeutil";
import { Dropdown } from "@/elements/dropdown";
import { getRemoteStrWithAlias } from "@/common/prompt/prompt";
import { TabColorSelector, TabIconSelector, TabNameTextField, TabRemoteSelector } from "./screen/newtabsettings";
import * as util from "@/util/util";

import "./workspace.less";

dayjs.extend(localizedFormat);

const ScreenDeleteMessage = `
Are you sure you want to delete this tab?
`.trim();

class SessionKeybindings extends React.Component<{}, {}> {
    componentDidMount() {
        const keybindManager = GlobalModel.keybindManager;
        keybindManager.registerKeybinding("mainview", "session", "app:toggleSidebar", (waveEvent) => {
            GlobalModel.handleToggleSidebar();
            return true;
        });
        keybindManager.registerKeybinding("mainview", "session", "app:newTab", (waveEvent) => {
            GlobalModel.onNewTab();
            return true;
        });
        keybindManager.registerKeybinding("mainview", "session", "app:closeCurrentTab", (waveEvent) => {
            GlobalModel.onCloseCurrentTab();
            return true;
        });
        for (let index = 1; index <= 9; index++) {
            keybindManager.registerKeybinding("mainview", "session", "app:selectTab-" + index, null);
        }
        keybindManager.registerKeybinding("mainview", "session", "app:selectTabLeft", (waveEvent) => {
            GlobalModel.onBracketCmd(-1);
            return true;
        });
        keybindManager.registerKeybinding("mainview", "session", "app:selectTabRight", (waveEvent) => {
            GlobalModel.onBracketCmd(1);
            return true;
        });
        keybindManager.registerKeybinding("pane", "screen", "app:selectLineAbove", (waveEvent) => {
            GlobalModel.onMetaArrowUp();
            return true;
        });
        keybindManager.registerKeybinding("pane", "screen", "app:selectLineBelow", (waveEvent) => {
            GlobalModel.onMetaArrowDown();
            return true;
        });
        keybindManager.registerKeybinding("pane", "screen", "app:restartCommand", (waveEvent) => {
            GlobalModel.onRestartCommand();
            return true;
        });
        keybindManager.registerKeybinding("pane", "screen", "app:restartLastCommand", (waveEvent) => {
            GlobalModel.onRestartLastCommand();
            return true;
        });
        keybindManager.registerKeybinding("pane", "screen", "app:focusSelectedLine", (waveEvent) => {
            GlobalModel.onFocusSelectedLine();
            return true;
        });
        keybindManager.registerKeybinding("pane", "screen", "app:deleteActiveLine", (waveEvent) => {
            return GlobalModel.handleDeleteActiveLine();
        });
    }

    componentWillUnmount() {
        GlobalModel.keybindManager.unregisterDomain("session");
        GlobalModel.keybindManager.unregisterDomain("screen");
    }

    render() {
        return null;
    }
}

@mobxReact.observer
class TabSettingsPulldownKeybindings extends React.Component<{}, {}> {
    componentDidMount() {
        const keybindManager = GlobalModel.keybindManager;
        keybindManager.registerKeybinding("pane", "tabsettings", "generic:cancel", (waveEvent) => {
            GlobalModel.closeTabSettings();
            return true;
        });
    }

    componentWillUnmount() {
        GlobalModel.keybindManager.unregisterDomain("tabsettings");
    }

    render() {
        return null;
    }
}

@mobxReact.observer
class TabSettings extends React.Component<{ screen: Screen }, {}> {
    errorMessage: OV<string> = mobx.observable.box(null, { name: "TabSettings-errorMessage" });

    @boundMethod
    handleDeleteScreen(): void {
        const { screen } = this.props;
        if (screen == null) {
            return;
        }
        if (screen.getScreenLines().lines.length == 0) {
            GlobalCommandRunner.screenDelete(screen.screenId, false);
            GlobalModel.modalsModel.popModal();
            return;
        }
        const message = ScreenDeleteMessage;
        const alertRtn = GlobalModel.showAlert({ message: message, confirm: true, markdown: true });
        alertRtn.then((result) => {
            if (!result) {
                return;
            }
            const prtn = GlobalCommandRunner.screenDelete(screen.screenId, false);
            util.commandRtnHandler(prtn, this.errorMessage);
            GlobalModel.modalsModel.popModal();
        });
    }

    @boundMethod
    handleChangeTermTheme(theme: string): void {
        console.log("theme", theme);
        const { screenId } = this.props.screen;
        const currTheme = GlobalModel.getTermTheme()[screenId];
        if (currTheme == theme) {
            return;
        }
        const prtn = GlobalCommandRunner.setScreenTermTheme(screenId, theme, false);
        commandRtnHandler(prtn, this.errorMessage);
    }

    render() {
        const { screen } = this.props;
        const rptr = screen.curRemote.get();
        const termThemes = getTermThemes(GlobalModel.termThemeOptions.get());
        const currTermTheme = GlobalModel.getTermTheme()[screen.screenId] ?? termThemes[0].label;
        return (
            <div className="newtab-container">
                <div className="newtab-section name-section">
                    <TabNameTextField screen={screen} errorMessage={this.errorMessage} />
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section conn-section">
                    <div className="unselectable truncate">
                        You're connected to "{getRemoteStrWithAlias(rptr)}". Do you want to change it?
                    </div>
                    <div>
                        <TabRemoteSelector screen={screen} errorMessage={this.errorMessage} />
                    </div>
                    <div className="text-caption cr-help-text truncate">
                        To change connection from the command line use `cr [alias|user@host]`
                    </div>
                </div>
                <div className="newtab-spacer" />
                <If condition={termThemes.length > 0}>
                    <div className="newtab-section">
                        <Dropdown
                            label="Terminal Theme"
                            className="terminal-theme-dropdown"
                            options={termThemes}
                            defaultValue={currTermTheme}
                            onChange={this.handleChangeTermTheme}
                        />
                    </div>
                </If>
                <div className="newtab-spacer" />
                <div className="newtab-section">
                    <TabIconSelector screen={screen} errorMessage={this.errorMessage} />
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section">
                    <TabColorSelector screen={screen} errorMessage={this.errorMessage} />
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section">
                    <Button
                        onClick={this.handleDeleteScreen}
                        style={{ paddingTop: 4, paddingBottom: 4 }}
                        className="primary greyoutlined greytext hover-danger"
                    >
                        Delete Tab
                    </Button>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class WorkspaceView extends React.Component<{}, {}> {
    sessionRef = React.createRef<HTMLDivElement>();

    @boundMethod
    toggleTabSettings() {
        mobx.action(() => {
            GlobalModel.tabSettingsOpen.set(!GlobalModel.tabSettingsOpen.get());
        })();
    }

    render() {
        const session = GlobalModel.getActiveSession();
        let activeScreen: Screen = null;
        let sessionId: string = "none";
        if (session != null) {
            sessionId = session.sessionId;
            activeScreen = session.getActiveScreen();
        }
        const isHidden = GlobalModel.activeMainView.get() != "session";
        const mainSidebarModel = GlobalModel.mainSidebarModel;
        const showTabSettings = GlobalModel.tabSettingsOpen.get();
        return (
            <div
                ref={this.sessionRef}
                className={cn("mainview", "session-view", { "is-hidden": isHidden })}
                id={sessionId}
                data-sessionid={sessionId}
                style={{
                    width: `${window.innerWidth - mainSidebarModel.getWidth()}px`,
                }}
            >
                <If condition={!isHidden}>
                    <SessionKeybindings key="keybindings"></SessionKeybindings>
                </If>
                <ScreenTabs key={"tabs-" + sessionId} session={session} />
                <If condition={activeScreen != null}>
                    <div key="pulldown" className={cn("tab-settings-pulldown", { closed: !showTabSettings })}>
                        <button className="close-icon" onClick={this.toggleTabSettings}>
                            <i className="fa-solid fa-sharp fa-xmark-large" />
                        </button>
                        <TabSettings key={activeScreen.screenId} screen={activeScreen} />
                        <If condition={showTabSettings && !isHidden}>
                            <TabSettingsPulldownKeybindings />
                        </If>
                    </div>
                </If>
                <ErrorBoundary key="eb">
                    <ScreenView key={`screenview-${sessionId}`} session={session} screen={activeScreen} />
                    <If condition={activeScreen != null}>
                        <CmdInput key={"cmdinput-" + sessionId} />
                    </If>
                </ErrorBoundary>
            </div>
        );
    }
}

export { WorkspaceView };
