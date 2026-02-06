// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { EmojiButton } from "@/app/element/emojibutton";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useState } from "react";
import { CurrentOnboardingVersion } from "./onboarding-common";
import { OnboardingFooter } from "./onboarding-features-footer";

export const DurableSessionPage = ({
    onNext,
    onSkip,
    onPrev,
}: {
    onNext: () => void;
    onSkip: () => void;
    onPrev?: () => void;
}) => {
    const [fireClicked, setFireClicked] = useState(false);

    const handleFireClick = () => {
        setFireClicked(!fireClicked);
        if (!fireClicked) {
            RpcApi.RecordTEventCommand(TabRpcClient, {
                event: "onboarding:fire",
                props: {
                    "onboarding:feature": "durable",
                    "onboarding:version": CurrentOnboardingVersion,
                },
            });
        }
    };

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center gap-4 mb-6 w-full unselectable flex-shrink-0">
                <div>
                    <Logo />
                </div>
                <div className="text-[25px] font-normal text-foreground">Durable SSH Sessions</div>
            </header>
            <div className="flex-1 flex flex-row gap-0 min-h-0">
                <div className="flex-1 flex flex-col items-center justify-center gap-8 pr-6 unselectable">
                    <div className="flex flex-col items-start gap-6 max-w-md">
                        <div className="flex h-[52px] ml-[-4px] pl-3 pr-4 items-center rounded-lg bg-hover text-[18px]">
                            <i className="fa-sharp fa-solid fa-shield text-sky-500" />
                            <span className="font-bold ml-2 text-primary">Your SSH Sessions, Protected</span>
                        </div>

                        <div className="flex flex-col items-start gap-4 text-secondary">
                            <p>Close your laptop, switch networks, restart Wave — your remote sessions keep running.</p>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa-sharp fa-solid fa-link text-accent text-lg mt-1 flex-shrink-0" />
                                <p>Shell state, running programs, and terminal history are all preserved</p>
                            </div>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa-sharp fa-solid fa-rotate text-accent text-lg mt-1 flex-shrink-0" />
                                <p>Sessions automatically reconnect when your connection is restored</p>
                            </div>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa-sharp fa-solid fa-box text-accent text-lg mt-1 flex-shrink-0" />
                                <p>Buffered output streams back in — you never miss a line</p>
                            </div>

                            <p className="italic">
                                All the persistence of tmux, built into your terminal. Look for the shield icon to
                                enable durability on any SSH session.
                            </p>

                            <EmojiButton emoji="🔥" isClicked={fireClicked} onClick={handleFireClick} />
                        </div>
                    </div>
                </div>
                <div className="w-[2px] bg-border flex-shrink-0"></div>
                <div className="flex items-center justify-center pl-6 flex-shrink-0 w-[400px]">
                    <div className="flex flex-col gap-6 text-secondary">
                        <div className="text-lg font-semibold text-foreground">Session States</div>

                        <div className="flex items-start gap-3">
                            <i className="fa-sharp fa-solid fa-shield text-sky-500 text-xl mt-0.5" />
                            <div>
                                <div className="font-semibold text-foreground">Attached</div>
                                <div className="text-sm">Session is protected and connected</div>
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <i className="fa-sharp fa-solid fa-shield text-sky-300 text-xl mt-0.5" />
                            <div>
                                <div className="font-semibold text-foreground">Detached</div>
                                <div className="text-sm">Session running, currently disconnected</div>
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <i className="fa-sharp fa-regular fa-shield text-muted text-xl mt-0.5" />
                            <div>
                                <div className="font-semibold text-foreground">Standard</div>
                                <div className="text-sm">Connection drops will end the session</div>
                            </div>
                        </div>

                        <div className="mt-4 p-4 bg-hover rounded-lg border border-border/50">
                            <div className="text-sm">
                                <div className="font-semibold text-foreground mb-2">Common use cases:</div>
                                <ul className="space-y-1.5 ml-2">
                                    <li>• Alternative to tmux or screen</li>
                                    <li>• Long-running builds and deployments</li>
                                    <li>• Working from unstable networks</li>
                                    <li>• Surviving Wave restarts</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <OnboardingFooter currentStep={2} totalSteps={4} onNext={onNext} onPrev={onPrev} onSkip={onSkip} />
        </div>
    );
};
