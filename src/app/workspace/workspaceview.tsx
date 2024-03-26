// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import cn from "classnames";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { If } from "tsx-control-statements/components";
import { GlobalModel } from "@/models";
import { CmdInput } from "./cmdinput/cmdinput";
import { ScreenView } from "./screen/screenview";
import { ScreenTabs } from "./screen/tabs";
import { ErrorBoundary } from "@/common/error/errorboundary";
import * as textmeasure from "@/util/textmeasure";
import "./workspace.less";
import { boundMethod } from "autobind-decorator";
import type { Screen } from "@/models";
import { getRemoteStr, getRemoteStrWithAlias } from "@/common/prompt/prompt";
import { TabColorSelector, TabIconSelector, TabNameTextField, TabRemoteSelector } from "./screen/newtabsettings";

dayjs.extend(localizedFormat);

class SessionKeybindings extends React.Component<{}, {}> {
    componentDidMount() {
        let keybindManager = GlobalModel.keybindManager;
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
        keybindManager.registerKeybinding("pane", "session", "app:selectLineAbove", (waveEvent) => {
            GlobalModel.onMetaArrowUp();
            return true;
        });
        keybindManager.registerKeybinding("pane", "session", "app:selectLineBelow", (waveEvent) => {
            GlobalModel.onMetaArrowDown();
            return true;
        });
        keybindManager.registerKeybinding("pane", "session", "app:restartCommand", (waveEvent) => {
            GlobalModel.onRestartCommand();
            return true;
        });
        keybindManager.registerKeybinding("pane", "session", "app:restartLastCommand", (waveEvent) => {
            GlobalModel.onRestartLastCommand();
            return true;
        });
        keybindManager.registerKeybinding("pane", "session", "app:focusSelectedLine", (waveEvent) => {
            GlobalModel.onFocusSelectedLine();
            return true;
        });
        keybindManager.registerKeybinding("pane", "session", "app:deleteActiveLine", (waveEvent) => {
            return GlobalModel.handleDeleteActiveLine();
        });
    }

    componentWillUnmount() {
        GlobalModel.keybindManager.unregisterDomain("session");
    }

    render() {
        return null;
    }
}

@mobxReact.observer
class TabSettings extends React.Component<{ screen: Screen }, {}> {
    errorMessage: OV<string> = mobx.observable.box(null, { name: "TabSettings-errorMessage" });

    render() {
        let { screen } = this.props;
        let rptr = screen.curRemote.get();
        return (
            <div className="newtab-container">
                <div className="newtab-section name-section">
                    <TabNameTextField screen={screen} errorMessage={this.errorMessage} />
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section conn-section">
                    <div className="unselectable">
                        You're connected to "{getRemoteStrWithAlias(rptr)}". Do you want to change it?
                    </div>
                    <div>
                        <TabRemoteSelector screen={screen} errorMessage={this.errorMessage} />
                    </div>
                    <div className="text-caption cr-help-text">
                        To change connection from the command line use `cr [alias|user@host]`
                    </div>
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section">
                    <TabIconSelector screen={screen} errorMessage={this.errorMessage} />
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section">
                    <TabColorSelector screen={screen} errorMessage={this.errorMessage} />
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class WorkspaceView extends React.Component<{}, {}> {
    showTabSettings: OV<boolean> = mobx.observable.box(true, { name: "WorkspaceView-showTabSettings" });

    @boundMethod
    toggleTabSettings() {
        let newVal = !this.showTabSettings.get();
        mobx.action(() => {
            this.showTabSettings.set(newVal);
        })();
    }

    render() {
        let model = GlobalModel;
        let session = model.getActiveSession();
        let activeScreen: Screen = null;
        let sessionId: string = "none";
        if (session != null) {
            sessionId = session.sessionId;
            activeScreen = session.getActiveScreen();
        }
        let cmdInputHeight = model.inputModel.cmdInputHeight.get();
        if (cmdInputHeight == 0) {
            cmdInputHeight = textmeasure.baseCmdInputHeight(GlobalModel.lineHeightEnv); // this is the base size of cmdInput (measured using devtools)
        }
        let isHidden = GlobalModel.activeMainView.get() != "session";
        let mainSidebarModel = GlobalModel.mainSidebarModel;
        // let showTabSettings = this.showTabSettings.get();
        return (
            <div
                className={cn("mainview", "session-view", { "is-hidden": isHidden })}
                data-sessionid={sessionId}
                style={{
                    width: `${window.innerWidth - mainSidebarModel.getWidth()}px`,
                }}
            >
                <If condition={!isHidden}>
                    <SessionKeybindings key="keybindings"></SessionKeybindings>
                </If>
                <ScreenTabs key={"tabs-" + sessionId} session={session} />
                {/*
                <div className={cn("tab-settings-pulldown", { closed: !showTabSettings })}>
                    <div className="close-icon" onClick={this.toggleTabSettings}>
                        <i className="fa-solid fa-sharp fa-xmark-large" />
                    </div>
                    <TabSettings screen={activeScreen} />
                </div>
                */}
                <ErrorBoundary key="eb">
                    <ScreenView key={"screenview-" + sessionId} session={session} screen={activeScreen} />
                    <div className="cmdinput-height-placeholder" style={{ height: cmdInputHeight }}></div>
                    <If condition={activeScreen != null}>
                        <CmdInput key={"cmdinput-" + sessionId} />
                    </If>
                </ErrorBoundary>
            </div>
        );
    }
}

export { WorkspaceView };
