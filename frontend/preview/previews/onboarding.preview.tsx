// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { InitPage, NoTelemetryStarPage } from "@/app/onboarding/onboarding";
import { DurableSessionPage } from "@/app/onboarding/onboarding-durable";
import { FilesPage, MagnifyBlocksPage, WaveAIPage } from "@/app/onboarding/onboarding-features";
import { UpgradeOnboardingVersions } from "@/app/onboarding/onboarding-upgrade-patch";

function OnboardingFeaturesV() {
    const noop = () => {};
    return (
        <div className="flex flex-col w-full gap-8">
            <div className="w-[560px] rounded-[10px] p-[30px] relative overflow-hidden bg-panel">
                <InitPage isCompact={false} telemetryUpdateFn={async () => {}} />
            </div>
            <div className="w-[560px] rounded-[10px] p-[30px] relative overflow-hidden bg-panel">
                <NoTelemetryStarPage isCompact={false} />
            </div>
            <div className="w-[800px] rounded-[10px] p-[30px] relative overflow-hidden bg-panel">
                <WaveAIPage onNext={noop} onSkip={noop} />
            </div>
            <div className="w-[800px] rounded-[10px] p-[30px] relative overflow-hidden bg-panel">
                <DurableSessionPage onNext={noop} onSkip={noop} onPrev={noop} />
            </div>
            <div className="w-[800px] rounded-[10px] p-[30px] relative overflow-hidden bg-panel">
                <MagnifyBlocksPage onNext={noop} onSkip={noop} onPrev={noop} />
            </div>
            <div className="w-[800px] rounded-[10px] p-[30px] relative overflow-hidden bg-panel">
                <FilesPage onFinish={noop} onPrev={noop} />
            </div>
        </div>
    );
}

function UpgradeOnboardingPatchV() {
    return (
        <div className="flex flex-col gap-6 w-full max-w-[900px]">
            {UpgradeOnboardingVersions.map((version) => (
                <div
                    key={version.version}
                    className="w-[650px] rounded-[10px] p-[30px] relative overflow-hidden bg-panel"
                >
                    <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.25] via-transparent to-accent/[0.05] pointer-events-none rounded-[10px]" />
                    <div className="flex flex-col w-full h-full relative z-10">
                        <header className="flex flex-col gap-2 border-b-0 p-0 mt-1 mb-6 w-full unselectable flex-shrink-0">
                            <div className="flex justify-center">
                                <Logo />
                            </div>
                            <div className="text-center text-[25px] font-normal text-foreground">
                                Wave {version.version} Update
                            </div>
                        </header>
                        <div className="flex-1">{version.content()}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}

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
