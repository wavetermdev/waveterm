// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { OnboardingFeaturesV } from "@/app/onboarding/onboarding-features";
import { UpgradeOnboardingPatchV } from "@/app/onboarding/onboarding-upgrade-patch";

export function OnboardingPreview() {
    return (
        <div className="w-full max-w-[1300px] py-10 px-4 flex flex-col gap-8">
            <div className="text-sm font-mono text-muted">Onboarding features</div>
            <OnboardingFeaturesV />
            <div className="text-sm font-mono text-muted mt-6">Onboarding patch updates</div>
            <UpgradeOnboardingPatchV />
        </div>
    );
}
