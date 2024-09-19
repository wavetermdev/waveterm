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
        getApi().openExternalLink("https://www.waveterm.dev/download-legacy");
    }

    @boundMethod
    handleDownloadNewWave(): void {
        getApi().openExternalLink("https://www.waveterm.dev/download");
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
                                We are excited to share that after 3-months of work, and almost 1000 new commits, Wave
                                v0.8 is now available. It features a new layout engine for screen splitting, improved
                                remote file browsing and previewing, improved performance, and a new design. We've also
                                removed some of the more controversial features that took over the shell experience and
                                overrode things like completions, history, and prompts.
                            </div>
                            <div className="item">
                                The new build is a fresh start, and a clean break from the current version. As such,
                                your history, settings, and configuration will <i>not</i> be carried over. If you'd like
                                to continue to run the legacy version, you will need to download it separately.
                            </div>
                            <div className="item image-item">
                                <img src={newwave} height="400px" />
                            </div>
                            <div className="item">
                                You can download Wave v0.8 now or wait for an auto-update next week. The legacy version
                                will be available via separate download page.
                            </div>
                        </div>
                        <footer className="unselectable">
                            <div className="button-wrapper">
                                <Button className="secondary" onClick={this.handleDownloadOldWave}>
                                    Legacy Download
                                </Button>
                            </div>
                            <div className="button-wrapper">
                                <Button onClick={this.handleDownloadNewWave}>Upgrade to Wave v0.8</Button>
                            </div>
                        </footer>
                    </div>
                </div>
            </Modal>
        );
    }
}

export { NewWaveModal };
