// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If } from "tsx-control-statements/components";
import dayjs from "dayjs";
import type { ContextMenuOpts } from "../types/types";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "../model/model";
import { isBlank } from "../util/util";
import { WorkspaceView } from "./workspace/workspaceview";
import { PluginsView } from "./pluginsview/pluginsview";
import { BookmarksView } from "./bookmarks/bookmarks";
import { HistoryView } from "./history/history";
import { ConnectionsView } from "./connections/connections";
import {
    ScreenSettingsModal,
    SessionSettingsModal,
    LineSettingsModal,
    ClientSettingsModal,
} from "./common/modals/settings";
import { MainSideBar } from "./sidebar/sidebar";
import { DisconnectedModal, ClientStopModal, ModalsProvider } from "./common/modals/modals";
import { ErrorBoundary } from "./common/error/errorboundary";
import "./app.less";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class App extends React.Component<{}, {}> {
    dcWait: OV<boolean> = mobx.observable.box(false, { name: "dcWait" });

    constructor(props: any) {
        super(props);
        if (GlobalModel.isDev) document.body.className = "is-dev";
    }

    @boundMethod
    handleContextMenu(e: any) {
        let isInNonTermInput = false;
        let activeElem = document.activeElement;
        if (activeElem != null && activeElem.nodeName == "TEXTAREA") {
            if (!activeElem.classList.contains("xterm-helper-textarea")) {
                isInNonTermInput = true;
            }
        }
        if (activeElem != null && activeElem.nodeName == "INPUT" && activeElem.getAttribute("type") == "text") {
            isInNonTermInput = true;
        }
        let opts: ContextMenuOpts = {};
        if (isInNonTermInput) {
            opts.showCut = true;
        }
        let sel = window.getSelection();
        if (!isBlank(sel?.toString())) {
            GlobalModel.contextEditMenu(e, opts);
        } else {
            if (isInNonTermInput) {
                GlobalModel.contextEditMenu(e, opts);
            }
        }
    }

    @boundMethod
    updateDcWait(val: boolean): void {
        mobx.action(() => {
            this.dcWait.set(val);
        })();
    }

    render() {
        let screenSettingsModal = GlobalModel.screenSettingsModal.get();
        let sessionSettingsModal = GlobalModel.sessionSettingsModal.get();
        let lineSettingsModal = GlobalModel.lineSettingsModal.get();
        let clientSettingsModal = GlobalModel.clientSettingsModal.get();
        let remotesModel = GlobalModel.remotesModel;
        let disconnected = !GlobalModel.ws.open.get() || !GlobalModel.waveSrvRunning.get();
        let hasClientStop = GlobalModel.getHasClientStop();
        let dcWait = this.dcWait.get();
        let platform = GlobalModel.getPlatform();

        if (disconnected || hasClientStop) {
            if (!dcWait) {
                setTimeout(() => this.updateDcWait(true), 1500);
            }
            return (
                <div id="main" className={"platform-" + platform} onContextMenu={this.handleContextMenu}>
                    <div className="main-content">
                        <MainSideBar />
                        <div className="session-view" />
                    </div>
                    <If condition={dcWait}>
                        <If condition={disconnected}>
                            <DisconnectedModal />
                        </If>
                        <If condition={!disconnected && hasClientStop}>
                            <ClientStopModal />
                        </If>
                    </If>
                </div>
            );
        }
        if (dcWait) {
            setTimeout(() => this.updateDcWait(false), 0);
        }
        return (
            <div id="main" className={"platform-" + platform} onContextMenu={this.handleContextMenu}>
                <div className="main-content">
                    <MainSideBar />
                    <ErrorBoundary>
                        <PluginsView />
                        <WorkspaceView />
                        <HistoryView />
                        <BookmarksView />
                        <ConnectionsView model={remotesModel} />
                    </ErrorBoundary>
                </div>
                <ModalsProvider />
                <If condition={screenSettingsModal != null}>
                    <ScreenSettingsModal
                        key={screenSettingsModal.sessionId + ":" + screenSettingsModal.screenId}
                        sessionId={screenSettingsModal.sessionId}
                        screenId={screenSettingsModal.screenId}
                    />
                </If>
                <If condition={sessionSettingsModal != null}>
                    <SessionSettingsModal key={sessionSettingsModal} sessionId={sessionSettingsModal} />
                </If>
                <If condition={lineSettingsModal != null}>
                    <LineSettingsModal key={String(lineSettingsModal)} linenum={lineSettingsModal} />
                </If>
                <If condition={clientSettingsModal}>
                    <ClientSettingsModal />
                </If>
            </div>
        );
    }
}

export { App };
