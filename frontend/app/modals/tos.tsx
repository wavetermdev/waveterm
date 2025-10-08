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
            <header className="flex flex-col gap-2 border-b-0 p-0 mb-9 w-full unselectable">
                <div className="mb-2.5 flex justify-center">
                    <Logo />
                </div>
                <div className="text-center text-[25px] font-normal text-foreground">Welcome to Wave Terminal</div>
            </header>
            <div className="flex flex-col items-start gap-8 w-full mb-5 unselectable">
                <div className="flex w-full items-center gap-[18px]">
                    <div>
                        <a target="_blank" href="https://github.com/wavetermdev/waveterm" rel={"noopener"}>
                            <i className="text-[32px] text-white/50 fa-brands fa-github"></i>
                        </a>
                    </div>
                    <div className="flex flex-col items-start gap-1 flex-1">
                        <div className="text-foreground text-base leading-[18px] mb-1.5">Support us on GitHub</div>
                        <div className="text-secondary leading-5">
                            We're <i>open source</i> and committed to providing a free terminal for individual users.
                            Please show your support by giving us a star on{" "}
                            <a target="_blank" href="https://github.com/wavetermdev/waveterm" rel={"noopener"}>
                                Github&nbsp;(wavetermdev/waveterm)
                            </a>
                        </div>
                    </div>
                </div>
                <div className="flex w-full items-center gap-[18px]">
                    <div>
                        <a target="_blank" href="https://discord.gg/XfvZ334gwU" rel={"noopener"}>
                            <i className="text-[25px] text-white/50 fa-solid fa-people-group"></i>
                        </a>
                    </div>
                    <div className="flex flex-col items-start gap-1 flex-1">
                        <div className="text-foreground text-base leading-[18px] mb-1.5">Join our Community</div>
                        <div className="text-secondary leading-5">
                            Get help, submit feature requests, report bugs, or just chat with fellow terminal
                            enthusiasts.
                            <br />
                            <a target="_blank" href="https://discord.gg/XfvZ334gwU" rel={"noopener"}>
                                Join the Wave&nbsp;Discord&nbsp;Channel
                            </a>
                        </div>
                    </div>
                </div>
                <div className="flex w-full items-center gap-[18px]">
                    <div>
                        <i className="text-[32px] text-white/50 fa-solid fa-chart-line"></i>
                    </div>
                    <div className="flex flex-col items-start gap-1 flex-1">
                        <div className="text-foreground text-base leading-[18px] mb-1.5">Telemetry</div>
                        <div className="text-secondary leading-5">
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
                <div className="flex flex-row items-center justify-center [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm [&>button:not(:first-child)]:ml-2.5">
                    <Button className="font-[600]" onClick={acceptTos}>
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
            <header className="flex flex-col gap-2 border-b-0 p-0 mb-9 w-full unselectable">
                <div className="mb-2.5 flex justify-center">
                    <Logo />
                </div>
                <div className="text-center text-[25px] font-normal text-foreground">Icons and Keybindings</div>
            </header>
            <div className="flex flex-col items-start gap-8 w-full mb-5 unselectable">
                <QuickTips />
            </div>
            <footer className="unselectable">
                <div className="flex flex-row items-center justify-center [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm [&>button:not(:first-child)]:ml-2.5">
                    <Button className="font-[600]" onClick={handleGetStarted}>
                        Get Started
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
        if (clientData.tosagreed) {
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
        <FlexiModal className="w-[560px] rounded-[10px] p-0" ref={modalRef}>
            <OverlayScrollbarsComponent
                className="flex flex-col overflow-y-auto p-[30px] w-full"
                options={{ scrollbars: { autoHide: "leave" } }}
            >
                {pageComp}
            </OverlayScrollbarsComponent>
        </FlexiModal>
    );
};

TosModal.displayName = "TosModal";

export { TosModal };
