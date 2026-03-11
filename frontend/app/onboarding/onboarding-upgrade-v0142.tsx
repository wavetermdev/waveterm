// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const UpgradeOnboardingModal_v0_14_2_Content = () => {
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">
                    Wave v0.14.2 introduces a new block badge system for at-a-glance status, along with directory
                    preview improvements and bug fixes.
                </p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-bell"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Block &amp; Tab Badges</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Block Badges Roll Up to Tabs</strong> - Blocks can display icon badges (with
                                color and priority) that are visible in the tab bar for at-a-glance status
                            </li>
                            <li>
                                <strong>Bell Indicator On by Default</strong> - Terminal bell badge now lights up the
                                block and tab when your terminal rings (controlled by <code>term:bellindicator</code>)
                            </li>
                            <li>
                                <strong>
                                    <code>wsh badge</code>
                                </strong>{" "}
                                - New command to set or clear badges from the CLI. Supports icons, colors, priorities,
                                and PID-linked badges
                            </li>
                            <li>
                                <strong>Claude Code Integration</strong> - Use <code>wsh badge</code> with Claude Code
                                hooks to surface AI task status as tab bar notifications
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-folder-open"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Other Changes</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>Directory Preview</strong> - Improved mod time formatting, zebra-striped rows,
                                better default sort, and YAML file support
                            </li>
                            <li>
                                <strong>Search Bar</strong> - Clipboard and focus improvements
                            </li>
                            <li>[bugfix] Fixed "New Window" hanging on GNOME desktops</li>
                            <li>[bugfix] Fixed "Save Session As..." focused window tracking bug</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_2_Content.displayName = "UpgradeOnboardingModal_v0_14_2_Content";

export { UpgradeOnboardingModal_v0_14_2_Content };
