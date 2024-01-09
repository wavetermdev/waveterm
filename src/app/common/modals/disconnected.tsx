// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "../../../model/model";
import { Modal, Button } from "../common";
dayjs.extend(localizedFormat);

const NumOfLines = 50;

@mobxReact.observer
class DisconnectedModal extends React.Component<{}, {}> {
    logRef: any = React.createRef();
    logs: mobx.IObservableValue<string> = mobx.observable.box("");
    logInterval: NodeJS.Timeout = null;

    @boundMethod
    restartServer() {
        GlobalModel.restartWaveSrv();
    }

    @boundMethod
    tryReconnect() {
        GlobalModel.ws.connectNow("manual");
    }

    componentDidMount() {
        this.fetchLogs();

        this.logInterval = setInterval(() => {
            this.fetchLogs();
        }, 5000);
    }

    componentWillUnmount() {
        if (this.logInterval) {
            clearInterval(this.logInterval);
        }
    }

    componentDidUpdate() {
        if (this.logRef.current != null) {
            this.logRef.current.scrollTop = this.logRef.current.scrollHeight;
        }
    }

    fetchLogs() {
        GlobalModel.getLastLogs(
            NumOfLines,
            mobx.action((logs) => {
                this.logs.set(logs);
                if (this.logRef.current != null) {
                    this.logRef.current.scrollTop = this.logRef.current.scrollHeight;
                }
            })
        );
    }

    render() {
        return (
            <Modal className="disconnected-modal">
                <Modal.Header title="Wave Client Disconnected" />
                <div className="wave-modal-body">
                    <div className="modal-content">
                        <div className="inner-content">
                            <div className="log" ref={this.logRef}>
                                <pre>{this.logs.get()}</pre>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="wave-modal-footer">
                    <Button
                        theme="secondary"
                        onClick={this.tryReconnect}
                        leftIcon={
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-rotate" />
                            </span>
                        }
                    >
                        Try Reconnect
                    </Button>
                    <Button
                        theme="secondary"
                        onClick={this.restartServer}
                        leftIcon={<i className="fa-sharp fa-solid fa-triangle-exclamation"></i>}
                    >
                        Restart Server
                    </Button>
                </div>
            </Modal>
        );
    }
}

export { DisconnectedModal };
