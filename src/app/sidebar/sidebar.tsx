// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import dayjs from "dayjs";
import type { RemoteType } from "../../types/types";
import { If } from "tsx-control-statements/components";
import { compareLoose } from "semver";

import { ReactComponent as LeftChevronIcon } from "../assets/icons/chevron_left.svg";
import { ReactComponent as HelpIcon } from "../assets/icons/help.svg";
import { ReactComponent as SettingsIcon } from "../assets/icons/settings.svg";
import { ReactComponent as DiscordIcon } from "../assets/icons/discord.svg";
import { ReactComponent as HistoryIcon } from "../assets/icons/history.svg";
import { ReactComponent as AppsIcon } from "../assets/icons/apps.svg";
import { ReactComponent as ConnectionsIcon } from "../assets/icons/connections.svg";
import { ReactComponent as WorkspacesIcon } from "../assets/icons/workspaces.svg";
import { ReactComponent as AddIcon } from "../assets/icons/add.svg";
import { ReactComponent as ActionsIcon } from "../assets/icons/tab/actions.svg";

import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Session, VERSION } from "../../model/model";
import { isBlank, openLink } from "../../util/util";
import * as constants from "../appconst";

import "./sidebar.less";
import { EndIcon, FrontIcon } from "../common/common";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

class SideBarItem extends React.Component<{
    frontIcon: React.ReactNode;
    contents: React.ReactNode | string;
    endIcon?: React.ReactNode[];
    className?: string;
    key?: React.Key;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
}> {
    render() {
        return (
            <div
                key={this.props.key}
                className={cn("item", "unselectable", "hoverEffect", this.props.className)}
                onClick={this.props.onClick}
            >
                <FrontIcon>{this.props.frontIcon}</FrontIcon>
                <div className="item-contents truncate">{this.props.contents}</div>
                <EndIcon>{this.props.endIcon}</EndIcon>
            </div>
        );
    }
}

@mobxReact.observer
class MainSideBar extends React.Component<{}, {}> {
    collapsed: mobx.IObservableValue<boolean> = mobx.observable.box(false);

    @boundMethod
    toggleCollapsed() {
        mobx.action(() => {
            this.collapsed.set(!this.collapsed.get());
        })();
    }

    handleSessionClick(sessionId: string) {
        GlobalCommandRunner.switchSession(sessionId);
    }

    handleNewSession() {
        GlobalCommandRunner.createNewSession();
    }

    handleNewSharedSession() {
        GlobalCommandRunner.openSharedSession();
    }

    clickLinks() {
        mobx.action(() => {
            GlobalModel.showLinks.set(!GlobalModel.showLinks.get());
        })();
    }

    remoteDisplayName(remote: RemoteType): any {
        if (!isBlank(remote.remotealias)) {
            return (
                <>
                    <span>{remote.remotealias}</span>
                    <span className="small-text"> {remote.remotecanonicalname}</span>
                </>
            );
        }
        return <span>{remote.remotecanonicalname}</span>;
    }

    clickRemote(remote: RemoteType) {
        GlobalCommandRunner.showRemote(remote.remoteid);
    }

    @boundMethod
    handlePluginsClick(): void {
        if (GlobalModel.activeMainView.get() == "plugins") {
            GlobalModel.showSessionView();
            return;
        }
        GlobalModel.pluginsModel.showPluginsView();
    }

    @boundMethod
    handleHistoryClick(): void {
        if (GlobalModel.activeMainView.get() == "history") {
            GlobalModel.showSessionView();
            return;
        }
        GlobalModel.historyViewModel.reSearch();
    }

    @boundMethod
    handlePlaybookClick(): void {
        console.log("playbook click");
        return;
    }

    @boundMethod
    handleBookmarksClick(): void {
        if (GlobalModel.activeMainView.get() == "bookmarks") {
            GlobalModel.showSessionView();
            return;
        }
        GlobalCommandRunner.bookmarksView();
    }

    @boundMethod
    handleConnectionsClick(): void {
        if (GlobalModel.activeMainView.get() == "connections") {
            GlobalModel.showSessionView();
            return;
        }
        GlobalCommandRunner.connectionsView();
    }

    @boundMethod
    handleWebSharingClick(): void {
        if (GlobalModel.activeMainView.get() == "webshare") {
            GlobalModel.showSessionView();
            return;
        }
        GlobalModel.showWebShareView();
    }

    @boundMethod
    handleSettingsClick(): void {
        if (GlobalModel.activeMainView.get() == "clientsettings") {
            GlobalModel.showSessionView();
            return;
        }
        GlobalCommandRunner.clientSettingsView();
    }

