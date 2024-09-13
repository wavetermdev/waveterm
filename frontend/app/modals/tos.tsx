// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { Button } from "@/app/element/button";
import { Toggle } from "@/app/element/toggle";
import { WshServer } from "@/app/store/wshserver";
import * as services from "@/store/services";
import { useEffect, useState } from "react";
import { FlexiModal } from "./modal";

import "./tos.less";

const TosModal = () => {
    const [telemetryEnabled, setTelemetryEnabled] = useState<boolean>(true);

    const acceptTos = () => {
        services.ClientService.AgreeTos();
    };

    function setTelemetry(value: boolean) {
        WshServer.SetConfigCommand({ "telemetry:enabled": value })
            .then(() => {
                setTelemetryEnabled(value);
            })
            .catch((error) => {
                console.error("failed to set telemetry:", error);
            });
    }

    useEffect(() => {
        services.FileService.GetFullConfig()
            .then((data) => {
                if ("telemetry:enabled" in data.settings) {
                    setTelemetryEnabled(true);
                } else {
                    setTelemetryEnabled(false);
                }
            })
            .catch((error) => {
                console.error("failed to get config:", error);
            });
    }, []);

    const label = telemetryEnabled ? "Telemetry enabled" : "Telemetry disabled";

    return (
        <FlexiModal className="tos-modal">
            <div className="modal-inner">
                <header className="modal-header tos-header unselectable">
                    <div className="logo">
                        <Logo />
                    </div>
                    <div className="modal-title">Welcome to Wave Terminal!</div>
                </header>
                <div className="modal-content tos-content unselectable">
                    <div className="content-section">
                        <div className="icon-wrapper">
                            <a target="_blank" href="https://github.com/wavetermdev/waveterm" rel={"noopener"}>
                                <i className="icon fa-brands fa-github"></i>
                            </a>
                        </div>
                        <div className="content-section-inner">
                            <div className="content-section-title">Support us on GitHub</div>
                            <div className="content-section-text">
                                We're <i>open source</i> and committed to providing a free terminal for individual
                                users. Please show your support by giving us a star on{" "}
                                <a target="_blank" href="https://github.com/wavetermdev/waveterm" rel={"noopener"}>
                                    Github&nbsp;(wavetermdev/waveterm)
                                </a>
                            </div>
                        </div>
                    </div>
                    <div className="content-section">
                        <div className="icon-wrapper">
                            <a target="_blank" href="https://github.com/wavetermdev/thenextwave" rel={"noopener"}>
                                <i className="icon fa-solid fa-people-group"></i>
                            </a>
                        </div>
                        <div className="content-section-inner">
                            <div className="content-section-title">Join our Community</div>
                            <div className="content-section-text">
                                Get help, submit feature requests, report bugs, or just chat with fellow terminal
                                enthusiasts.
                                <br />
                                <a target="_blank" href="https://discord.gg/XfvZ334gwU" rel={"noopener"}>
                                    Join the Wave&nbsp;Discord&nbsp;Channel
                                </a>
                            </div>
                        </div>
                    </div>
                    <div className="content-section">
                        <div className="icon-wrapper">
                            <i className="icon fa-solid fa-chart-line"></i>
                        </div>
                        <div className="content-section-inner">
                            <div className="content-section-title">Telemetry</div>
                            <div className="content-section-text">
                                We collect minimal anonymous
                                <a
                                    target="_blank"
                                    href="https://docs.waveterm.dev/reference/telemetry"
                                    rel={"noopener"}
                                >
                                    &nbsp;telemetry data&nbsp;
                                </a>
                                to help us understand how people are using Wave.
                            </div>
                            <Toggle checked={telemetryEnabled} onChange={setTelemetry} label={label} />
                        </div>
                    </div>
                </div>
                <footer className="unselectable">
                    <div className="button-wrapper">
                        <Button className="font-weight-600" onClick={acceptTos}>
                            Get Started
                        </Button>
                    </div>
                    <div className="content-section-text">
                        By continuing, I accept the&nbsp;
                        <a href="https://www.waveterm.dev/tos">Terms of Service</a>
                    </div>
                </footer>
            </div>
        </FlexiModal>
    );
};

TosModal.displayName = "TosModal";

export { TosModal };
