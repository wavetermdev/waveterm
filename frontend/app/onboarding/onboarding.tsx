// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { Button } from "@/app/element/button";
import { Toggle } from "@/app/element/toggle";
import { FlexiModal } from "@/app/modals/modal";
import { disableGlobalKeybindings, enableGlobalKeybindings, globalRefocus } from "@/app/store/keymodel";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import * as services from "@/store/services";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useEffect, useRef, useState } from "react";
import { debounce } from "throttle-debounce";

import { OnboardingFeatures } from "@/app/onboarding/onboarding-features";
import { atoms, globalStore } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from "jotai";

// Page flow:
//   init -> (telemetry enabled) -> features
//   init -> (telemetry disabled) -> notelemetrystar -> features

type PageName = "init" | "notelemetrystar" | "features";

const pageNameAtom: PrimitiveAtom<PageName> = atom<PageName>("init");

const InitPage = ({ isCompact }: { isCompact: boolean }) => {
    const settings = useAtomValue(atoms.settingsAtom);
    const clientData = useAtomValue(atoms.client);
    const [telemetryEnabled, setTelemetryEnabled] = useState<boolean>(!!settings["telemetry:enabled"]);
    const setPageName = useSetAtom(pageNameAtom);

    const acceptTos = () => {
        if (!clientData.tosagreed) {
            fireAndForget(services.ClientService.AgreeTos);
        }
        if (telemetryEnabled) {
            WorkspaceLayoutModel.getInstance().setAIPanelVisible(true);
        }
        setPageName(telemetryEnabled ? "features" : "notelemetrystar");
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
        <div className="flex flex-col h-full">
            <header
                className={`flex flex-col gap-2 border-b-0 p-0 ${isCompact ? "mt-1 mb-4" : "mb-9"} w-full unselectable flex-shrink-0`}
            >
                <div className={`${isCompact ? "" : "mb-2.5"} flex justify-center`}>
                    <Logo />
                </div>
                <div className="text-center text-[25px] font-normal text-foreground">Welcome to Wave Terminal</div>
            </header>
            <OverlayScrollbarsComponent
                className="flex-1 overflow-y-auto min-h-0"
                options={{ scrollbars: { autoHide: "never" } }}
            >
                <div className="flex flex-col items-start gap-8 w-full mb-5 unselectable">
                    <div className="flex w-full items-center gap-[18px]">
                        <div>
                            <a target="_blank" href="https://github.com/wavetermdev/waveterm" rel={"noopener"}>
                                <i className="text-[32px] text-white/50 fa-brands fa-github"></i>
                            </a>
                        </div>
                        <div className="flex flex-col items-start gap-1 flex-1">
                            <div className="text-foreground text-base leading-[18px]">Support us on GitHub</div>
                            <div className="text-secondary leading-5">
                                We're <i>open source</i> and committed to providing a free terminal for individual
                                users. Please show your support by giving us a star on{" "}
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
                            <div className="text-foreground text-base leading-[18px]">Join our Community</div>
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
                            <div className="text-foreground text-base leading-[18px]">Telemetry</div>
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
            </OverlayScrollbarsComponent>
            <footer className={`unselectable flex-shrink-0 ${isCompact ? "mt-2" : "mt-5"}`}>
                <div className="flex flex-row items-center justify-center [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm [&>button:not(:first-child)]:ml-2.5">
                    <Button className="font-[600]" onClick={acceptTos}>
                        Continue
                    </Button>
                </div>
            </footer>
        </div>
    );
};

const NoTelemetryStarPage = ({ isCompact }: { isCompact: boolean }) => {
    const setPageName = useSetAtom(pageNameAtom);

    const handleStarClick = async () => {
        const clientId = globalStore.get(atoms.clientId);
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:githubstar": true },
        });
        window.open("https://github.com/wavetermdev/waveterm", "_blank");
        setPageName("features");
    };

    const handleMaybeLater = async () => {
        const clientId = globalStore.get(atoms.clientId);
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:githubstar": false },
        });
        setPageName("features");
    };

    return (
        <div className="flex flex-col h-full">
            <header className={`flex flex-col gap-2 border-b-0 p-0 mt-1 mb-4 w-full unselectable flex-shrink-0`}>
                <div className={`flex justify-center`}>
                    <Logo />
                </div>
                <div className="text-center text-[25px] font-normal text-foreground">Telemetry Disabled ✓</div>
            </header>
            <OverlayScrollbarsComponent
                className="flex-1 overflow-y-auto min-h-0"
                options={{ scrollbars: { autoHide: "never" } }}
            >
                <div className="flex flex-col items-center gap-6 w-full mb-2 unselectable">
                    <div className="text-center text-secondary leading-relaxed max-w-md">
                        <p className="mb-4">No problem, we respect your privacy.</p>
                        <p className="mb-4">
                            But, without usage data, we're flying blind. A GitHub star helps us know Wave is useful and
                            worth maintaining.
                        </p>
                    </div>
                </div>
            </OverlayScrollbarsComponent>
            <footer className={`unselectable flex-shrink-0 mt-2`}>
                <div className="flex flex-row items-center justify-center gap-2.5 [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm [&>button]:!h-[37px]">
                    <Button className="outlined green font-[600]" onClick={handleStarClick}>
                        ⭐ Star on GitHub
                    </Button>
                    <Button className="outlined grey font-[600]" onClick={handleMaybeLater}>
                        Maybe Later
                    </Button>
                </div>
            </footer>
        </div>
    );
};

const FeaturesPage = () => {
    const [tosOpen, setTosOpen] = useAtom(modalsModel.tosOpen);

    const handleComplete = () => {
        setTosOpen(false);
        setTimeout(() => {
            globalRefocus();
        }, 10);
    };

    return <OnboardingFeatures onComplete={handleComplete} />;
};

const OnboardingModal = () => {
    const modalRef = useRef<HTMLDivElement | null>(null);
    const [pageName, setPageName] = useAtom(pageNameAtom);
    const clientData = useAtomValue(atoms.client);
    const [isCompact, setIsCompact] = useState<boolean>(window.innerHeight < 800);

    const updateModalHeight = () => {
        const windowHeight = window.innerHeight;
        setIsCompact(windowHeight < 800);
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
        if (clientData.tosagreed) {
            setPageName("features");
        }
        return () => {
            setPageName("init");
        };
    }, []);

    useEffect(() => {
        updateModalHeight();
        const debouncedUpdateModalHeight = debounce(150, updateModalHeight);
        window.addEventListener("resize", debouncedUpdateModalHeight);
        return () => {
            window.removeEventListener("resize", debouncedUpdateModalHeight);
        };
    }, []);

    useEffect(() => {
        disableGlobalKeybindings();
        return () => {
            enableGlobalKeybindings();
        };
    }, []);

    let pageComp: React.JSX.Element = null;
    switch (pageName) {
        case "init":
            pageComp = <InitPage isCompact={isCompact} />;
            break;
        case "notelemetrystar":
            pageComp = <NoTelemetryStarPage isCompact={isCompact} />;
            break;
        case "features":
            pageComp = <FeaturesPage />;
            break;
    }
    if (pageComp == null) {
        return null;
    }

    const paddingClass = isCompact ? "!py-3 !px-[30px]" : "!p-[30px]";
    const widthClass = pageName === "features" ? "w-[800px]" : "w-[560px]";

    return (
        <FlexiModal className={`${widthClass} rounded-[10px] ${paddingClass}`} ref={modalRef}>
            <div className="flex flex-col w-full h-full">{pageComp}</div>
        </FlexiModal>
    );
};

OnboardingModal.displayName = "OnboardingModal";

export { OnboardingModal };
