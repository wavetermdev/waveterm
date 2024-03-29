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
import * as textmeasure from "@/util/textmeasure";
import "./workspace.less";

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
class WorkspaceView extends React.Component<{}, {}> {
    sessionRef = React.createRef<HTMLDivElement>();
    theme: string;
    themeReactionDisposer: mobx.IReactionDisposer;

    componentDidMount() {
        this.themeReactionDisposer = mobx.reaction(
            () => {
                return GlobalModel.getActiveSession();
            },
            (session) => {
                const currTheme = session ? GlobalModel.getTermTheme()[session.sessionId] : null;
                if (session && currTheme !== this.theme) {
                    GlobalCommandRunner.setSessionTermTheme(session.sessionId, currTheme, false);
                    this.theme = currTheme;
                }
            }
        );
    }

    render() {
        const session = GlobalModel.getActiveSession();
        if (session == null) {
            return (
                <div className="session-view">
                    <div className="center-message">
                        <div>(no active workspace)</div>
                    </div>
                </div>
            );
        }
        const activeScreen = session.getActiveScreen();
        let cmdInputHeight = GlobalModel.inputModel.cmdInputHeight.get();
        if (cmdInputHeight == 0) {
            cmdInputHeight = textmeasure.baseCmdInputHeight(GlobalModel.lineHeightEnv); // this is the base size of cmdInput (measured using devtools)
        }
        const isHidden = GlobalModel.activeMainView.get() != "session";
        const mainSidebarModel = GlobalModel.mainSidebarModel;
        const termRenderVersion = GlobalModel.termRenderVersion.get();

        return (
            <div
                ref={this.sessionRef}
                className={cn("mainview", "session-view", { "is-hidden": isHidden })}
                data-sessionid={session.sessionId}
                style={{
                    width: `${window.innerWidth - mainSidebarModel.getWidth()}px`,
                }}
            >
                <If condition={!isHidden}>
                    <SessionKeybindings></SessionKeybindings>
                </If>
                <ScreenTabs key={"tabs-" + session.sessionId} session={session} />
                <ErrorBoundary>
                    <ScreenView
                        key={`screenview-${session.sessionId}-${termRenderVersion}`}
                        session={session}
                        screen={activeScreen}
                    />
                    <div className="cmdinput-height-placeholder" style={{ height: cmdInputHeight }}></div>
                    <CmdInput key={"cmdinput-" + session.sessionId} />
                </ErrorBoundary>
            </div>
        );
    }
}

export { WorkspaceView };
