// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { boundMethod } from "autobind-decorator";
import { Modal, Button } from "@/elements";

import newwave from "@/assets/new-wave-screenshot.svg";

import "./newwave.less";

@mobxReact.observer
class NewWaveModal extends React.Component<{ onClose: () => void }, {}> {
    @boundMethod
    handleDownloadOldWave(): void {
        //
    }

    @boundMethod
    handleDownloadNewWave(): void {
        //
    }

    @boundMethod
    handleClose(): void {
        this.props.onClose();
    }

    render() {
        return (
            <Modal className="tos-modal">
                <div className="wave-modal-body">
                    <div className="wave-modal-body-inner">
                        <header className="tos-header unselectable">
                            <div className="modal-title">A New Wave is Coming!</div>
                            <i className="fa-regular fa-xmark-large" onClick={this.handleClose}></i>
                        </header>
                        <div className="content tos-content unselectable">
                            <div className="item">
                                We are excited to share that New Wave is now available and it comes with significant
                                productivity boots thanks to new dashboard-like interface. Improve your workflows by
                                having: terminals, graphical widgets, web browser, file preview/edit on a single view!
                            </div>
                            <div className="item">
                                <img src={newwave} />
                            </div>
                            <div className="item">
                                <span>You can download New Wave now</span> or wait for an auto-update next week. This
                                legacy version will still be available via separate download page.
                            </div>
                        </div>
                        <footer className="unselectable">
                            <div className="button-wrapper">
                                <Button onClick={this.handleDownloadOldWave}>Legacy Download</Button>
                            </div>
                            <div className="button-wrapper">
                                <Button onClick={this.handleDownloadNewWave}>Download New Wave</Button>
                            </div>
                        </footer>
                    </div>
                </div>
            </Modal>
        );
    }
}

export { NewWaveModal };
