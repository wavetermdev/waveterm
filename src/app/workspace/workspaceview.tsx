// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import cn from "classnames";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "../../model/model";
import { CmdInput } from "./cmdinput/cmdinput";
import { ScreenView } from "./screen/screenview";
import { ScreenTabs } from "./screen/tabs";
import "./workspace.less";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class WorkspaceView extends React.Component<{}, {}> {
    render() {
        let model = GlobalModel;
        let session = model.getActiveSession();
        if (session == null) {
            return <div className="session-view">(no active session)</div>;
        }
        let activeScreen = session.getActiveScreen();
        let cmdInputHeight = model.inputModel.cmdInputHeight.get();
        if (cmdInputHeight == 0) {
            cmdInputHeight = 110;
        }
        let isHidden = GlobalModel.activeMainView.get() != "session";
        return (
            <div className={cn("session-view", { "is-hidden": isHidden })} data-sessionid={session.sessionId}>
                <ScreenTabs session={session} />
                <ScreenView screen={activeScreen} />
                <div style={{ height: cmdInputHeight }}></div>
                <CmdInput />
            </div>
        );
    }
}

export { WorkspaceView };
