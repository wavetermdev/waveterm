import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If } from "tsx-control-statements/components";
import dayjs from "dayjs";
import type { ContextMenuOpts } from "../types";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "../model";
import { isBlank } from "../util";
import { BookmarksView } from "./bookmarks/bookmarks";
import { WebShareView } from "../webshare/webshare-client-view";
import { HistoryView } from "./history/history";
import { ScreenSettingsModal, SessionSettingsModal, LineSettingsModal, ClientSettingsModal } from "./modals/settings";
import { RemotesModal } from "../remotes";
import { TosModal } from "./modals/Modals";

import { SessionView } from "./sessionview/SessionView";
import { MainSideBar } from "./sidebar/MainSideBar";
import { DisconnectedModal, ClientStopModal, LoadingSpinner, AlertModal, WelcomeModal } from "./modals/Modals";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class Main extends React.Component<{}, {}> {
    dcWait: OV<boolean> = mobx.observable.box(false, { name: "dcWait" });

    constructor(props: any) {
        super(props);
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
        if (!isBlank(sel.toString())) {
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
        let remotesModal = GlobalModel.remotesModalModel.isOpen();
        let disconnected = !GlobalModel.ws.open.get() || !GlobalModel.localServerRunning.get();
        let hasClientStop = GlobalModel.getHasClientStop();
        let dcWait = this.dcWait.get();
        if (disconnected || hasClientStop) {
            if (!dcWait) {
                setTimeout(() => this.updateDcWait(true), 1500);
            }
            return (
                <div id="main" onContextMenu={this.handleContextMenu}>
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
            <div id="main" onContextMenu={this.handleContextMenu}>
                <div className="main-content">
                    <MainSideBar />
                    <SessionView />
                    <HistoryView />
                    <BookmarksView />
                    <WebShareView />
                </div>
                <AlertModal />
                <If condition={GlobalModel.needsTos()}>
                    <TosModal />
                </If>
                <If condition={GlobalModel.welcomeModalOpen.get()}>
                    <WelcomeModal />
                </If>
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
                <If condition={remotesModal}>
                    <RemotesModal model={GlobalModel.remotesModalModel} />
                </If>
            </div>
        );
    }
}

export { Main };
