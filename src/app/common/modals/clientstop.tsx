// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { boundMethod } from "autobind-decorator";
import { If } from "tsx-control-statements/components";
import { GlobalModel } from "../../../model";
import { Modal, Button } from "../elements";

import "./clientstop.less";

@mobxReact.observer
class ClientStopModal extends React.Component<{}, {}> {
    @boundMethod
    refreshClient() {
        GlobalModel.refreshClient();
    }

    render() {
        let model = GlobalModel;
        let cdata = model.clientData.get();
        return (
            <Modal className="clientstop-modal">
                <Modal.Header title="Client Not Ready" />
                <div className="wave-modal-body">
                    <div className="modal-content">
                        <div className="inner-content">
                            <If condition={cdata == null}>
                                <div>Cannot get client data.</div>
                            </If>
                            <div>
                                <Button
                                    theme="secondary"
                                    onClick={this.refreshClient}
                                    leftIcon={<i className="fa-sharp fa-solid fa-rotate"></i>}
                                >
                                    Hard Refresh Client
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>
        );
    }
}

export { ClientStopModal };
