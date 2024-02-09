// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import dayjs from "dayjs";
import type { ClientDataType, RemoteType } from "../../types/types";
import { If } from "tsx-control-statements/components";
import { compareLoose } from "semver";

import { ReactComponent as LeftChevronIcon } from "../assets/icons/chevron_left.svg";
import { ReactComponent as AppsIcon } from "../assets/icons/apps.svg";
import { ReactComponent as WorkspacesIcon } from "../assets/icons/workspaces.svg";
import { ReactComponent as SettingsIcon } from "../assets/icons/settings.svg";

import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Session } from "../../models";
import { isBlank, openLink } from "../../util/util";
import { ResizableSidebar } from "../common/elements";
import * as appconst from "../appconst";

import "./sidebar.less";
import { ActionsIcon, CenteredIcon, FrontIcon, StatusIndicator } from "../common/icons/icons";

dayjs.extend(localizedFormat);

class SideBarItem extends React.Component<{
    frontIcon: React.ReactNode;
    contents: React.ReactNode | string;
    endIcons?: React.ReactNode[];
    className?: string;
    onClick?: React.MouseEventHandler<HTMLDivElement>;
}> {
    render() {
        return (
            <div
                className={cn("item", "unselectable", "hoverEffect", this.props.className)}
                onClick={this.props.onClick}
            >
                <FrontIcon>{this.props.frontIcon}</FrontIcon>
                <div className="item-contents truncate">{this.props.contents}</div>
                <div className="end-icons">{this.props.endIcons}</div>
            </div>
        );
    }
}

class HotKeyIcon extends React.Component<{ hotkey: string }> {
    render() {
        return (
            <CenteredIcon className="hotkey">
                <span>&#x2318;{this.props.hotkey}</span>
            </CenteredIcon>
        );
    }
}

interface MainSideBarProps {
    parentRef: React.RefObject<HTMLElement>;
    clientData: ClientDataType;
}

