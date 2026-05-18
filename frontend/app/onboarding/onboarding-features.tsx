// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { EmojiButton } from "@/app/element/emojibutton";
import { MagnifyIcon } from "@/app/element/magnify";
import { ClientModel } from "@/app/store/client-model";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isMacOS } from "@/util/platformutil";
import { useEffect, useState } from "react";
import { EditBashrcCommand, ViewLogoCommand, ViewShortcutsCommand } from "./onboarding-command";
import { CurrentOnboardingVersion } from "./onboarding-common";
import { DurableSessionPage } from "./onboarding-durable";
import { OnboardingFooter } from "./onboarding-features-footer";
import { FakeLayout } from "./onboarding-layout";

type FeaturePageName = "durable" | "magnify" | "files";

export const MagnifyBlocksPage = ({
    onNext,
    onSkip,
    onPrev,
}: {
    onNext: () => void;
    onSkip: () => void;
    onPrev?: () => void;
}) => {
    const isMac = isMacOS();
    const shortcutKey = isMac ? "⌘" : "Alt";
    const [fireClicked, setFireClicked] = useState(false);

    const handleFireClick = () => {
        setFireClicked(!fireClicked);
        if (!fireClicked) {
        }
    };

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
                        <div>
                            You can also magnify a block by clicking on the{" "}
                            <span className="inline-block align-middle [&_svg_path]:!fill-foreground">
                                <MagnifyIcon enabled={false} />
                            </span>{" "}
                            icon in the block header.
                        </div>
                        <p>
                            A quick {shortcutKey}-M to magnify and another {shortcutKey}-M to unmagnify
                        </p>
                        <EmojiButton emoji="🔥" isClicked={fireClicked} onClick={handleFireClick} />
                    </div>
                </div>
                <div className="w-[2px] bg-border flex-shrink-0"></div>
                <div className="flex items-center justify-center pl-6 flex-shrink-0 w-[400px]">
                    <FakeLayout />
                </div>
            </div>
            <OnboardingFooter currentStep={2} totalSteps={3} onNext={onNext} onPrev={onPrev} onSkip={onSkip} />
        </div>
    );
};

export const FilesPage = ({ onFinish, onPrev }: { onFinish: () => void; onPrev?: () => void }) => {
    const [fireClicked, setFireClicked] = useState(false);
    const isMac = isMacOS();
    const [commandIndex, setCommandIndex] = useState(0);

    const handleFireClick = () => {
        setFireClicked(!fireClicked);
        if (!fireClicked) {
        }
    };

    const commands = [
        (onComplete: () => void) => <EditBashrcCommand onComplete={onComplete} />,
        (onComplete: () => void) => <ViewShortcutsCommand isMac={isMac} onComplete={onComplete} />,
        (onComplete: () => void) => <ViewLogoCommand onComplete={onComplete} />,
    ];

    const handleCommandComplete = () => {
        setTimeout(() => {
            setCommandIndex((prev) => (prev + 1) % commands.length);
        }, 2500);
    };

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center gap-4 mb-6 w-full unselectable flex-shrink-0">
                <div>
                    <Logo />
                </div>
                <div className="text-[25px] font-normal text-foreground">Viewing/Editing Files</div>
            </header>
            <div className="flex-1 flex flex-row gap-0 min-h-0">
                <div className="flex-1 flex flex-col items-center justify-center gap-8 pr-6 unselectable">
                    <div className="flex flex-col items-start gap-6 max-w-md">
                        <div className="flex flex-col items-start gap-4 text-secondary">
                            <p>
                                Wave can preview markdown, images, and video files on both local <i>and remote</i>{" "}
                                machines.
                            </p>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa fa-eye text-accent text-lg mt-1 flex-shrink-0" />
                                <div>
                                    <p className="mb-2">
                                        Use{" "}
                                        <span className="font-mono font-semibold text-foreground">
                                            wsh view [filename]
                                        </span>{" "}
                                        to preview files in Wave's graphical viewer
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa fa-pen-to-square text-accent text-lg mt-1 flex-shrink-0" />
                                <div>
                                    <p className="mb-2">
                                        Use{" "}
                                        <span className="font-mono font-semibold text-foreground">
                                            wsh edit [filename]
                                        </span>{" "}
                                        to open config files or code files in Wave's graphical editor
                                    </p>
                                </div>
                            </div>

                            <p>
                                These commands work seamlessly on both local and remote machines, making it easy to view
                                and edit files wherever they are.
                            </p>

                            <EmojiButton emoji="🔥" isClicked={fireClicked} onClick={handleFireClick} />
                        </div>
                    </div>
                </div>
                <div className="w-[2px] bg-border flex-shrink-0"></div>
                <div className="flex items-center justify-center pl-6 flex-shrink-0 w-[400px]">
                    {commands[commandIndex](handleCommandComplete)}
                </div>
            </div>
            <OnboardingFooter currentStep={3} totalSteps={3} onNext={onFinish} onPrev={onPrev} />
        </div>
    );
};

export const OnboardingFeatures = ({ onComplete }: { onComplete: () => void }) => {
    const [currentPage, setCurrentPage] = useState<FeaturePageName>("durable");

    useEffect(() => {
        const clientId = ClientModel.getInstance().clientId;
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:lastversion": CurrentOnboardingVersion },
        });
    }, []);

    const handleNext = () => {
        if (currentPage === "durable") {
            setCurrentPage("magnify");
        } else if (currentPage === "magnify") {
            setCurrentPage("files");
        }
    };

    const handlePrev = () => {
        if (currentPage === "magnify") {
            setCurrentPage("durable");
        } else if (currentPage === "files") {
            setCurrentPage("magnify");
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
        case "durable":
            pageComp = <DurableSessionPage onNext={handleNext} onSkip={handleSkip} onPrev={handlePrev} />;
            break;
        case "magnify":
            pageComp = <MagnifyBlocksPage onNext={handleNext} onSkip={handleSkip} onPrev={handlePrev} />;
            break;
        case "files":
            pageComp = <FilesPage onFinish={handleFinish} onPrev={handlePrev} />;
            break;
    }

    return <div className="flex flex-col w-full h-full">{pageComp}</div>;
};
