// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { boundMethod } from "autobind-decorator";
import { Modal, Button } from "@/elements";
import { getApi } from "@/models";

import newwave from "@/assets/new-wave-screenshot.svg";

import "./newwave.less";

@mobxReact.observer
class NewWaveModal extends React.Component<{ onClose: () => void }, {}> {
    @boundMethod
    handleDownloadOldWave(): void {
        getApi().openExternalLink("https://www.waveterm.dev/download");
    }

    @boundMethod
    handleDownloadNewWave(): void {
        getApi().openExternalLink("https://dl.waveterm.dev/releases-w2/TheNextWave-darwin-universal-0.1.12.dmg");
    }

    @boundMethod
    handleClose(): void {
        this.props.onClose();
    }

    render() {
        return (
            <Modal className="newwave-modal">
                <div className="wave-modal-body">
                    <div className="wave-modal-body-inner">
                        <header className="newwave-header unselectable">
                            <div className="modal-title">A New Wave is Coming!</div>
                            <i className="fa-regular fa-xmark-large close" onClick={this.handleClose}></i>
                        </header>
                        <div className="content newwave-content unselectable">
                            <div className="item">
                                We are excited to share that New Wave is now available and it comes with significant
                                productivity boots thanks to new dashboard-like interface. Improve your workflows by
                                having: terminals, graphical widgets, web browser, file preview/edit on a single view!
                            </div>
                            <div className="item">
                                <img src={newwave} width="100%" />
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
