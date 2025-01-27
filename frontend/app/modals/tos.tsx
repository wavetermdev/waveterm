// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { Button } from "@/app/element/button";
import { Toggle } from "@/app/element/toggle";
import * as services from "@/store/services";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useEffect, useRef, useState } from "react";
import { FlexiModal } from "./modal";

import { QuickTips } from "@/app/element/quicktips";
import { atoms, getApi } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { fireAndForget } from "@/util/util";
import { atom, PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from "jotai";
import "./tos.scss";

const pageNumAtom: PrimitiveAtom<number> = atom<number>(1);

const ModalPage1 = () => {
    const settings = useAtomValue(atoms.settingsAtom);
    const clientData = useAtomValue(atoms.client);
    const [telemetryEnabled, setTelemetryEnabled] = useState<boolean>(!!settings["telemetry:enabled"]);
    const setPageNum = useSetAtom(pageNumAtom);

    const acceptTos = () => {
        if (!clientData.tosagreed) {
            fireAndForget(services.ClientService.AgreeTos);
        }
        setPageNum(2);
    };

    const setTelemetry = (value: boolean) => {
        fireAndForget(() =>
            services.ClientService.TelemetryUpdate(value).then(() => {
                setTelemetryEnabled(value);
            })
        );
    };

    const label = telemetryEnabled ? "Telemetry Enabled" : "Telemetry Disabled";

    return (
        <>
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
                            We're <i>open source</i> and committed to providing a free terminal for individual users.
                            Please show your support by giving us a star on{" "}
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
                            <a target="_blank" href="https://docs.waveterm.dev/telemetry" rel={"noopener"}>
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
                        Continue
                    </Button>
                </div>
            </footer>
        </>
    );
};

const ModalPage2 = () => {
    const [tosOpen, setTosOpen] = useAtom(modalsModel.tosOpen);

    const handleGetStarted = () => {
        setTosOpen(false);
    };

    return (
        <>
            <header className="modal-header tos-header unselectable">
                <div className="logo">
                    <Logo />
                </div>
                <div className="modal-title">Icons and Keybindings</div>
            </header>
            <div className="modal-content tos-content unselectable">
                <QuickTips />
            </div>
            <footer className="unselectable">
                <div className="button-wrapper">
                    <Button className="font-weight-600" onClick={handleGetStarted}>
                        Get Started
                    </Button>
                </div>
            </footer>
        </>
    );
};

const ModalPageLegacy = () => {
    const setPageNum = useSetAtom(pageNumAtom);
    const handleContinue = () => {
        setPageNum(1);
    };
    const handleDownloadLegacy = () => {
        getApi().openExternal("https://waveterm.dev/download-legacy?ref=v7upgrade");
    };
    return (
        <>
            <header className="modal-header tos-header unselectable">
                <div className="logo">
                    <Logo />
                </div>
                <div className="modal-title">Welcome to Wave v0.9</div>
            </header>
            <div className="modal-content tos-content unselectable">
                <div className="item">
                    We’re excited to announce the release of Wave Terminal v0.9. This update introduces a brand-new
                    layout engine, featuring drag-and-drop screen splitting with flexible block sizing and positioning.
                    We've also integrated powerful tools like file previews, an editor, web integration, and AI, all
                    designed to keep you focused and minimize context switching. And for the first time, Wave Terminal
                    runs <b>natively on Windows</b>!
                </div>
                <div>
                    Wave v0.9 is less opinionated, giving you the freedom to use your standard terminal prompt and
                    command completions, while supporting all shells (not just bash/zsh). We've also improved
                    compatibility with ohmyzsh packages, removing some of the friction users experienced. It’s faster,
                    more performant, and provides a stronger foundation for you to build your own blocks and widgets in
                    the future.
                </div>
                <div className="item">
                    The new build is a fresh start, and a clean break from the current version. As such, your history,
                    settings, and configuration will <i>not</i> be carried over. If you'd like to continue to run the
                    legacy version, you will need to download it separately.
                </div>
            </div>
            <footer className="unselectable">
                <div className="button-wrapper">
                    <Button className="outlined grey" onClick={handleDownloadLegacy}>
                        Download WaveLegacy
                    </Button>

                    <Button className="font-weight-600" onClick={handleContinue}>
                        Continue
                    </Button>
                </div>
            </footer>
        </>
    );
};

const TosModal = () => {
    const modalRef = useRef<HTMLDivElement | null>(null);
    const [pageNum, setPageNum] = useAtom(pageNumAtom);
    const clientData = useAtomValue(atoms.client);

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
        // on unmount, always reset pagenum
        if (!clientData.tosagreed && clientData.hasoldhistory) {
            setPageNum(0);
        } else if (clientData.tosagreed) {
            setPageNum(2);
        }
        return () => {
            setPageNum(1);
        };
    }, []);

    useEffect(() => {
        updateModalHeight(); // Run on initial render

        window.addEventListener("resize", updateModalHeight); // Run on window resize
        return () => {
            window.removeEventListener("resize", updateModalHeight);
        };
    }, []);
    let pageComp: React.JSX.Element = null;
    switch (pageNum) {
        case 0:
            pageComp = <ModalPageLegacy />;
            break;
        case 1:
            pageComp = <ModalPage1 />;
            break;
        case 2:
            pageComp = <ModalPage2 />;
            break;
    }
    if (pageComp == null) {
        return null;
    }
    return (
        <FlexiModal className="tos-modal" ref={modalRef}>
            <OverlayScrollbarsComponent className="modal-inner" options={{ scrollbars: { autoHide: "leave" } }}>
                {pageComp}
            </OverlayScrollbarsComponent>
        </FlexiModal>
    );
};

TosModal.displayName = "TosModal";

export { TosModal };
