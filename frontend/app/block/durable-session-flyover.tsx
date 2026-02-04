// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi, getConnStatusAtom, WOS } from "@/app/store/global";
import { TermViewModel } from "@/app/view/term/term-model";
import * as util from "@/util/util";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    safePolygon,
    shift,
    useFloating,
    useHover,
    useInteractions,
} from "@floating-ui/react";
import * as jotai from "jotai";
import { useEffect, useRef, useState } from "react";

function isTermViewModel(viewModel: ViewModel): viewModel is TermViewModel {
    return viewModel?.viewType === "term";
}

function handleLearnMore() {
    getApi().openExternal("https://docs.waveterm.dev/features/durable-sessions");
}

function LearnMoreButton() {
    return (
        <button className="text-muted text-xs hover:underline cursor-pointer text-left" onClick={handleLearnMore}>
            Learn More
        </button>
    );
}

interface StandardSessionContentProps {
    viewModel: TermViewModel;
    onClose: () => void;
}

function StandardSessionContent({ viewModel, onClose }: StandardSessionContentProps) {
    const handleRestartAsDurable = () => {
        onClose();
        util.fireAndForget(() => viewModel.restartSessionWithDurability(true));
    };

    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                <i className="fa-sharp fa-regular fa-shield text-muted" />
                Standard SSH Session
            </div>
            <div className="text-xs text-secondary leading-relaxed">
                Standard SSH sessions end when the connection drops. Durable sessions keep your shell state, running
                programs, and history alive through network changes, computer sleep, and Wave restarts.
            </div>
            <button
                className="bg-zinc-700 text-foreground rounded px-3 py-1.5 text-xs font-medium hover:bg-zinc-600 transition-colors cursor-pointer flex items-center justify-center gap-2 mt-1"
                onClick={handleRestartAsDurable}
            >
                <i className="fa-solid fa-shield text-sky-500" />
                Restart as Durable
            </button>
            <LearnMoreButton />
        </div>
    );
}

interface DurableAttachedContentProps {
    onClose: () => void;
}

function DurableAttachedContent({ onClose }: DurableAttachedContentProps) {
    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                <i className="fa-sharp fa-solid fa-shield text-sky-500" />
                Durable Session (Attached)
            </div>
            <div className="text-xs text-secondary leading-relaxed">
                Your shell state, running programs, and history are protected. This session will survive network
                disconnects.
            </div>
            <LearnMoreButton />
        </div>
    );
}

interface DurableDetachedContentProps {
    onClose: () => void;
}

function DurableDetachedContent({ onClose }: DurableDetachedContentProps) {
    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                <i className="fa-sharp fa-solid fa-shield text-sky-300" />
                Durable Session (Detached)
            </div>
            <div className="text-xs text-secondary leading-relaxed">
                Connection lost, but your session is still running on the remote server. Wave will automatically
                reconnect when the connection is restored.
            </div>
            <LearnMoreButton />
        </div>
    );
}

interface DurableAwaitingStartProps {
    connected: boolean;
    viewModel: TermViewModel;
    onClose: () => void;
}

function DurableAwaitingStart({ connected, viewModel, onClose }: DurableAwaitingStartProps) {
    const handleStartSession = () => {
        onClose();
        util.fireAndForget(() => viewModel.forceRestartController());
    };

    if (!connected) {
        return (
            <div className="flex flex-col gap-2 max-w-[280px]">
                <div className="font-semibold text-sm flex items-center gap-2 text-secondary whitespace-nowrap">
                    <i className="fa-sharp fa-solid fa-shield text-muted" />
                    Durable Session (Awaiting Connection)
                </div>
                <div className="text-xs text-secondary leading-relaxed">
                    Configured for a durable session. The session will start when the connection is established.
                </div>
                <LearnMoreButton />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary whitespace-nowrap">
                <i className="fa-sharp fa-solid fa-shield text-muted" />
                Durable Session (Awaiting Start)
            </div>
            <div className="text-xs text-secondary leading-relaxed">
                Configured for a durable session, but session hasn't started yet. Click below to start it manually.
            </div>
            <button
                className="bg-zinc-700 text-foreground rounded px-3 py-1.5 text-xs font-medium hover:bg-zinc-600 transition-colors cursor-pointer flex items-center justify-center gap-2 mt-1"
                onClick={handleStartSession}
            >
                <i className="fa-solid fa-shield text-sky-500" />
                Start Session
            </button>
            <LearnMoreButton />
        </div>
    );
}

interface DurableEndedContentProps {
    doneReason: string;
    viewModel: TermViewModel;
    onClose: () => void;
}

interface DurableStartingContentProps {
    onClose: () => void;
}

function DurableStartingContent({ onClose }: DurableStartingContentProps) {
    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                <i className="fa-sharp fa-solid fa-shield text-sky-300" />
                Durable Session (Starting)
            </div>
            <div className="text-xs text-secondary leading-relaxed">The durable session is starting.</div>
            <LearnMoreButton />
        </div>
    );
}

