// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If } from "tsx-control-statements/components";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalCommandRunner, GlobalModel } from "@/models";
import { isBlank } from "@/util/util";
import { WorkspaceView } from "./workspace/workspaceview";
import { PluginsView } from "./pluginsview/pluginsview";
import { BookmarksView } from "./bookmarks/bookmarks";
import { HistoryView } from "./history/history";
import { ConnectionsView } from "./connections/connections";
import { ClientSettingsView } from "./clientsettings/clientsettings";
import { MainSideBar } from "./sidebar/main";
import { RightSideBar } from "./sidebar/right";
import { DisconnectedModal, ClientStopModal } from "./common/modals";
import { ModalsProvider } from "./common/modals/provider";
import { ErrorBoundary } from "./common/error/errorboundary";
import cn from "classnames";
import "./app.less";

dayjs.extend(localizedFormat);

@mobxReact.observer
class App extends React.Component<{}, {}> {
    dcWait: OV<boolean> = mobx.observable.box(false, { name: "dcWait" });
    mainContentRef: React.RefObject<HTMLDivElement> = React.createRef();

    constructor(props: {}) {
        super(props);
        if (GlobalModel.isDev) document.body.classList.add("is-dev");
    }

    @boundMethod
    handleContextMenu(e: any) {
        let isInNonTermInput = false;
        const activeElem = document.activeElement;
        if (activeElem != null && activeElem.nodeName == "TEXTAREA") {
            if (!activeElem.classList.contains("xterm-helper-textarea")) {
                isInNonTermInput = true;
            }
        }
        if (activeElem != null && activeElem.nodeName == "INPUT" && activeElem.getAttribute("type") == "text") {
            isInNonTermInput = true;
        }
        const opts: ContextMenuOpts = {};
        if (isInNonTermInput) {
            opts.showCut = true;
        }
        const sel = window.getSelection();
        if (!isBlank(sel?.toString()) || isInNonTermInput) {
            GlobalModel.contextEditMenu(e, opts);
        }
    }

    @boundMethod
    updateDcWait(val: boolean): void {
        mobx.action(() => {
            this.dcWait.set(val);
        })();
    }

    @boundMethod
    openSidebar() {
        const width = GlobalModel.mainSidebarModel.getWidth(true);
        GlobalCommandRunner.clientSetSidebar(width, false);
    }

    render() {
        const remotesModel = GlobalModel.remotesModel;
        const disconnected = !GlobalModel.ws.open.get() || !GlobalModel.waveSrvRunning.get();
        const hasClientStop = GlobalModel.getHasClientStop();
        const dcWait = this.dcWait.get();
        const platform = GlobalModel.getPlatform();
        const clientData = GlobalModel.clientData.get();

        // Previously, this is done in sidebar.tsx but it causes flicker when clientData is null cos screen-view shifts around.
        // Doing it here fixes the flicker cos app is not rendered until clientData is populated.
        if (clientData == null) {
            return null;
        }

        if (disconnected || hasClientStop) {
            if (!dcWait) {
                setTimeout(() => this.updateDcWait(true), 1500);
            }
            return (
                <div id="main" className={"platform-" + platform} onContextMenu={this.handleContextMenu}>
                    <div ref={this.mainContentRef} className="main-content">
                        <MainSideBar parentRef={this.mainContentRef} clientData={clientData} />
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
        // used to force a full reload of the application
        const renderVersion = GlobalModel.renderVersion.get();
        const sidebarCollapsed = GlobalModel.mainSidebarModel.getCollapsed();
        const lightDarkClass = GlobalModel.isThemeDark() ? "is-dark" : "is-light";
        return (
            <div
                key={"version-" + renderVersion}
                id="main"
                className={cn("platform-" + platform, { "sidebar-collapsed": sidebarCollapsed }, lightDarkClass)}
                onContextMenu={this.handleContextMenu}
            >
                <If condition={sidebarCollapsed}>
                    <div key="logo-button" className="logo-button-container">
                        <div className="logo-button-spacer" />
                        <div className="logo-button" onClick={this.openSidebar}>
                            <img src="public/logos/wave-logo.png" alt="logo" />
                        </div>
                    </div>
                </If>
                <div ref={this.mainContentRef} className="main-content">
                    <MainSideBar parentRef={this.mainContentRef} clientData={clientData} />
                    <ErrorBoundary>
                        <PluginsView />
                        <WorkspaceView />
                        <HistoryView />
                        <BookmarksView />
                        <ConnectionsView model={remotesModel} />
                        <ClientSettingsView model={remotesModel} />
                    </ErrorBoundary>
                    <RightSideBar parentRef={this.mainContentRef} clientData={clientData} />
                </div>
                <ModalsProvider />
            </div>
        );
    }
}

export { App };
