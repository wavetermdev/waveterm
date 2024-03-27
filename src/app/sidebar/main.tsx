// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import dayjs from "dayjs";
import { If } from "tsx-control-statements/components";

import { ReactComponent as AppsIcon } from "@/assets/icons/apps.svg";
import { ReactComponent as WorkspacesIcon } from "@/assets/icons/workspaces.svg";
import { ReactComponent as SettingsIcon } from "@/assets/icons/settings.svg";
import { ReactComponent as WaveLogo } from "@/assets/waveterm-logo.svg";

import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Session } from "@/models";
import { isBlank, openLink } from "@/util/util";
import { ResizableSidebar } from "@/common/elements";
import * as appconst from "@/app/appconst";

import "./main.less";
import { ActionsIcon, CenteredIcon, FrontIcon, StatusIndicator } from "@/common/icons/icons";

import "overlayscrollbars/overlayscrollbars.css";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";

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
}

@mobxReact.observer
class MainSideBar extends React.Component<MainSideBarProps, {}> {
    middleHeightSubtractor = mobx.observable.box(404);

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

    /**
     * Get the update banner for the app, if we need to show it.
     * @returns Either a banner to install the ready update, a link to the download page, or null if no update is available.
     */
    @boundMethod
    getUpdateAppBanner(): React.ReactNode {
        const status = GlobalModel.appUpdateStatus.get();
        if (status == "ready") {
            return (
                <SideBarItem
                    key="update-ready"
                    className="update-banner"
                    frontIcon={<i className="fa-sharp fa-regular fa-circle-up icon" />}
                    contents="Click to Install Update"
                    onClick={() => GlobalModel.installAppUpdate()}
                />
            );
        } else {
            return null;
        }
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
            const isActive = activeSessionId == session.sessionId;
            const showHighlight = isActive && GlobalModel.activeMainView.get() == "session";
            const sessionScreens = GlobalModel.getSessionScreens(session.sessionId);
            const sessionIndicator = Math.max(...sessionScreens.map((screen) => screen.statusIndicator.get()));
            const sessionRunningCommands = sessionScreens.some((screen) => screen.numRunningCmds.get() > 0);
            return (
                <SideBarItem
                    key={session.sessionId}
                    className={cn({ active: isActive, highlight: showHighlight })}
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

    /**
     * Calculate the subtractor portion for the middle div's height calculation, which should be `100vh - subtractor`.
     */
    setMiddleHeightSubtractor() {
        const windowHeight = window.innerHeight;
        const bottomHeight = windowHeight - window.document.getElementById("sidebar-bottom")?.offsetTop;
        const middleTop = document.getElementById("sidebar-middle")?.offsetTop;
        const newMiddleHeightSubtractor = bottomHeight + middleTop;
        if (!Number.isNaN(newMiddleHeightSubtractor)) {
            mobx.action(() => {
                this.middleHeightSubtractor.set(newMiddleHeightSubtractor);
            })();
        }
    }

    componentDidMount() {
        this.setMiddleHeightSubtractor();
    }

    componentDidUpdate() {
        this.setMiddleHeightSubtractor();
    }

    render() {
        return (
            <ResizableSidebar
                model={GlobalModel.mainSidebarModel}
                className="main-sidebar"
                position="left"
                enableSnap={true}
                parentRef={this.props.parentRef}
            >
                {(toggleCollapse) => (
                    <React.Fragment>
                        <div className="title-bar-drag">
                            <div className="logo">
                                <WaveLogo />
                            </div>
                            <div className="close-button">
                                <i className="fa-sharp fa-solid fa-xmark-large" onClick={toggleCollapse} />
                            </div>
                        </div>
                        <div className="contents">
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
                            <OverlayScrollbarsComponent
                                element="div"
                                className="middle"
                                id="sidebar-middle"
                                style={{
                                    maxHeight: `calc(100vh - ${this.middleHeightSubtractor.get()}px)`,
                                }}
                                options={{ scrollbars: { autoHide: "leave" } }}
                            >
                                {this.getSessions()}
                            </OverlayScrollbarsComponent>

                            <div className="bottom" id="sidebar-bottom">
                                {this.getUpdateAppBanner()}
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
