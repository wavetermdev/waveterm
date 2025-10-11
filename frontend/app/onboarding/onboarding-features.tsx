// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { Button } from "@/app/element/button";
import { EmojiButton } from "@/app/element/emojibutton";
import { MagnifyIcon } from "@/app/element/magnify";
import { isMacOS } from "@/util/platformutil";
import { cn, makeIconClass } from "@/util/util";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useLayoutEffect, useRef, useState } from "react";
import { FakeChat } from "./fakechat";

type FeaturePageName = "waveai" | "magnify" | "files";

const FakeBlock = ({ icon, name, highlighted, className }: { icon: string; name: string; highlighted?: boolean; className?: string }) => {
    return (
        <div
            className={cn(
                "w-full h-full bg-background rounded flex flex-col overflow-hidden border-2",
                highlighted ? "border-accent" : "border-border/50",
                className
            )}
        >
            <div className="flex items-center gap-2 px-2 py-1.5 bg-border/20 border-b border-border/50">
                <i className={makeIconClass(icon, false) + " text-xs text-foreground/70"} />
                <span className="text-xs text-foreground/70 flex-1">{name}</span>
                <span className="inline-block [&_svg]:fill-foreground/50 [&_svg_path]:!fill-foreground/50">
                    <MagnifyIcon enabled={false} />
                </span>
                <i className={makeIconClass("xmark-large", false) + " text-xs text-foreground/50"} />
            </div>
            <div className="flex-1 flex items-center justify-center">
                <i className={makeIconClass(icon, false) + " text-4xl text-foreground/50"} />
            </div>
        </div>
    );
};

const FakeLayout = () => {
    const layoutRef = useRef<HTMLDivElement>(null);
    const highlightedContainerRef = useRef<HTMLDivElement>(null);
    const [blockRect, setBlockRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);

    useLayoutEffect(() => {
        if (highlightedContainerRef.current) {
            const elem = highlightedContainerRef.current;
            setBlockRect({
                left: elem.offsetLeft,
                top: elem.offsetTop,
                width: elem.offsetWidth,
                height: elem.offsetHeight,
            });
        }
    }, []);

    useLayoutEffect(() => {
        if (!blockRect) return;

        const timeouts: NodeJS.Timeout[] = [];
        
        const addTimeout = (callback: () => void, delay: number) => {
            const id = setTimeout(callback, delay);
            timeouts.push(id);
        };

        const runAnimationCycle = (isFirstRun: boolean) => {
            const initialDelay = isFirstRun ? 1500 : 3000;
            
            addTimeout(() => {
                setIsExpanded(true);
                addTimeout(() => {
                    setIsExpanded(false);
                    addTimeout(() => runAnimationCycle(false), 3000);
                }, 3200);
            }, initialDelay);
        };

        runAnimationCycle(true);

        return () => {
            timeouts.forEach(clearTimeout);
        };
    }, [blockRect]);

    const getAnimatedStyle = () => {
        if (!blockRect || !layoutRef.current) {
            return {
                left: blockRect?.left ?? 0,
                top: blockRect?.top ?? 0,
                width: blockRect?.width ?? 0,
                height: blockRect?.height ?? 0,
            };
        }

        if (isExpanded) {
            const layoutWidth = layoutRef.current.offsetWidth;
            const layoutHeight = layoutRef.current.offsetHeight;
            const targetWidth = layoutWidth * 0.85;
            const targetHeight = layoutHeight * 0.85;

            return {
                left: (layoutWidth - targetWidth) / 2,
                top: (layoutHeight - targetHeight) / 2,
                width: targetWidth,
                height: targetHeight,
            };
        }

        return {
            left: blockRect.left,
            top: blockRect.top,
            width: blockRect.width,
            height: blockRect.height,
        };
    };

    return (
        <div ref={layoutRef} className="w-full h-[400px] flex flex-row gap-2 relative">
            <div className="flex-1">
                <FakeBlock icon="terminal" name="Terminal" />
            </div>
            <div className="flex-1 flex flex-col gap-2">
                <div className="flex-1">
                    <FakeBlock icon="globe" name="Web" />
                </div>
                <div className="flex-1" ref={highlightedContainerRef}>
                    <FakeBlock icon="terminal" name="Terminal" highlighted={true} className="opacity-0" />
                </div>
            </div>
            {blockRect && (
                <>
                    <div
                        className={cn(
                            "absolute inset-0 bg-black/50 transition-opacity duration-200",
                            isExpanded ? "opacity-100" : "opacity-0 pointer-events-none"
                        )}
                    />
                    <div
                        className="absolute transition-all duration-200 ease-in-out"
                        style={getAnimatedStyle()}
                    >
                        <FakeBlock icon="terminal" name="Terminal" highlighted={true} />
                    </div>
                </>
            )}
        </div>
    );
};

