// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { Button } from "@/app/element/button";
import { FlexiModal } from "@/app/modals/modal";
import { CurrentOnboardingVersion } from "@/app/onboarding/onboarding-common";
import { OnboardingFeatures } from "@/app/onboarding/onboarding-features";
import { GlobalModel } from "@/app/store/global-model";
import { atoms, globalStore } from "@/app/store/global";
import { disableGlobalKeybindings, enableGlobalKeybindings, globalRefocus } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useEffect, useRef, useState } from "react";
import { debounce } from "throttle-debounce";

const UpgradeOnboardingMinor = () => {
    const modalRef = useRef<HTMLDivElement | null>(null);
    const [pageName, setPageName] = useState<"welcome" | "features">("welcome");
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

    const handleStarClick = async () => {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "onboarding:githubstar",
                props: { "onboarding:githubstar": "star" },
            },
            { noresponse: true }
        );
        const clientId = GlobalModel.getInstance().clientId;
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:githubstar": true },
        });
        window.open("https://github.com/wavetermdev/waveterm?ref=upgrade", "_blank");
        setPageName("features");
    };

    const handleAlreadyStarred = async () => {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "onboarding:githubstar",
                props: { "onboarding:githubstar": "already" },
            },
            { noresponse: true }
        );
        const clientId = GlobalModel.getInstance().clientId;
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:githubstar": true },
        });
        setPageName("features");
    };

    const handleMaybeLater = async () => {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "onboarding:githubstar",
                props: { "onboarding:githubstar": "later" },
            },
            { noresponse: true }
        );
        const clientId = GlobalModel.getInstance().clientId;
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:githubstar": false },
        });
        setPageName("features");
    };

    const handleFeaturesComplete = () => {
        const clientId = GlobalModel.getInstance().clientId;
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:lastversion": CurrentOnboardingVersion },
        });
        globalStore.set(modalsModel.upgradeOnboardingOpen, false);
        setTimeout(() => {
            globalRefocus();
        }, 10);
    };

    let pageComp: React.JSX.Element = null;
    if (pageName === "welcome") {
        pageComp = (
            <div className="flex flex-col h-full">
                <header className="flex flex-col gap-2 border-b-0 p-0 mt-1 mb-4 w-full unselectable flex-shrink-0">
                    <div className="flex justify-center">
                        <Logo />
                    </div>
                    <div className="text-center text-[25px] font-normal text-foreground">Welcome to Wave v0.13!</div>
                </header>
                <OverlayScrollbarsComponent
                    className="flex-1 overflow-y-auto min-h-0"
                    options={{ scrollbars: { autoHide: "never" } }}
                >
                    <div className="flex flex-col items-center gap-3 w-full mb-2 unselectable">
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="flex h-[52px] px-3 items-center rounded-lg bg-hover text-accent text-[24px]">
                                <i className="fa fa-sparkles" />
                                <span className="font-bold ml-2 font-mono">Wave AI</span>
                            </div>
                            <div className="text-secondary leading-relaxed max-w-[600px]">
                                <p className="mb-4">
                                    Wave AI is your terminal assistant with full context. It can read your terminal
                                    output, analyze widgets, read and write files, and help you solve
                                    problems&nbsp;faster.
                                </p>
                                <p className="mb-4">
                                    <span className="font-semibold text-foreground">New in v0.13:</span> Wave AI now
                                    supports local models and bring-your-own-key! Use Ollama, LM Studio, vLLM,
                                    OpenRouter, or any OpenAI-compatible provider.
                                </p>
                                <p className="py-3 px-2 border border-border rounded-md bg-hover/30">
                                    Wave AI is in beta with included AI credits while we refine the experience. We're
                                    actively improving it and would love your feedback in{" "}
                                    <a target="_blank" href="https://discord.gg/XfvZ334gwU" className="hover:underline">
                                        Discord
                                    </a>
                                    .
                                </p>
                            </div>
                        </div>

                        <div className="w-full max-w-[550px] border-t border-border my-2"></div>

                        <div className="flex flex-col items-center gap-3 text-center max-w-[550px]">
                            <div className="text-foreground text-base">Thanks for being an early Wave adopter! ⭐</div>
                            <div className="text-secondary text-sm">
                                A GitHub star shows your support for Wave (and open-source) and helps us reach more
                                developers.
                            </div>
                        </div>
                    </div>
                </OverlayScrollbarsComponent>
                <footer className="unselectable flex-shrink-0 mt-4">
                    <div className="flex flex-row items-center justify-center gap-2.5 [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm [&>button]:!h-[37px]">
                        <Button className="outlined grey font-[600]" onClick={handleAlreadyStarred}>
                            🙏 Already Starred
                        </Button>
                        <Button className="outlined green font-[600]" onClick={handleStarClick}>
                            ⭐ Star Now
                        </Button>
                        <Button className="outlined grey font-[600]" onClick={handleMaybeLater}>
                            Maybe Later
                        </Button>
                    </div>
                </footer>
            </div>
        );
    } else if (pageName === "features") {
        pageComp = <OnboardingFeatures onComplete={handleFeaturesComplete} />;
    }

    if (pageComp == null) {
        return null;
    }

    const paddingClass = isCompact ? "!py-3 !px-[30px]" : "!p-[30px]";
    const widthClass = pageName === "features" ? "w-[800px]" : "w-[600px]";

    return (
        <FlexiModal className={`${widthClass} rounded-[10px] ${paddingClass} relative overflow-hidden`} ref={modalRef}>
            <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.25] via-transparent to-accent/[0.05] pointer-events-none rounded-[10px]" />
            <div className="flex flex-col w-full h-full relative z-10">{pageComp}</div>
        </FlexiModal>
    );
};

UpgradeOnboardingMinor.displayName = "UpgradeOnboardingMinor";

export { UpgradeOnboardingMinor };
