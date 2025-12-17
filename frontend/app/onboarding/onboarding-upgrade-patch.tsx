// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { Button } from "@/app/element/button";
import { FlexiModal } from "@/app/modals/modal";
import { CurrentOnboardingVersion } from "@/app/onboarding/onboarding-common";
import { atoms, globalStore } from "@/app/store/global";
import { disableGlobalKeybindings, enableGlobalKeybindings, globalRefocus } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useEffect, useRef, useState } from "react";
import { debounce } from "throttle-debounce";
import { UpgradeOnboardingModal_v0_12_1_Content } from "./onboarding-upgrade-v0121";
import { UpgradeOnboardingModal_v0_12_2_Content } from "./onboarding-upgrade-v0122";
import { UpgradeOnboardingModal_v0_12_3_Content } from "./onboarding-upgrade-v0123";
import { UpgradeOnboardingModal_v0_13_0_Content } from "./onboarding-upgrade-v0130";
import { UpgradeOnboardingModal_v0_13_1_Content } from "./onboarding-upgrade-v0131";

interface VersionConfig {
    version: string;
    content: () => React.ReactNode;
    prevText?: string;
    nextText?: string;
}

const versions: VersionConfig[] = [
    {
        version: "v0.12.1",
        content: () => <UpgradeOnboardingModal_v0_12_1_Content />,
        nextText: "Next (v0.12.2)",
    },
    {
        version: "v0.12.2",
        content: () => <UpgradeOnboardingModal_v0_12_2_Content />,
        prevText: "Prev (v0.12.1)",
        nextText: "Next (v0.12.3)",
    },
    {
        version: "v0.12.5",
        content: () => <UpgradeOnboardingModal_v0_12_3_Content />,
        prevText: "Prev (v0.12.2)",
        nextText: "Next (v0.13.0)",
    },
    {
        version: "v0.13.0",
        content: () => <UpgradeOnboardingModal_v0_13_0_Content />,
        prevText: "Prev (v0.12.5)",
        nextText: "Next (v0.13.1)",
    },
    {
        version: "v0.13.1",
        content: () => <UpgradeOnboardingModal_v0_13_1_Content />,
        prevText: "Prev (v0.13.0)",
    },
];

const UpgradeOnboardingPatch = () => {
    const modalRef = useRef<HTMLDivElement | null>(null);
    const [isCompact, setIsCompact] = useState<boolean>(window.innerHeight < 800);
    const [currentIndex, setCurrentIndex] = useState<number>(versions.length - 1);

    const currentVersion = versions[currentIndex];
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < versions.length - 1;

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

    const handleClose = () => {
        const clientId = globalStore.get(atoms.clientId);
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:lastversion": CurrentOnboardingVersion },
        });
        globalStore.set(modalsModel.upgradeOnboardingOpen, false);
        setTimeout(() => {
            globalRefocus();
        }, 10);
    };

    const paddingClass = isCompact ? "!py-3 !px-[30px]" : "!p-[30px]";

    const handlePrev = () => {
        if (hasPrev) {
            setCurrentIndex(currentIndex - 1);
        }
    };

    const handleNext = () => {
        if (hasNext) {
            setCurrentIndex(currentIndex + 1);
        }
    };

    return (
        <FlexiModal className={`w-[650px] rounded-[10px] ${paddingClass} relative overflow-hidden`} ref={modalRef}>
            <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.25] via-transparent to-accent/[0.05] pointer-events-none rounded-[10px]" />
            <div className="flex flex-col w-full h-full relative z-10">
                <div className="flex flex-col h-full">
                    <header className="flex flex-col gap-2 border-b-0 p-0 mt-1 mb-6 w-full unselectable flex-shrink-0">
                        <div className="flex justify-center">
                            <Logo />
                        </div>
                        <div className="text-center text-[25px] font-normal text-foreground">
                            Wave {currentVersion.version} Update
                        </div>
                    </header>
                    <OverlayScrollbarsComponent
                        className="flex-1 overflow-y-auto min-h-0"
                        options={{ scrollbars: { autoHide: "never" } }}
                    >
                        {currentVersion.content()}
                    </OverlayScrollbarsComponent>
                    <footer className="unselectable flex-shrink-0 mt-4">
                        <div className="flex flex-row items-center justify-between w-full">
                            <div className="flex-1 flex justify-start">
                                {hasPrev && (
                                    <div className="text-sm text-secondary">
                                        <button
                                            onClick={handlePrev}
                                            className="cursor-pointer hover:text-foreground transition-colors"
                                        >
                                            &lt; {currentVersion.prevText}
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-row items-center justify-center [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm">
                                <Button className="font-[600]" onClick={handleClose}>
                                    Continue
                                </Button>
                            </div>
                            <div className="flex-1 flex justify-end">
                                {hasNext && (
                                    <div className="text-sm text-secondary">
                                        <button
                                            onClick={handleNext}
                                            className="cursor-pointer hover:text-foreground transition-colors"
                                        >
                                            {currentVersion.nextText} &gt;
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </footer>
                </div>
            </div>
        </FlexiModal>
    );
};

UpgradeOnboardingPatch.displayName = "UpgradeOnboardingPatch";

export { UpgradeOnboardingPatch };
