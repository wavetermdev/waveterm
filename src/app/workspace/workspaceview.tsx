// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import cn from "classnames";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "../../models";
import { CmdInput } from "./cmdinput/cmdinput";
import { ScreenView } from "./screen/screenview";
import { ScreenTabs } from "./screen/tabs";
import { ErrorBoundary } from "../../app/common/error/errorboundary";
import { MagicLayout } from "../magiclayout";
import "./workspace.less";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class WorkspaceView extends React.Component<{}, {}> {
    render() {
        let model = GlobalModel;
        let session = model.getActiveSession();
        if (session == null) {
            return (
                <div className="session-view">
                    <div className="center-message">
                        <div>(no active workspace)</div>
                    </div>
                </div>
            );
        }
        let activeScreen = session.getActiveScreen();
        let cmdInputHeight = model.inputModel.cmdInputHeight.get();
        if (cmdInputHeight == 0) {
            cmdInputHeight = MagicLayout.CmdInputHeight; // this is the base size of cmdInput (measured using devtools)
        }
        cmdInputHeight += MagicLayout.CmdInputBottom; // reference to .cmd-input, bottom: 12px
        let isHidden = GlobalModel.activeMainView.get() != "session";
        let mainSidebarModel = GlobalModel.mainSidebarModel;

        // Has to calc manually because when tabs overflow, the width of the session view is increased for some reason causing inconsistent width.
        // 6px is the right margin of session view.
        let width = window.innerWidth - 6 - mainSidebarModel.getWidth();

        return (
            <div
                className={cn("session-view", { "is-hidden": isHidden })}
                data-sessionid={session.sessionId}
                style={{
                    width: `${width}px`,
                }}
            >
                <ScreenTabs key={"tabs-" + session.sessionId} session={session} />
                <ErrorBoundary>
                    <ScreenView key={"screenview-" + session.sessionId} session={session} screen={activeScreen} />
                    <div className="cmdinput-height-placeholder" style={{ height: cmdInputHeight }}></div>
                    <CmdInput key={"cmdinput-" + session.sessionId} />
                </ErrorBoundary>
            </div>
        );
    }
}

export { WorkspaceView };
