// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { GlobalModel } from "@/models";
import { Modal, LinkButton } from "@/elements";
import * as util from "@/util/util";
import * as appconst from "@/app/appconst";

import logo from "@/assets/waveterm-logo-with-bg.svg";
import "./about.less";

@mobxReact.observer
class AboutModal extends React.Component<{}, {}> {
    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.modalsModel.popModal();
        })();
    }

    @boundMethod
    isUpToDate(): boolean {
        return true;
    }

    @boundMethod
    updateApp(): void {
        // GlobalCommandRunner.updateApp();
    }

    @boundMethod
    getStatus(isUpToDate: boolean): JSX.Element {
        // TODO no up-to-date status reporting
        return (
            <div className="status updated">
                <div className="text-selectable">
                    Client Version {appconst.VERSION} ({appconst.BUILD})
                </div>
            </div>
        );

        if (isUpToDate) {
            return (
                <div className="status updated">
                    <div>
                        <i className="fa-sharp fa-solid fa-circle-check" />
                        <span>Up to Date</span>
                    </div>
                    <div className="selectable">
                        Client Version {appconst.VERSION} ({appconst.BUILD})
                    </div>
                </div>
            );
        }
        return (
            <div className="status outdated">
                <div>
                    <i className="fa-sharp fa-solid fa-triangle-exclamation" />
                    <span>Outdated Version</span>
                </div>
                <div className="selectable">
                    Client Version {appconst.VERSION} ({appconst.BUILD})
                </div>
                <div>
                    <button onClick={this.updateApp} className="button color-green text-secondary">
                        Update
                    </button>
                </div>
            </div>
        );
    }

    render() {
        const currentDate = new Date();
        return (
            <Modal className="about-modal">
                <Modal.Header onClose={this.closeModal} title="About" />
                <div className="wave-modal-body">
                    <div className="about-section">
                        <div className="logo-wrapper">
                            <img src={logo} alt="logo" />
                        </div>
                        <div className="text-wrapper">
                            <div>Wave Terminal</div>
                            <div className="text-standard">
                                Open Source AI-Native Terminal
                                <br />
                                Built for Seamless Workflows
                            </div>
                        </div>
                    </div>
                    <div className="about-section text-standard">{this.getStatus(this.isUpToDate())}</div>
                    <div className="about-section">
                        <LinkButton
                            className="secondary solid"
                            href={util.makeExternLink("https://github.com/wavetermdev/waveterm")}
                            target="_blank"
                            leftIcon={<i className="fa-brands fa-github"></i>}
                        >
                            Github
                        </LinkButton>
                        <LinkButton
                            className="secondary solid"
                            href={util.makeExternLink("https://www.waveterm.dev/")}
                            target="_blank"
                            leftIcon={<i className="fa-sharp fa-light fa-globe"></i>}
                        >
                            Website
                        </LinkButton>
                        <LinkButton
                            className="secondary solid"
                            href={util.makeExternLink(
                                "https://github.com/wavetermdev/waveterm/blob/main/acknowledgements/README.md"
                            )}
                            target="_blank"
                            rel={"noopener"}
                            leftIcon={<i className="fa-sharp fa-light fa-heart"></i>}
                        >
                            Acknowledgements
                        </LinkButton>
                    </div>
                    <div className="about-section text-standard">
                        &copy; {currentDate.getFullYear()} Command Line Inc.
                    </div>
                </div>
            </Modal>
        );
    }
}

export { AboutModal };
