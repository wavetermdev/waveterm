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

const UpgradeOnboardingModal_v0_12_1 = () => {
    const modalRef = useRef<HTMLDivElement | null>(null);
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

    return (
        <FlexiModal className={`w-[600px] rounded-[10px] ${paddingClass} relative overflow-hidden`} ref={modalRef}>
            <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.25] via-transparent to-accent/[0.05] pointer-events-none rounded-[10px]" />
            <div className="flex flex-col w-full h-full relative z-10">
                <div className="flex flex-col h-full">
                    <header className="flex flex-col gap-2 border-b-0 p-0 mt-1 mb-6 w-full unselectable flex-shrink-0">
                        <div className="flex justify-center">
                            <Logo />
                        </div>
                        <div className="text-center text-[25px] font-normal text-foreground">Wave v0.12.1 Update</div>
                    </header>
                    <OverlayScrollbarsComponent
                        className="flex-1 overflow-y-auto min-h-0"
                        options={{ scrollbars: { autoHide: "never" } }}
                    >
                        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
                            <div className="text-secondary leading-relaxed">
                                <p className="mb-0">
                                    Patch release focused on shell integration improvements, Wave AI enhancements, and
                                    restoring syntax highlighting in code editor blocks.
                                </p>
                            </div>

                            <div className="flex w-full items-start gap-4">
                                <div className="flex-shrink-0">
                                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                                </div>
                                <div className="flex flex-col items-start gap-2 flex-1">
                                    <div className="text-foreground text-base font-semibold leading-[18px]">
                                        Shell Integration & Context
                                    </div>
                                    <div className="text-secondary leading-5">
                                        <ul className="list-disc list-outside space-y-1 pl-5">
                                            <li>
                                                <strong>OSC 7 Support</strong> - Wave now automatically tracks and
                                                restores your current directory across restarts for bash, zsh, fish, and
                                                pwsh shells
                                            </li>
                                            <li>
                                                <strong>Shell Context Tracking</strong> - Tracks when your shell is
                                                ready, last command executed, and exit codes for better terminal
                                                management
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            <div className="flex w-full items-start gap-4">
                                <div className="flex-shrink-0">
                                    <i className="text-[24px] text-accent fa-solid fa-sparkles"></i>
                                </div>
                                <div className="flex flex-col items-start gap-2 flex-1">
                                    <div className="text-foreground text-base font-semibold leading-[18px]">
                                        Wave AI Improvements
                                    </div>
                                    <div className="text-secondary leading-5">
                                        <ul className="list-disc list-outside space-y-1 pl-5">
                                            <li>Display reasoning summaries while waiting for AI responses</li>
                                            <li>
                                                Enhanced terminal context - AI now has access to shell state, current
                                                directory, command history, and exit codes
                                            </li>
                                            <li>Added feedback buttons (thumbs up/down) for AI responses</li>
                                            <li>Added copy button to easily copy AI responses to clipboard</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            <div className="flex w-full items-start gap-4">
                                <div className="flex-shrink-0">
                                    <i className="text-[24px] text-accent fa-solid fa-wrench"></i>
                                </div>
                                <div className="flex flex-col items-start gap-2 flex-1">
                                    <div className="text-foreground text-base font-semibold leading-[18px]">
                                        Other Changes
                                    </div>
                                    <div className="text-secondary leading-5">
                                        <ul className="list-disc list-outside space-y-1 pl-5">
                                            <li>Mobile user agent emulation support for web widgets</li>
                                            <li>Fixed padding for header buttons in code editor</li>
                                            <li>Restored syntax highlighting in code editor preview blocks</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </OverlayScrollbarsComponent>
                    <footer className="unselectable flex-shrink-0 mt-4">
                        <div className="flex flex-row items-center justify-center [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm">
                            <Button className="font-[600]" onClick={handleClose}>
                                Continue
                            </Button>
                        </div>
                    </footer>
                </div>
            </div>
        </FlexiModal>
    );
};

UpgradeOnboardingModal_v0_12_1.displayName = "UpgradeOnboardingModal_v0_12_1";

export { UpgradeOnboardingModal_v0_12_1 };
