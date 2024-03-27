// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { GlobalModel, getApi } from "@/models";
import { Modal, LinkButton } from "@/elements";
import * as util from "@/util/util";
import * as appconst from "@/app/appconst";
import cn from "classnames";

import logo from "@/assets/waveterm-logo-with-bg.svg";
import "./about.less";
import { If } from "tsx-control-statements/components";

@mobxReact.observer
class AboutModal extends React.Component<{}, {}> {
    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.modalsModel.popModal();
        })();
    }

    @boundMethod
    updateApp(): void {
        getApi().installAppUpdate();
    }

    @boundMethod
    getClientVersion(): JSX.Element {
        const clientData: ClientDataType = GlobalModel.clientData.get();
        const showUpdateStatus = clientData.clientopts.noreleasecheck !== true;
        const isUpToDate = !showUpdateStatus || GlobalModel.appUpdateStatus.get() !== "ready";

        return (
            <div className={cn("status", { outdated: !isUpToDate })}>
                <If condition={!isUpToDate}>
                    <div>
                        <i className="fa-sharp fa-solid fa-triangle-exclamation" />
                        <span>Outdated Version</span>
                    </div>
                </If>
                <div className="selectable">
                    Client Version {appconst.VERSION} ({appconst.BUILD})
                </div>
                <If condition={!isUpToDate}>
                    <div>
                        <button onClick={this.updateApp} className="button color-green text-secondary">
                            Restart to Update
                        </button>
                    </div>
                </If>
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
                                Open-Source AI-Native Terminal
                                <br />
                                Built for Seamless Workflows
                            </div>
                        </div>
                    </div>
                    <div className="about-section text-standard">{this.getClientVersion()}</div>
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
