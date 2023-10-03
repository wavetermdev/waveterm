import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import dayjs from "dayjs";
import type { RemoteType } from "../../types/types";

import { ReactComponent as LeftChevronIcon } from "../../assets/icons/chevron_left.svg";
import { ReactComponent as HelpIcon } from "../../assets/icons/help.svg";
import { ReactComponent as SettingsIcon } from "../../assets/icons/settings.svg";
import { ReactComponent as DiscordIcon } from "../../assets/icons/discord.svg";
import { ReactComponent as HistoryIcon } from "../../assets/icons/history.svg";
import { ReactComponent as FavouritesIcon } from "../../assets/icons/favourites.svg";
import { ReactComponent as AppsIcon } from "../../assets/icons/apps.svg";
import { ReactComponent as ConnectionsIcon } from "../../assets/icons/connections.svg";
import { ReactComponent as WorkspacesIcon } from "../../assets/icons/workspaces.svg";
import { ReactComponent as AddIcon } from "../../assets/icons/add.svg";
import { ReactComponent as ActionsIcon } from "../../assets/icons/tab/actions.svg";

import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Session } from "../../model";
import { sortAndFilterRemotes, isBlank, openLink } from "../../util/util";
import { RemoteStatusLight } from "../../common/common";

import "./sidebar.less";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

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
    handleAddRemote(): void {
        GlobalCommandRunner.openCreateRemote();
    }

    @boundMethod
    handleHistoryClick(): void {
        if (GlobalModel.activeMainView.get() == "history") {
            mobx.action(() => {
                GlobalModel.activeMainView.set("session");
            })();
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
    handleWebSharingClick(): void {
        if (GlobalModel.activeMainView.get() == "webshare") {
            GlobalModel.showSessionView();
            return;
        }
        GlobalModel.showWebShareView();
    }

    @boundMethod
    handleWelcomeClick(): void {
        mobx.action(() => {
            GlobalModel.welcomeModalOpen.set(true);
        })();
    }

    @boundMethod
    handleSettingsClick(): void {
        mobx.action(() => {
            GlobalModel.clientSettingsModal.set(true);
        })();
    }

    @boundMethod
    handleConnectionsClick(): void {
        GlobalModel.remotesModalModel.openModal();
    }

    @boundMethod
    openSessionSettings(e: any, session: Session): void {
        e.preventDefault();
        e.stopPropagation();
        mobx.action(() => {
            GlobalModel.sessionSettingsModal.set(session.sessionId);
        })();
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
            /** @TODO: Handle archived sessions and talk to Mike about session settings */
            return (
                <div
                    key={index}
                    className={`item hoverEffect ${isActive ? "active" : ""}`}
                    onClick={() => this.handleSessionClick(session.sessionId)}
                >
                    <span className="hotkey">^⌘</span>
                    <span className="index">{index + 1}</span>
                    <span className="truncate sessionName">{session.name.get()}</span>
                    <ActionsIcon className="icon hoverEffect" onClick={(e) => this.openSessionSettings(e, session)} />
                </div>
            );
        });
    }

    render() {
        let model = GlobalModel;
        let activeSessionId = model.activeSessionId.get();
        let activeScreen = model.getActiveScreen();
        let activeRemoteId: string = null;
        if (activeScreen != null) {
            let rptr = activeScreen.curRemote.get();
            if (rptr != null && !isBlank(rptr.remoteid)) {
                activeRemoteId = rptr.remoteid;
            }
        }
        let session: Session = null;
        let remotes = model.remotes ?? [];
        let remote: RemoteType = null;
        let idx: number = 0;
        remotes = sortAndFilterRemotes(remotes);
        let sessionList = [];
        for (let session of model.sessionList) {
            if (!session.archived.get() || session.sessionId == activeSessionId) {
                sessionList.push(session);
            }
        }
        let isCollapsed = this.collapsed.get();
        let mainView = GlobalModel.activeMainView.get();
        return (
            <div className={cn("main-sidebar", { collapsed: isCollapsed }, { "is-dev": GlobalModel.isDev })}>
                <div className="arrow-container hoverEffect" onClick={this.toggleCollapsed}>
                    <LeftChevronIcon className="icon" />
                </div>
                <div className="contents">
                    <div className="top">
                        <div className="item hoverEffect">
                            <AppsIcon className="icon" />
                            Apps
                            <span className="hotkey">&#x2318;A</span>
                        </div>
                        <div className="item hoverEffect" onClick={this.handleHistoryClick}>
                            <HistoryIcon className="icon" />
                            History
                            <span className="hotkey">&#x2318;H</span>
                        </div>
                        <div className="item hoverEffect" onClick={this.handleBookmarksClick}>
                            <FavouritesIcon className="icon" />
                            Favourites
                            <span className="hotkey">&#x2318;B</span>
                        </div>
                        <div className="item hoverEffect" onClick={this.handleConnectionsClick}>
                            <ConnectionsIcon className="icon" />
                            Connections
                        </div>
                    </div>
                    <div className="separator" />
                    <div className="item">
                        <WorkspacesIcon className="icon" />
                        Workspaces
                        <div className="add_workspace hoverEffect" onClick={this.handleNewSession}>
                            <AddIcon />
                        </div>
                    </div>
                    <div className="middle hideScrollbarUntillHover">{this.getSessions()}</div>
                    <div className="bottom">
                        <div className="item hoverEffect" onClick={this.handleSettingsClick}>
                            <SettingsIcon className="icon" />
                            Settings
                        </div>
                        <div className="item hoverEffect" onClick={() => openLink("https://docs.getprompt.dev")}>
                            <HelpIcon className="icon" />
                            Documentation
                        </div>
                        <div className="item hoverEffect" onClick={() => openLink("https://discord.gg/XfvZ334gwU")}>
                            <DiscordIcon className="icon" />
                            Talk to us
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export { MainSideBar };