interface DurableEndedContentProps {
    doneReason: string;
    startupError?: string;
    viewModel: TermViewModel;
    onClose: () => void;
}

function DurableEndedContent({ doneReason, startupError, viewModel, onClose }: DurableEndedContentProps) {
    const handleRestartSession = () => {
        onClose();
        util.fireAndForget(() => viewModel.forceRestartController());
    };

    const handleRestartAsStandard = () => {
        onClose();
        util.fireAndForget(() => viewModel.restartSessionWithDurability(false));
    };

    let titleText = "Durable Session (Ended)";
    let descriptionText = "[Placeholder text - will be updated]";
    let showRestartButton = false;

    if (doneReason === "terminated") {
        titleText = "Durable Session (Ended, Exited)";
        descriptionText =
            "The shell was terminated and is no longer running. This block is still configured for durable sessions.";
        showRestartButton = true;
    } else if (doneReason === "gone") {
        titleText = "Durable Session (Ended, Lost)";
        descriptionText =
            "The session was lost or not found on the remote server. This may have occurred due to a system reboot or the session being manually terminated.";
        showRestartButton = true;
    } else if (doneReason === "startuperror") {
        titleText = "Durable Session (Failed to Start)";
        descriptionText = "The durable session failed to start.";
        return (
            <div className="flex flex-col gap-2 max-w-[280px]">
                <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                    <i className="fa-sharp fa-solid fa-shield text-muted" />
                    {titleText}
                </div>
                <div className="text-xs text-secondary leading-relaxed">{descriptionText}</div>
                {startupError && (
                    <div className="text-[11px] text-error leading-relaxed max-h-[3.5rem] overflow-y-auto">
                        {startupError}
                    </div>
                )}
                <button
                    className="bg-zinc-700 text-foreground rounded px-3 py-1.5 text-xs font-medium hover:bg-zinc-600 transition-colors cursor-pointer flex items-center justify-center gap-2 mt-1"
                    onClick={handleRestartSession}
                >
                    <i className="fa-solid fa-shield text-sky-500" />
                    Restart Session
                </button>
                <button
                    className="bg-zinc-700 text-foreground rounded px-3 py-1.5 text-xs font-medium hover:bg-zinc-600 transition-colors cursor-pointer flex items-center justify-center gap-2"
                    onClick={handleRestartAsStandard}
                >
                    <i className="fa-sharp fa-regular fa-shield text-muted" />
                    Restart as Standard
                </button>
                <LearnMoreButton />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 max-w-[280px]">
            <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                <i className="fa-sharp fa-solid fa-shield text-muted" />
                {titleText}
            </div>
            <div className="text-xs text-secondary leading-relaxed">{descriptionText}</div>
            {showRestartButton && (
                <button
                    className="bg-zinc-700 text-foreground rounded px-3 py-1.5 text-xs font-medium hover:bg-zinc-600 transition-colors cursor-pointer flex items-center justify-center gap-2 mt-1"
                    onClick={handleRestartSession}
                >
                    <i className="fa-solid fa-shield text-sky-500" />
                    Restart Session
                </button>
            )}
            <LearnMoreButton />
        </div>
    );
}

function getContentToRender(
    viewModel: TermViewModel,
    onClose: () => void,
    jobStatus: BlockJobStatusData,
    connStatus: ConnStatus,
    isConfigedDurable?: boolean | null
): string | React.ReactNode {
    if (isConfigedDurable === false) {
        return <StandardSessionContent viewModel={viewModel} onClose={onClose} />;
    }

    const status = jobStatus?.status;
    if (status === "connected") {
        return <DurableAttachedContent onClose={onClose} />;
    } else if (status === "disconnected") {
        return <DurableDetachedContent onClose={onClose} />;
    } else if (status === "init") {
        return <DurableStartingContent onClose={onClose} />;
    } else if (status === "done") {
        const doneReason = jobStatus?.donereason;
        const startupError = jobStatus?.startuperror;
        return (
            <DurableEndedContent
                doneReason={doneReason}
                startupError={startupError}
                viewModel={viewModel}
                onClose={onClose}
            />
        );
    } else if (status == null) {
        return <DurableAwaitingStart connected={!!connStatus?.connected} viewModel={viewModel} onClose={onClose} />;
    }
    console.log("DurableSessionFlyover: unexpected jobStatus", jobStatus);
    return null;
}

function getIconProps(jobStatus: BlockJobStatusData, connStatus: ConnStatus, isConfigedDurable?: boolean | null) {
    let color = "text-muted";
    let iconType: "fa-solid" | "fa-regular" = "fa-solid";

    if (isConfigedDurable === false) {
        color = "text-muted";
        iconType = "fa-regular";
        return { color, iconType };
    }

    const status = jobStatus?.status;
    if (status === "connected") {
        color = "text-sky-500";
    } else if (status === "disconnected") {
        color = "text-sky-300";
    } else if (status === "init") {
        color = "text-sky-300";
    } else if (status === "done") {
        color = "text-muted";
    } else if (status == null) {
        color = "text-muted";
    }
    return { color, iconType };
}

interface DurableSessionFlyoverProps {
    blockId: string;
    viewModel: ViewModel;
    placement?: "top" | "bottom" | "left" | "right";
    divClassName?: string;
}

export function DurableSessionFlyover({
    blockId,
    viewModel,
    placement = "bottom",
    divClassName,
}: DurableSessionFlyoverProps) {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const termDurableStatus = util.useAtomValueSafe(viewModel?.termDurableStatus);
    const termConfigedDurable = util.useAtomValueSafe(viewModel?.termConfigedDurable);
    const connName = blockData?.meta?.connection;
    const connStatus = jotai.useAtomValue(getConnStatusAtom(connName));

    const { color: durableIconColor, iconType: durableIconType } = getIconProps(
        termDurableStatus,
        connStatus,
        termConfigedDurable
    );

    const [isOpen, setIsOpen] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const timeoutRef = useRef<number | null>(null);

    const handleClose = () => {
        setIsVisible(false);
        if (timeoutRef.current !== null) {
            window.clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = window.setTimeout(() => {
            setIsOpen(false);
        }, 300);
    };

    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        onOpenChange: (open) => {
            if (open) {
                setIsOpen(true);
                if (timeoutRef.current !== null) {
                    window.clearTimeout(timeoutRef.current);
                }
                timeoutRef.current = window.setTimeout(() => {
                    setIsVisible(true);
                }, 300);
            } else {
                setIsVisible(false);
                if (timeoutRef.current !== null) {
                    window.clearTimeout(timeoutRef.current);
                }
                timeoutRef.current = window.setTimeout(() => {
                    setIsOpen(false);
                }, 300);
            }
        },
        placement,
        middleware: [offset(10), flip(), shift({ padding: 12 })],
        whileElementsMounted: autoUpdate,
    });

    useEffect(() => {
        return () => {
            if (timeoutRef.current !== null) {
                window.clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const hover = useHover(context, {
        handleClose: safePolygon(),
    });
    const { getReferenceProps, getFloatingProps } = useInteractions([hover]);

    if (!isTermViewModel(viewModel)) {
        return null;
    }

    const content = getContentToRender(viewModel, handleClose, termDurableStatus, connStatus, termConfigedDurable);
    if (content == null) {
        return null;
    }

    return (
        <>
            <div ref={refs.setReference} {...getReferenceProps()} className={divClassName}>
                <i className={`fa-sharp ${durableIconType} fa-shield ${durableIconColor}`} />
            </div>
            {isOpen && (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={{
                            ...floatingStyles,
                            opacity: isVisible ? 1 : 0,
                            transition: "opacity 200ms ease",
                        }}
                        {...getFloatingProps()}
                        className={cn(
                            "bg-zinc-800 border border-border rounded-md px-3 py-2.5 text-xs text-foreground shadow-xl z-50"
                        )}
                        onMouseDown={(e) => e.stopPropagation()}
                        onFocusCapture={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {content}
                    </div>
                </FloatingPortal>
            )}
        </>
    );
}
