import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {v4 as uuidv4} from "uuid";
import dayjs from "dayjs";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import {GlobalModel, GlobalCommandRunner, Screen} from "./model";
import {WebStopShareConfirmMarkdown} from "./settings";
import * as util from "./util";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;


@mobxReact.observer
class WebShareView extends React.Component<{}, {}> {
    shareCopied : OV<string> = mobx.observable.box(null, {name: "sw-shareCopied"});
    
    @boundMethod
    closeView() : void {
        GlobalModel.showSessionView();
    }

    @boundMethod
    viewInContext(screen : Screen) {
        GlobalModel.historyViewModel.closeView();
        GlobalCommandRunner.lineView(screen.sessionId, screen.screenId, screen.selectedLine.get());
    }

    getSSName(screen : Screen, snames : Record<string, string>) : string {
        let sessionName = snames[screen.sessionId] ?? "unknown";
        return sprintf("#%s[%s]", sessionName, screen.name.get())
    }

    @boundMethod
    copyShareLink(screen : Screen) : void {
        let shareLink = screen.getWebShareUrl();
        if (shareLink == null) {
            return;
        }
        navigator.clipboard.writeText(shareLink);
        mobx.action(() => {
            this.shareCopied.set(screen.screenId);
        })();
        setTimeout(() => {
            mobx.action(() => {
                this.shareCopied.set(null);
            })();
        }, 600)
    }

    @boundMethod
    openScreenSettings(screen : Screen) : void {
        mobx.action(() => {
            GlobalModel.screenSettingsModal.set({sessionId: screen.sessionId, screenId: screen.screenId});
        })();
    }

    @boundMethod
    stopSharing(screen : Screen) : void {
        let message = WebStopShareConfirmMarkdown;
        let alertRtn = GlobalModel.showAlert({message: message, confirm: true, markdown: true});
        alertRtn.then((result) => {
            if (!result) {
                return;
            }
            let prtn = GlobalCommandRunner.screenWebShare(screen.screenId, false);
            prtn.then((crtn) => {
                if (crtn.success) {
                    return;
                }
                GlobalModel.showAlert({message: crtn.error});
            });
        });
    }
    
    render() {
        let isHidden = (GlobalModel.activeMainView.get() != "webshare");
        if (isHidden) {
            return null;
        }
        let snames = GlobalModel.getSessionNames();
        let screenList = GlobalModel.getWebSharedScreens();
        let screen : Screen = null;
        return (
            <div className={cn("webshare-view", "alt-view")}>
                <div className="close-button" onClick={this.closeView}><i className="fa-sharp fa-solid fa-xmark"></i></div>
                <div className="alt-title">
                    <i className="fa-sharp fa-solid fa-share-nodes" style={{marginRight: 10}}/>
                    WEB SHARING<If condition={screenList.length > 0}> ({screenList.length})</If>
                </div>
                <If condition={screenList.length == 0}>
                    <div className="no-content">
                        No Active Web Shares.<br/>
                        Share a screen using the "web share" toggle in screen/tab settings <i className="fa-sharp fa-solid fa-gear"/>.
                    </div>
                </If>
                <If condition={screenList.length > 0}>
                    <div className="alt-list">
                        <For each="screen" of={screenList}>
                            <div key={screen.screenId} className="webshare-item">
                                <If condition={this.shareCopied.get() == screen.screenId}>
                                    <div className="copied-indicator"/>
                                </If>
                                <div className="webshare-vic">
                                    <span className="webshare-vic-link" onClick={() => this.viewInContext(screen)}>
                                        {this.getSSName(screen, snames)}
                                    </span>
                                </div>
                                <div className="actions">
                                    <a href={util.makeExternLink(screen.getWebShareUrl())} target="_blank" className="button is-prompt-green is-outlined is-small a-block">
                                        <span>open in browser</span>
                                        <span className="icon">
                                            <i className="fa-sharp fa-solid fa-up-right-from-square"/>
                                        </span>
                                    </a>
                                    <div className="button is-prompt-green is-outlined is-small" onClick={() => this.copyShareLink(screen)}>
                                        <span>copy link</span>
                                        <span className="icon">
                                            <i className="fa-sharp fa-solid fa-copy"/>
                                        </span>
                                    </div>
                                    <div className="button is-prompt-green is-outlined is-small" onClick={() => this.openScreenSettings(screen)}>
                                        <span>open settings</span>
                                        <span className="icon">
                                            <i className="fa-sharp fa-solid fa-cog"/>
                                        </span>
                                    </div>
                                    <div className="button is-prompt-danger is-outlined is-small ml-4" onClick={() => this.stopSharing(screen)}>
                                        <span>stop sharing</span>
                                        <span className="icon">
                                            <i className="fa-sharp fa-solid fa-trash"/>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </For>
                    </div>
                </If>
                <div className="alt-help">
                    <div className="help-entry">
                        Currently limited to a maximum of 3 screens, each with up to 50 commands.<br/>
                        Contact us on <a target="_blank" href="https://discord.gg/XfvZ334gwU"><i className="fa-brands fa-discord"/> Discord</a> to get a higher limit.
                    </div>
                </div>
            </div>
        );
    }
}

export {WebShareView};