@mobxReact.observer
class MainSideBar extends React.Component<MainSideBarProps, {}> {
    sidebarRef = React.createRef<HTMLDivElement>();

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
        GlobalModel.modalsModel.pushModal(appconst.SESSION_SETTINGS);
    }

    getSessions() {
        if (!GlobalModel.sessionListLoaded.get()) return <div className="item">loading ...</div>;
        const sessionList: Session[] = [];
        const activeSessionId = GlobalModel.activeSessionId.get();
        for (const session of GlobalModel.sessionList) {
            if (!session.archived.get() || session.sessionId == activeSessionId) {
                sessionList.push(session);
            }
        }
        return sessionList.map((session, index) => {
            const isActive = GlobalModel.activeMainView.get() == "session" && activeSessionId == session.sessionId;
            const sessionScreens = GlobalModel.getSessionScreens(session.sessionId);
            const sessionIndicator = Math.max(...sessionScreens.map((screen) => screen.statusIndicator.get()));
            const sessionRunningCommands = sessionScreens.some((screen) => screen.numRunningCmds.get() > 0);
            return (
                <SideBarItem
                    key={session.sessionId}
                    className={`${isActive ? "active" : ""}`}
                    frontIcon={<span className="index">{index + 1}</span>}
                    contents={session.name.get()}
                    endIcons={[
                        <StatusIndicator
                            key="statusindicator"
                            level={sessionIndicator}
                            runningCommands={sessionRunningCommands}
                        />,
                        <ActionsIcon key="actions" onClick={(e) => this.openSessionSettings(e, session)} />,
                    ]}
                    onClick={() => this.handleSessionClick(session.sessionId)}
                />
            );
        });
    }

    render() {
        let clientData = this.props.clientData;
        let needsUpdate = false;
        if (!clientData?.clientopts.noreleasecheck && !isBlank(clientData?.releaseinfo?.latestversion)) {
            needsUpdate = compareLoose(appconst.VERSION, clientData.releaseinfo.latestversion) < 0;
        }
        let mainSidebar = GlobalModel.mainSidebarModel;
        let isCollapsed = mainSidebar.getCollapsed();
        return (
            <ResizableSidebar
                className="main-sidebar"
                position="left"
                enableSnap={true}
                parentRef={this.props.parentRef}
            >
                {(toggleCollapse) => (
                    <React.Fragment>
                        <div className="title-bar-drag" />
                        <div className="contents">
                            <div className="logo">
                                <If condition={isCollapsed}>
                                    <div className="logo-container" onClick={toggleCollapse}>
                                        <img src="public/logos/wave-logo.png" />
                                    </div>
                                </If>
                                <If condition={!isCollapsed}>
                                    <div className="logo-container">
                                        <img src="public/logos/wave-dark.png" />
                                    </div>
                                    <div className="spacer" />
                                    <div className="collapse-button" onClick={toggleCollapse}>
                                        <LeftChevronIcon className="icon" />
                                    </div>
                                </If>
                            </div>
                            <div className="separator" />
                            <div className="top">
                                <SideBarItem
                                    key="history"
                                    frontIcon={<i className="fa-sharp fa-regular fa-clock-rotate-left icon" />}
                                    contents="History"
                                    endIcons={[<HotKeyIcon key="hotkey" hotkey="H" />]}
                                    onClick={this.handleHistoryClick}
                                />
                                {/* <SideBarItem className="hoverEffect unselectable" frontIcon={<FavoritesIcon className="icon" />} contents="Favorites" endIcon={<span className="hotkey">&#x2318;B</span>} onClick={this.handleBookmarksClick}/> */}
                                <SideBarItem
                                    key="connections"
                                    frontIcon={<i className="fa-sharp fa-regular fa-globe icon " />}
                                    contents="Connections"
                                    onClick={this.handleConnectionsClick}
                                />
                            </div>
                            <div className="separator" />
                            <SideBarItem
                                key="workspaces"
                                className="workspaces"
                                frontIcon={<WorkspacesIcon className="icon" />}
                                contents="Workspaces"
                                endIcons={[
                                    <CenteredIcon
                                        key="add-workspace"
                                        className="add-workspace hoverEffect"
                                        onClick={this.handleNewSession}
                                    >
                                        <i className="fa-sharp fa-solid fa-plus"></i>
                                    </CenteredIcon>,
                                ]}
                            />
                            <div className="middle hideScrollbarUntillHover">{this.getSessions()}</div>
                            <div className="bottom">
                                <If condition={needsUpdate}>
                                    <SideBarItem
                                        key="update-available"
                                        className="updateBanner"
                                        frontIcon={<i className="fa-sharp fa-regular fa-circle-up icon" />}
                                        contents="Update Available"
                                        onClick={() => openLink("https://www.waveterm.dev/download?ref=upgrade")}
                                    />
                                </If>
                                <If condition={GlobalModel.isDev}>
                                    <SideBarItem
                                        key="apps"
                                        frontIcon={<AppsIcon className="icon" />}
                                        contents="Apps"
                                        onClick={this.handlePluginsClick}
                                        endIcons={[<HotKeyIcon key="hotkey" hotkey="A" />]}
                                    />
                                </If>
                                <SideBarItem
                                    key="settings"
                                    frontIcon={<SettingsIcon className="icon" />}
                                    contents="Settings"
                                    onClick={this.handleSettingsClick}
                                />
                                <SideBarItem
                                    key="documentation"
                                    frontIcon={<i className="fa-sharp fa-regular fa-circle-question icon" />}
                                    contents="Documentation"
                                    onClick={() => openLink("https://docs.waveterm.dev")}
                                />
                                <SideBarItem
                                    key="discord"
                                    frontIcon={<i className="fa-brands fa-discord icon" />}
                                    contents="Discord"
                                    onClick={() => openLink("https://discord.gg/XfvZ334gwU")}
                                />
                            </div>
                        </div>
                    </React.Fragment>
                )}
            </ResizableSidebar>
        );
    }
}

export { MainSideBar };