const OnboardingFooter = ({
    currentStep,
    totalSteps,
    onNext,
    onSkip,
}: {
    currentStep: number;
    totalSteps: number;
    onNext: () => void;
    onSkip?: () => void;
}) => {
    const isLastStep = currentStep === totalSteps;
    const buttonText = isLastStep ? "Get Started" : "Next";

    return (
        <footer className="unselectable flex-shrink-0 mt-5 relative">
            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-muted text-[13px]">
                {currentStep} of {totalSteps}
            </span>
            <div className="flex flex-row items-center justify-center [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm">
                <Button className="font-[600]" onClick={onNext}>
                    {buttonText}
                </Button>
            </div>
            {!isLastStep && onSkip && (
                <button
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-muted cursor-pointer hover:text-muted-hover text-[13px]"
                    onClick={onSkip}
                >
                    Skip Feature Tour &gt;
                </button>
            )}
        </footer>
    );
};

const WaveAIPage = ({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) => {
    const isMac = isMacOS();
    const shortcutKey = isMac ? "⌘-Shift-A" : "Alt-Shift-A";
    const [fireClicked, setFireClicked] = useState(false);

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center gap-4 mb-6 w-full unselectable flex-shrink-0">
                <div>
                    <Logo />
                </div>
                <div className="text-[25px] font-normal text-foreground">Wave AI</div>
            </header>
            <div className="flex-1 flex flex-row gap-0 min-h-0">
                <div className="flex-1 flex flex-col items-center justify-center gap-8 pr-6 unselectable">
                    <div className="flex flex-col items-start gap-6 max-w-md">
                        <div className="flex h-[52px] px-3 items-center rounded-lg bg-hover text-accent text-[24px]">
                            <i className="fa fa-sparkles" />
                            <span className="font-bold ml-2 font-mono">AI</span>
                        </div>
                        
                        <div className="flex flex-col items-start gap-4 text-secondary">
                            <p>
                                Wave AI is your terminal assistant with context. I can read your terminal output, analyze
                                widgets, access files, and help you solve problems faster.
                            </p>
                            
                            <div className="flex items-start gap-3 w-full">
                                <i className="fa fa-sparkles text-accent text-lg mt-1 flex-shrink-0" />
                                <p>
                                    Toggle the Wave AI panel with the{" "}
                                    <span className="inline-flex h-[26px] px-1.5 items-center rounded-md box-border bg-hover text-accent text-[12px] align-middle">
                                        <i className="fa fa-sparkles" />
                                        <span className="font-bold ml-1 font-mono">AI</span>
                                    </span>{" "}
                                    button in the header (top left)
                                </p>
                            </div>
                            
                            <div className="flex items-start gap-3 w-full">
                                <i className="fa fa-keyboard text-accent text-lg mt-1 flex-shrink-0" />
                                <p>
                                    Or use the keyboard shortcut <span className="font-mono font-semibold text-foreground whitespace-nowrap">{shortcutKey}</span> to quickly toggle
                                </p>
                            </div>
                            
                            <EmojiButton emoji="🔥" isClicked={fireClicked} onClick={() => setFireClicked(!fireClicked)} />
                        </div>
                    </div>
                </div>
                <div className="w-[2px] bg-border flex-shrink-0"></div>
                <div className="flex items-center justify-center pl-6 flex-shrink-0 w-[400px]">
                    <div className="w-full h-[400px] bg-background rounded border border-border/50 overflow-hidden">
                        <FakeChat />
                    </div>
                </div>
            </div>
            <OnboardingFooter currentStep={1} totalSteps={3} onNext={onNext} onSkip={onSkip} />
        </div>
    );
};

