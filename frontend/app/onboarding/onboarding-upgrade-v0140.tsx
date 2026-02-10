// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const UpgradeOnboardingModal_v0_14_0_Content = () => {
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">
                    Wave v0.14 introduces Durable Sessions for SSH connections, enhanced connection monitoring, and major
                    improvements to RPC infrastructure and terminal capabilities.
                </p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-sky-500 fa-sharp fa-solid fa-shield"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        Durable SSH Sessions
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Survive Interruptions</strong> - SSH sessions persist through network changes,
                                computer sleep, and Wave restarts
                            </li>
                            <li>
                                <strong>Session Protection</strong> - Shell state, running programs, and terminal history
                                are maintained even when disconnected
                            </li>
                            <li>
                                <strong>Visual Status Indicators</strong> - Shield icons show session status (Standard,
                                Durable Attached, Durable Detached, Durable Awaiting)
                            </li>
                            <li>
                                <strong>Flexible Configuration</strong> - Configure at global, per-connection, or
                                per-block level
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-network-wired"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        Enhanced Connection Monitoring
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Connection Keepalives</strong> - Active monitoring with automatic keepalive
                                probes
                            </li>
                            <li>
                                <strong>Stalled Connection Detection</strong> - Clear visual feedback when network issues
                                occur
                            </li>
                            <li>
                                <strong>Better Error Handling</strong> - Improved connection status tracking and
                                indicators
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Terminal Improvements</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>OSC 52 Clipboard Support</strong> - Terminal applications can copy directly to
                                system clipboard
                            </li>
                            <li>
                                <strong>Enhanced Context Menu</strong> - Quick access to splits, URL opening, themes,
                                and more
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
                    <div className="text-foreground text-base font-semibold leading-[18px]">Wave AI Updates</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Image/Vision Support</strong> - Added image support for OpenAI chat completions
                                API
                            </li>
                            <li>
                                <strong>Stop Generation</strong> - Ability to stop AI responses mid-generation across
                                OpenAI and Gemini
                            </li>
                            <li>
                                <strong>Improved Auto-scrolling</strong> - Better scroll behavior in Wave AI panel
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sliders"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Other Improvements</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>RPC Streaming with Flow Control</strong> - Better performance and reliability
                            </li>
                            <li>
                                <strong>Confirm on Quit</strong> - Confirmation dialog when closing Wave with active
                                sessions
                            </li>
                            <li>
                                <strong>Monaco Editor Upgrade</strong> - Improved performance and stability
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_0_Content.displayName = "UpgradeOnboardingModal_v0_14_0_Content";

export { UpgradeOnboardingModal_v0_14_0_Content };
