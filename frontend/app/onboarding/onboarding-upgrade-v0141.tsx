// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const UpgradeOnboardingModal_v0_14_1_Content = () => {
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">
                    Wave v0.14.1 fixes several high-impact terminal bugs and adds new config options for focus, cursor
                    style, and block navigation.
                </p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Terminal Fixes</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Claude Code Scroll Fix</strong> - Fixed unexpected terminal scroll jumps
                            </li>
                            <li>
                                <strong>IME Fix</strong> - Fixed Korean/CJK input losing or sticking characters
                            </li>
                            <li>
                                <strong>Scroll Position on Resize</strong> - Terminal stays at bottom across resizes
                            </li>
                            <li>
                                <strong>Terminal Scrollback Save</strong> - New context menu item and{" "}
                                <code>wsh</code> command to save scrollback to a file
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
                    <div className="text-foreground text-base font-semibold leading-[18px]">New Config Options</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Focus Follows Cursor</strong> - New <code>app:focusfollowscursor</code> setting
                                (off/on/term)
                            </li>
                            <li>
                                <strong>Terminal Cursor Style &amp; Blink</strong> - Configure cursor shape and blink
                                per-block
                            </li>
                            <li>
                                <strong>Vim-Style Block Navigation</strong> - Ctrl+Shift+H/J/K/L to navigate blocks
                            </li>
                            <li>
                                <strong>New AI Providers</strong> - Added Groq and NanoGPT as built-in presets
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_1_Content.displayName = "UpgradeOnboardingModal_v0_14_1_Content";

export { UpgradeOnboardingModal_v0_14_1_Content };
