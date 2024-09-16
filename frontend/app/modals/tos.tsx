// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { Button } from "@/app/element/button";
import { Toggle } from "@/app/element/toggle";
import * as services from "@/store/services";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useEffect, useRef, useState } from "react";
import { FlexiModal } from "./modal";

import { RpcApi } from "@/app/store/wshclientapi";
import { WindowRpcClient } from "@/app/store/wshrpcutil";
import "./tos.less";

const TosModal = () => {
    const [telemetryEnabled, setTelemetryEnabled] = useState<boolean>(true);
    const modalRef = useRef<HTMLDivElement | null>(null);

    const updateModalHeight = () => {
        const windowHeight = window.innerHeight;
        if (modalRef.current) {
            const modalHeight = modalRef.current.offsetHeight;
            const maxHeight = windowHeight * 0.9;
            if (maxHeight < modalHeight) {
                modalRef.current.style.height = `${maxHeight}px`;
            } else {
                modalRef.current.style.height = "auto";
            }
        }
    };

    useEffect(() => {
        updateModalHeight(); // Run on initial render

        window.addEventListener("resize", updateModalHeight); // Run on window resize
        return () => {
            window.removeEventListener("resize", updateModalHeight);
        };
    }, []);

    const acceptTos = () => {
        services.ClientService.AgreeTos();
    };

    const setTelemetry = (value: boolean) => {
        RpcApi.SetConfigCommand(WindowRpcClient, { "telemetry:enabled": value })
            .then(() => {
                setTelemetryEnabled(value);
            })
            .catch((error) => {
                console.error("failed to set telemetry:", error);
            });
    };

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

    const label = telemetryEnabled ? "Telemetry Enabled" : "Telemetry Disabled";

    return (
        <FlexiModal className="tos-modal" ref={modalRef}>
            <OverlayScrollbarsComponent className="modal-inner" options={{ scrollbars: { autoHide: "leave" } }}>
                <header className="modal-header tos-header unselectable">
                    <div className="logo">
                        <Logo />
                    </div>
                    <div className="modal-title">Welcome to Wave Terminal</div>
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
                            <a target="_blank" href="https://discord.gg/XfvZ334gwU" rel={"noopener"}>
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
                                We collect minimal anonymous{" "}
                                <a
                                    target="_blank"
                                    href="https://docs.waveterm.dev/reference/telemetry"
                                    rel={"noopener"}
                                >
                                    telemetry data
                                </a>{" "}
                                to help us understand how people are using Wave (
                                <a
                                    className="plain-link"
                                    target="_blank"
                                    href="https://waveterm.dev/privacy"
                                    rel="noopener"
                                >
                                    Privacy Policy
                                </a>
                                ).
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
                </footer>
            </OverlayScrollbarsComponent>
        </FlexiModal>
    );
};

TosModal.displayName = "TosModal";

export { TosModal };
