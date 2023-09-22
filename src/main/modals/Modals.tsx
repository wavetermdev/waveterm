import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "../../model";
import { Markdown } from "../../elements";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class DisconnectedModal extends React.Component<{}, {}> {
    logRef: any = React.createRef();
    showLog: mobx.IObservableValue<boolean> = mobx.observable.box(false);

    @boundMethod
    restartServer() {
        GlobalModel.restartLocalServer();
    }

    @boundMethod
    tryReconnect() {
        GlobalModel.ws.connectNow("manual");
    }

    componentDidMount() {
        if (this.logRef.current != null) {
            this.logRef.current.scrollTop = this.logRef.current.scrollHeight;
        }
    }

    componentDidUpdate() {
        if (this.logRef.current != null) {
            this.logRef.current.scrollTop = this.logRef.current.scrollHeight;
        }
    }

    @boundMethod
    handleShowLog(): void {
        mobx.action(() => {
            this.showLog.set(!this.showLog.get());
        })();
    }

    render() {
        let model = GlobalModel;
        let logLine: string = null;
        let idx: number = 0;
        return (
            <div className="prompt-modal disconnected-modal modal is-active">
                <div className="modal-background"></div>
                <div className="modal-content">
                    <div className="message-header">
                        <div className="modal-title">Prompt Client Disconnected</div>
                    </div>
                    <If condition={this.showLog.get()}>
                        <div className="inner-content">
                            <div className="ws-log" ref={this.logRef}>
                                <For each="logLine" index="idx" of={GlobalModel.ws.wsLog}>
                                    <div key={idx} className="ws-logline">
                                        {logLine}
                                    </div>
                                </For>
                            </div>
                        </div>
                    </If>
                    <footer>
                        <div className="footer-text-link" style={{ marginLeft: 10 }} onClick={this.handleShowLog}>
                            <If condition={!this.showLog.get()}>
                                <i className="fa-sharp fa-solid fa-plus" /> Show Log
                            </If>
                            <If condition={this.showLog.get()}>
                                <i className="fa-sharp fa-solid fa-minus" /> Hide Log
                            </If>
                        </div>
                        <div className="flex-spacer" />
                        <button onClick={this.tryReconnect} className="button">
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-rotate" />
                            </span>
                            <span>Try Reconnect</span>
                        </button>
                        <button onClick={this.restartServer} className="button is-danger" style={{ marginLeft: 10 }}>
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-triangle-exclamation" />
                            </span>
                            <span>Restart Server</span>
                        </button>
                    </footer>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class ClientStopModal extends React.Component<{}, {}> {
    @boundMethod
    refreshClient() {
        GlobalModel.refreshClient();
    }

    render() {
        let model = GlobalModel;
        let cdata = model.clientData.get();
        let title = "Client Not Ready";
        return (
            <div className="prompt-modal client-stop-modal modal is-active">
                <div className="modal-background"></div>
                <div className="modal-content">
                    <div className="message-header">
                        <div className="modal-title">[prompt] {title}</div>
                    </div>
                    <div className="inner-content">
                        <If condition={cdata == null}>
                            <div>Cannot get client data.</div>
                        </If>
                    </div>
                    <footer>
                        <button onClick={this.refreshClient} className="button">
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-rotate" />
                            </span>
                            <span>Hard Refresh Client</span>
                        </button>
                    </footer>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class LoadingSpinner extends React.Component<{}, {}> {
    render() {
        return (
            <div className="loading-spinner">
                <div></div>
                <div></div>
                <div></div>
                <div></div>
            </div>
        );
    }
}

@mobxReact.observer
class AlertModal extends React.Component<{}, {}> {
    @boundMethod
    closeModal(): void {
        GlobalModel.cancelAlert();
    }

    @boundMethod
    handleOK(): void {
        GlobalModel.confirmAlert();
    }

    render() {
        let message = GlobalModel.alertMessage.get();
        if (message == null) {
            return null;
        }
        let title = message.title ?? (message.confirm ? "Confirm" : "Alert");
        let isConfirm = message.confirm;
        return (
            <div className="modal prompt-modal is-active alert-modal">
                <div className="modal-background" />
                <div className="modal-content">
                    <header>
                        <p className="modal-title">
                            <i className="fa-sharp fa-solid fa-triangle-exclamation" /> {title}
                        </p>
                        <div className="close-icon">
                            <i onClick={this.closeModal} className="fa-sharp fa-solid fa-times" />
                        </div>
                    </header>
                    <If condition={message.markdown}>
                        <Markdown text={message.message} extraClassName="inner-content" />
                    </If>
                    <If condition={!message.markdown}>
                        <div className="inner-content content">
                            <p>{message.message}</p>
                        </div>
                    </If>
                    <footer>
                        <If condition={isConfirm}>
                            <div onClick={this.closeModal} className="button is-prompt-cancel is-outlined is-small">
                                Cancel
                            </div>
                            <div onClick={this.handleOK} className="button is-prompt-green is-outlined is-small">
                                OK
                            </div>
                        </If>
                        <If condition={!isConfirm}>
                            <div onClick={this.handleOK} className="button is-prompt-green is-small">
                                OK
                            </div>
                        </If>
                    </footer>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class WelcomeModal extends React.Component<{}, {}> {
    totalPages: number = 3;
    pageNum: OV<number> = mobx.observable.box(1, { name: "welcome-pagenum" });

    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.welcomeModalOpen.set(false);
        })();
    }

    @boundMethod
    goNext(): void {
        mobx.action(() => {
            this.pageNum.set(this.pageNum.get() + 1);
        })();
    }

    @boundMethod
    goPrev(): void {
        mobx.action(() => {
            this.pageNum.set(this.pageNum.get() - 1);
        })();
    }

    renderDot(num: number): any {
        if (num == this.pageNum.get()) {
            return <i key={String(num)} className="fa-sharp fa-solid fa-circle" />;
        }
        return <i key={String(num)} className="fa-sharp fa-regular fa-circle" />;
    }

    renderDots(): any {
        let elems: any = [];
        for (let i = 1; i <= this.totalPages; i++) {
            let elem = this.renderDot(i);
            elems.push(elem);
        }
        return elems;
    }

    render() {
        let pageNum = this.pageNum.get();
        return (
            <div className={cn("modal welcome-modal prompt-modal is-active")}>
                <div className="modal-background" />
                <div className="modal-content">
                    <header>
                        <div className="modal-title">welcome to [prompt]</div>
                        <div className="close-icon">
                            <i onClick={this.closeModal} className="fa-sharp fa-solid fa-times" />
                        </div>
                    </header>
                    <div className={cn("inner-content content", { "is-hidden": pageNum != 1 })}>
                        <p>
                            Prompt is a new terminal to help save you time and keep your command-line life organized.
                            Here's a couple quick tips to get your started!
                        </p>
                    </div>
                    <footer>
                        <If condition={pageNum > 1}>
                            <button className={cn("button is-dark prev-button is-small")} onClick={this.goPrev}>
                                <span className="icon is-small">
                                    <i className="fa-sharp fa-regular fa-angle-left" />
                                </span>
                                <span>Prev</span>
                            </button>
                        </If>
                        <If condition={pageNum == 1}>
                            <div className="prev-spacer" />
                        </If>
                        <div className="flex-spacer" />
                        <div className="dots">{this.renderDots()}</div>
                        <div className="flex-spacer" />
                        <If condition={pageNum < this.totalPages}>
                            <button className="button is-dark next-button is-small" onClick={this.goNext}>
                                <span>Next</span>
                                <span className="icon is-small">
                                    <i className="fa-sharp fa-regular fa-angle-right" />
                                </span>
                            </button>
                        </If>
                        <If condition={pageNum == this.totalPages}>
                            <button className="button is-dark next-button is-small" onClick={this.closeModal}>
                                <span>Done</span>
                            </button>
                        </If>
                    </footer>
                </div>
            </div>
        );
    }
}

export { WelcomeModal, LoadingSpinner, ClientStopModal, AlertModal, DisconnectedModal };
