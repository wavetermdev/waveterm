import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import {GlobalModel, GlobalCommandRunner, TabColors} from "./model";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;
type CV<V> = mobx.IComputedValue<V>;

@mobxReact.observer
class ScreenSettingsModal extends React.Component<{sessionId : string, screenId : string}, {}> {
    tempName : OV<string>;
    tempTabColor : OV<string>;

    constructor(props : any) {
        super(props);
        let {sessionId, screenId} = props;
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen == null) {
            return;
        }
        this.tempName = mobx.observable.box(screen.name.get(), {name: "screenSettings-tempName"});
        this.tempTabColor = mobx.observable.box(screen.getTabColor(), {name: "screenSettings-tempTabColor"});
    }
    
    @boundMethod
    closeModal() : void {
        mobx.action(() => {
            GlobalModel.screenSettingsModal.set(null);
        })();
    }

    @boundMethod
    handleOK() : void {
        mobx.action(() => {
            GlobalModel.screenSettingsModal.set(null);
            GlobalCommandRunner.screenSetSettings({
                "tabcolor": this.tempTabColor.get(),
                "name": this.tempName.get(),
            });
        })();
    }

    @boundMethod
    handleChangeName(e : any) : void {
        mobx.action(() => {
            this.tempName.set(e.target.value);
        })();
    }

    @boundMethod
    selectTabColor(color : string) : void {
        mobx.action(() => {
            this.tempTabColor.set(color);
        })();
    }

    render() {
        let {sessionId, screenId} = this.props;
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen == null) {
            return null;
        }
        let color : string = null;
        return (
            <div className={cn("modal screen-settings-modal settings-modal prompt-modal is-active")}>
                <div className="modal-background"/>
                <div className="modal-content">
                    <header>
                        <div className="modal-title">screen settings ({screen.name.get()})</div>
                        <div className="close-icon">
                            <i onClick={this.closeModal} className="fa-sharp fa-solid fa-times"/>
                        </div>
                    </header>
                    <div className="inner-content">
                        <div className="settings-field">
                            <div className="settings-label">
                                Name
                            </div>
                            <div className="settings-input">
                                <input type="text" placeholder="Tab Name" onChange={this.handleChangeName} value={this.tempName.get()} maxLength={50}/>
                            </div>
                        </div>
                        <div className="settings-field">
                            <div className="settings-label">
                                Tab Color
                            </div>
                            <div className="settings-input">
                                <div className="tab-colors">
                                    <div className="tab-color-cur">
                                        <span className={cn("icon tab-color-icon", "color-" + this.tempTabColor.get())}>
                                            <i className="fa-sharp fa-solid fa-square"/>
                                        </span>
                                        <span>{this.tempTabColor.get()}</span>
                                    </div>
                                    <div className="tab-color-sep">|</div>
                                    <For each="color" of={TabColors}>
                                        <div key={color} className="tab-color-select" onClick={() => this.selectTabColor(color)}>
                                            <span className={cn("tab-color-icon", "color-" + color)}>
                                                <i className="fa-sharp fa-solid fa-square"/>
                                            </span>
                                        </div>
                                    </For>
                                </div>
                            </div>
                        </div>
                    </div>
                    <footer>
                        <div onClick={this.handleOK} className="button is-primary is-outlined is-small">OK</div>
                        <div onClick={this.closeModal} className="button is-danger is-outlined is-small">Cancel</div>
                    </footer>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class SessionSettingsModal extends React.Component<{sessionId : string}, {}> {
    tempName : OV<string>;

    constructor(props : any) {
        super(props);
        let {sessionId} = props;
        let session = GlobalModel.getSessionById(sessionId);
        if (session == null) {
            return;
        }
        this.tempName = mobx.observable.box(session.name.get(), {name: "sessionSettings-tempName"});
    }
    
    @boundMethod
    closeModal() : void {
        mobx.action(() => {
            GlobalModel.sessionSettingsModal.set(null);
        })();
    }

    @boundMethod
    handleOK() : void {
        mobx.action(() => {
            GlobalModel.sessionSettingsModal.set(null);
            GlobalCommandRunner.sessionSetSettings({
                "name": this.tempName.get(),
            });
        })();
    }

    @boundMethod
    handleChangeName(e : any) : void {
        mobx.action(() => {
            this.tempName.set(e.target.value);
        })();
    }

    render() {
        let {sessionId} = this.props;
        let session = GlobalModel.getSessionById(sessionId);
        if (session == null) {
            return null;
        }
        return (
            <div className={cn("modal session-settings-modal settings-modal prompt-modal is-active")}>
                <div className="modal-background"/>
                <div className="modal-content">
                    <header>
                        <div className="modal-title">session settings ({session.name.get()})</div>
                        <div className="close-icon">
                            <i onClick={this.closeModal} className="fa-sharp fa-solid fa-times"/>
                        </div>
                    </header>
                    <div className="inner-content">
                        <div className="settings-field">
                            <div className="settings-label">
                                Name
                            </div>
                            <div className="settings-input">
                                <input type="text" placeholder="Tab Name" onChange={this.handleChangeName} value={this.tempName.get()} maxLength={50}/>
                            </div>
                        </div>
                    </div>
                    <footer>
                        <div onClick={this.handleOK} className="button is-primary is-outlined is-small">OK</div>
                        <div onClick={this.closeModal} className="button is-danger is-outlined is-small">Cancel</div>
                    </footer>
                </div>
            </div>
        );
    }
}

export {ScreenSettingsModal, SessionSettingsModal};