const MagnifyBlocksPage = ({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) => {
    const isMac = isMacOS();
    const shortcutKey = isMac ? "⌘" : "Alt";
    const [fireClicked, setFireClicked] = useState(false);

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center gap-4 mb-6 w-full unselectable flex-shrink-0">
                <div>
                    <Logo />
                </div>
                <div className="text-[25px] font-normal text-foreground">Magnify Blocks</div>
            </header>
            <div className="flex-1 flex flex-row gap-0 min-h-0">
                <div className="flex-1 flex flex-col items-center justify-center gap-8 pr-6 unselectable">
                    <div className="text-6xl font-semibold text-foreground">{shortcutKey}-M</div>
                    <div className="flex flex-col items-start gap-4 text-secondary max-w-md">
                        <p>
                            Magnify any block to focus on what matters. Expand terminals, editors, and previews for a
                            better view.
                        </p>
                        <p>Use the magnify feature to work with complex outputs and large files more efficiently.</p>
                        <p>
                            You can also magnify a block by clicking on the{" "}
                            <span className="inline-block align-middle [&_svg_path]:!fill-foreground">
                                <MagnifyIcon enabled={false} />
                            </span>{" "}
                            icon in the block header.
                        </p>
                        <p>
                            A quick {shortcutKey}-M to magnify and another {shortcutKey}-M to unmagnify
                        </p>
                        <EmojiButton emoji="🔥" isClicked={fireClicked} onClick={() => setFireClicked(!fireClicked)} />
                    </div>
                </div>
                <div className="w-[2px] bg-border flex-shrink-0"></div>
                <div className="flex items-center justify-center pl-6 flex-shrink-0 w-[400px]">
                    <FakeLayout />
                </div>
            </div>
            <OnboardingFooter currentStep={2} totalSteps={3} onNext={onNext} onSkip={onSkip} />
        </div>
    );
};

const FilesPage = ({ onFinish }: { onFinish: () => void }) => {
    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center gap-4 mb-6 w-full unselectable flex-shrink-0">
                <div>
                    <Logo />
                </div>
                <div className="text-[25px] font-normal text-foreground">Viewing/Editing Files</div>
            </header>
            <div className="flex-1 flex flex-row gap-0 min-h-0">
                <OverlayScrollbarsComponent
                    className="flex-1 overflow-y-auto"
                    options={{ scrollbars: { autoHide: "never" } }}
                >
                    <div className="flex flex-col items-start gap-4 pr-6 unselectable text-secondary">
                        <p>
                            View and edit files directly in Wave Terminal with syntax highlighting and code completion.
                        </p>
                        <p>Seamlessly switch between terminal commands and file editing in one unified interface.</p>
                    </div>
                </OverlayScrollbarsComponent>
                <div className="w-[2px] bg-border flex-shrink-0"></div>
                <div className="flex items-center justify-center pl-6 flex-shrink-0 w-[400px]">
                    <div className="w-full h-[400px] bg-border/30 rounded"></div>
                </div>
            </div>
            <OnboardingFooter currentStep={3} totalSteps={3} onNext={onFinish} />
        </div>
    );
};

export const OnboardingFeatures = ({ onComplete }: { onComplete: () => void }) => {
    const [currentPage, setCurrentPage] = useState<FeaturePageName>("waveai");

    const handleNext = () => {
        if (currentPage === "waveai") {
            setCurrentPage("magnify");
        } else if (currentPage === "magnify") {
            setCurrentPage("files");
        }
    };

    const handleSkip = () => {
        onComplete();
    };

    const handleFinish = () => {
        onComplete();
    };

    let pageComp: React.JSX.Element = null;
    switch (currentPage) {
        case "waveai":
            pageComp = <WaveAIPage onNext={handleNext} onSkip={handleSkip} />;
            break;
        case "magnify":
            pageComp = <MagnifyBlocksPage onNext={handleNext} onSkip={handleSkip} />;
            break;
        case "files":
            pageComp = <FilesPage onFinish={handleFinish} />;
            break;
    }

    return <div className="flex flex-col w-full h-full">{pageComp}</div>;
};
