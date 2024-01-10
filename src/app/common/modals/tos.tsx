// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { boundMethod } from "autobind-decorator";
import { GlobalModel, GlobalCommandRunner } from "../../../model/model";
import { Toggle, Modal, Button } from "../common";
import * as util from "../../../util/util";
import { ClientDataType } from "../../../types/types";

import shield from "../../assets/icons/shield_check.svg";
import help from "../../assets/icons/help_filled.svg";
import github from "../../assets/icons/github.svg";

import "./tos.less";

@mobxReact.observer
class TosModal extends React.Component<{}, {}> {
    @boundMethod
    acceptTos(): void {
        GlobalCommandRunner.clientAcceptTos();
        GlobalModel.modalsModel.popModal();
    }

    @boundMethod
    handleChangeTelemetry(val: boolean): void {
        if (val) {
            GlobalCommandRunner.telemetryOn(false);
        } else {
            GlobalCommandRunner.telemetryOff(false);
        }
    }

    render() {
        let cdata: ClientDataType = GlobalModel.clientData.get();

        return (
            <Modal className="tos-modal">
                <div className="wave-modal-body">
                    <div className="wave-modal-body-inner">
                        <header className="tos-header unselectable">
                            <div className="modal-title">Welcome to Wave Terminal!</div>
                            <div className="modal-subtitle">Lets set everything for you</div>
                        </header>
                        <div className="content tos-content unselectable">
                            <div className="item">
                                <img src={shield} alt="Privacy" />
                                <div className="item-inner">
                                    <div className="item-title">Telemetry</div>
                                    <div className="item-text">
                                        We only collect minimal <i>anonymous</i> telemetry data to help us understand
                                        how many people are using Wave.
                                    </div>
                                    <div className="item-field" style={{ marginTop: 2 }}>
                                        <Toggle
                                            checked={!cdata.clientopts.notelemetry}
                                            onChange={this.handleChangeTelemetry}
                                        />
                                        <div className="item-label">
                                            Telemetry {cdata.clientopts.notelemetry ? "Disabled" : "Enabled"}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="item">
                                <a
                                    target="_blank"
                                    href={util.makeExternLink("https://discord.gg/XfvZ334gwU")}
                                    rel={"noopener"}
                                >
                                    <img src={help} alt="Help" />
                                </a>
                                <div className="item-inner">
                                    <div className="item-title">Join our Community</div>
                                    <div className="item-text">
                                        Get help, submit feature requests, report bugs, or just chat with fellow
                                        terminal enthusiasts.
                                        <br />
                                        <a
                                            target="_blank"
                                            href={util.makeExternLink("https://discord.gg/XfvZ334gwU")}
                                            rel={"noopener"}
                                        >
                                            Join the Wave&nbsp;Discord&nbsp;Channel
                                        </a>
                                    </div>
                                </div>
                            </div>
                            <div className="item">
                                <a
                                    target="_blank"
                                    href={util.makeExternLink("https://github.com/wavetermdev/waveterm")}
                                    rel={"noopener"}
                                >
                                    <img src={github} alt="Github" />
                                </a>
                                <div className="item-inner">
                                    <div className="item-title">Support us on GitHub</div>
                                    <div className="item-text">
                                        We're <i>open source</i> and committed to providing a free terminal for
                                        individual users. Please show your support us by giving us a star on{" "}
                                        <a
                                            target="_blank"
                                            href={util.makeExternLink("https://github.com/wavetermdev/waveterm")}
                                            rel={"noopener"}
                                        >
                                            Github&nbsp;(wavetermdev/waveterm)
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <footer className="unselectable">
                            <div className="item-text">
                                By continuing, I accept the&nbsp;
                                <a href="https://www.waveterm.dev/tos">Terms of Service</a>
                            </div>
                            <div className="button-wrapper">
                                <Button onClick={this.acceptTos}>Continue</Button>
                            </div>
                        </footer>
                    </div>
                </div>
            </Modal>
        );
    }
}

export { TosModal };
