// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const UpgradeOnboardingModal_v0_14_5_Content = () => {
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">
                    Wave v0.14.5 introduces a new Process Viewer widget, Quake Mode for the global hotkey, and several
                    quality-of-life improvements.
                </p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-list-tree"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Process Viewer</div>
                    <div className="text-secondary leading-5">
                        New widget that displays running processes on local and remote machines, with CPU and memory
                        usage and sortable columns.
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Quake Mode</div>
                    <div className="text-secondary leading-5">
                        The global hotkey (<code>app:globalhotkey</code>) now triggers a dedicated quake mode that
                        drops a Wave window down from the top of the screen, similar to classic quake-style terminals.
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-wrench"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Other Changes</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Drag &amp; Drop Files into Terminal</strong> - Drag files from Finder or your
                                file manager into a terminal to paste their quoted path
                            </li>
                            <li>
                                New opt-in <code>app:showsplitbuttons</code> setting adds split buttons to block
                                headers
                            </li>
                            <li>Toggle the widgets sidebar from the View menu</li>
                            <li>F2 to rename the active tab</li>
                            <li>Mouse back/forward buttons now navigate in web widgets</li>
                            <li>
                                <strong>[bugfix]</strong>{" "}Config files that didn&apos;t exist yet couldn&apos;t be
                                created or edited from the Settings widget
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_5_Content.displayName = "UpgradeOnboardingModal_v0_14_5_Content";

export { UpgradeOnboardingModal_v0_14_5_Content };