    @boundMethod
    openSessionSettings(e: any, session: Session): void {
        e.preventDefault();
        e.stopPropagation();
        mobx.action(() => {
            GlobalModel.sessionSettingsModal.set(session.sessionId);
        })();
        GlobalModel.modalsModel.pushModal(constants.SESSION_SETTINGS);
    }

    getSessions() {
        if (!GlobalModel.sessionListLoaded.get()) return <div className="item">loading ...</div>;
        let sessionList = [];
        let activeSessionId = GlobalModel.activeSessionId.get();
        for (let session of GlobalModel.sessionList) {
            if (!session.archived.get() || session.sessionId == activeSessionId) {
                sessionList.push(session);
            }
        }
        return sessionList.map((session, index) => {
            const isActive = GlobalModel.activeMainView.get() == "session" && activeSessionId == session.sessionId;
            return (
                <SideBarItem
                    key={index}
                    className={`${isActive ? "active" : ""}`}
                    frontIcon={<span className="index">{index + 1}</span>}
                    contents={session.name.get()}
                    endIcon={[
                        <ActionsIcon
                            className="icon hoverEffect actions"
                            onClick={(e) => this.openSessionSettings(e, session)}
                        />,
                    ]}
                    onClick={() => this.handleSessionClick(session.sessionId)}
                />
            );
        });
    }

    render() {
        let isCollapsed = this.collapsed.get();
        let clientData = GlobalModel.clientData.get();
        let needsUpdate = false;
        if (!clientData?.clientopts.noreleasecheck && !isBlank(clientData?.releaseinfo?.latestversion)) {
            needsUpdate = compareLoose(VERSION, clientData.releaseinfo.latestversion) < 0;
        }
        return (
            <div className={cn("main-sidebar", { collapsed: isCollapsed }, { "is-dev": GlobalModel.isDev })}>
                <div className="title-bar-drag" />
                <div className="contents">
                    <div className="logo">
                        <If condition={isCollapsed}>
                            <div className="logo-container" onClick={this.toggleCollapsed}>
                                <img src="public/logos/wave-logo.png" />
                            </div>
                        </If>
                        <If condition={!isCollapsed}>
                            <div className="logo-container">
                                <img src="public/logos/wave-dark.png" />
                            </div>
                            <div className="spacer" />
                            <div className="collapse-button" onClick={this.toggleCollapsed}>
                                <LeftChevronIcon className="icon" />
                            </div>
                        </If>
                    </div>
                    <div className="separator" />
                    <div className="top">
                        <SideBarItem
                            frontIcon={<HistoryIcon className="icon" />}
                            contents="History"
                            endIcon={[<span className="hotkey">&#x2318;H</span>]}
                            onClick={this.handleHistoryClick}
                        />
                        {/* <SideBarItem className="hoverEffect unselectable" frontIcon={<FavoritesIcon className="icon" />} contents="Favorites" endIcon={<span className="hotkey">&#x2318;B</span>} onClick={this.handleBookmarksClick}/> */}
                        <SideBarItem
                            frontIcon={<ConnectionsIcon className="icon" />}
                            contents="Connections"
                            onClick={this.handleConnectionsClick}
                        />
                    </div>
                    <div className="separator" />
                    <SideBarItem
                        frontIcon={<WorkspacesIcon className="icon" />}
                        contents="Workspaces"
                        endIcon={[
                            <div className="add_workspace hoverEffect" onClick={this.handleNewSession}>
                                <AddIcon />
                            </div>,
                        ]}
                    />
                    <div className="middle hideScrollbarUntillHover">{this.getSessions()}</div>
                    <div className="bottom">
                        <If condition={needsUpdate}>
                            <SideBarItem
                                className="updateBanner"
                                frontIcon={<i className="fa-sharp fa-regular fa-circle-up icon" />}
                                contents="Update Available"
                                onClick={() => openLink("https://www.waveterm.dev/download?ref=upgrade")}
                            />
                        </If>
                        <If condition={GlobalModel.isDev}>
                            <SideBarItem
                                frontIcon={<AppsIcon className="icon" />}
                                contents="Apps"
                                onClick={this.handlePluginsClick}
                                endIcon={[<span className="hotkey">&#x2318;A</span>]}
                            />
                        </If>
                        <SideBarItem
                            frontIcon={<SettingsIcon className="icon" />}
                            contents="Settings"
                            onClick={this.handleSettingsClick}
                        />
                        <SideBarItem
                            frontIcon={<HelpIcon className="icon" />}
                            contents="Documentation"
                            onClick={() => openLink("https://docs.waveterm.dev")}
                        />
                        <SideBarItem
                            frontIcon={<DiscordIcon className="icon discord" />}
                            contents="Discord"
                            onClick={() => openLink("https://discord.gg/XfvZ334gwU")}
                        />
                    </div>
                </div>
            </div>
        );
    }
}

export { MainSideBar };
