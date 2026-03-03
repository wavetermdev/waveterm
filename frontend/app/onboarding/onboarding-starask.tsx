// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { Button } from "@/app/element/button";
import { OnboardingGradientBg } from "@/app/onboarding/onboarding-common";

type StarAskPageProps = {
    onStarClick: () => void;
    onAlreadyStarred: () => void;
    onMaybeLater: () => void;
};

export function StarAskPage({ onStarClick, onAlreadyStarred, onMaybeLater }: StarAskPageProps) {
    return (
        <div className="flex flex-col h-full">
            <header className="flex flex-col gap-2 border-b-0 p-0 mt-1 mb-6 w-full unselectable flex-shrink-0">
                <div className="flex justify-center">
                    <Logo />
                </div>
                <div className="text-center text-[25px] font-normal text-foreground">Support Wave on GitHub ⭐</div>
            </header>
            <div className="flex-1 flex flex-col items-center justify-center gap-5 unselectable">
                <div className="flex flex-col items-center gap-4 max-w-[460px] text-center">
                    <div className="text-foreground text-base font-medium">Thanks for being an early Wave adopter!</div>
                    <div className="text-secondary text-sm leading-relaxed">
                        A GitHub star shows your support for Wave (and open-source) and helps us reach more developers.
                        It takes just one click and means a lot to the team.
                    </div>
                    <div className="flex items-center justify-center gap-2 text-secondary text-sm mt-1">
                        <i className="fa-brands fa-github text-foreground text-lg" />
                        <span className="text-foreground font-mono text-sm">wavetermdev/waveterm</span>
                    </div>
                </div>
            </div>
            <footer className="unselectable flex-shrink-0 mt-6">
                <div className="flex flex-row items-center justify-center gap-2.5 [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm [&>button]:!h-[37px]">
                    <Button className="outlined grey font-[600]" onClick={onAlreadyStarred}>
                        🙏 Already Starred
                    </Button>
                    <Button className="outlined green font-[600]" onClick={onStarClick}>
                        ⭐ Star Now
                    </Button>
                    <Button className="outlined grey font-[600]" onClick={onMaybeLater}>
                        Maybe Later
                    </Button>
                </div>
            </footer>
        </div>
    );
}

type StarAskModalInnerProps = StarAskPageProps;

export function StarAskModalInner(props: StarAskModalInnerProps) {
    return (
        <div className="w-[500px] rounded-[10px] p-[30px] relative overflow-hidden bg-panel">
            <OnboardingGradientBg />
            <div className="relative z-10 flex flex-col w-full h-full">
                <StarAskPage {...props} />
            </div>
        </div>
    );
}
