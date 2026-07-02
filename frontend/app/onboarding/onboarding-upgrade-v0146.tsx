// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const UpgradeOnboardingModal_v0_14_6_Content = () => {
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">
                    Wave v0.14.6 is a patch release focused on terminal input reliability and packaging safeguards.
                </p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-keyboard"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">IME Input Fixes</div>
                    <div className="text-secondary leading-5">
                        Korean IME composition now preserves the correct ordering when pressing Enter before a final
                        consonant is committed. This also avoids intermittent duplicated input when switching between
                        English and Korean input modes.
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-sharp fa-solid fa-box"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">Packaging Validation</div>
                    <div className="text-secondary leading-5">
                        Release packaging now fails early if required Wave backend binaries are missing from the
                        packaged app, preventing broken installers from being published.
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_6_Content.displayName = "UpgradeOnboardingModal_v0_14_6_Content";

export { UpgradeOnboardingModal_v0_14_6_Content };
