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
            <div className="flex flex-col mt-1">
                <button
                    className="bg-zinc-700 text-foreground rounded px-3 py-1.5 text-xs font-medium hover:bg-zinc-600 transition-colors cursor-pointer flex items-center justify-center gap-2"
                    onClick={handleRestartAsDurable}
                >
                    <i className="fa-solid fa-shield text-sky-500" />
                    Restart as Durable
                </button>
                <button
                    className="text-muted text-xs hover:underline cursor-pointer text-left mt-1"
                    onClick={handleLearnMore}
                >
                    Learn More
                </button>
            </div>
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
            <div className="flex flex-col mt-1">
                <button
                    className="text-muted text-xs hover:underline cursor-pointer text-left"
                    onClick={handleLearnMore}
                >
                    Learn More
                </button>
            </div>
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
            <div className="flex flex-col mt-1">
                <button
                    className="text-muted text-xs hover:underline cursor-pointer text-left"
                    onClick={handleLearnMore}
                >
                    Learn More
                </button>
            </div>
        </div>
    );
}

function getTitleText(
    jobStatus: BlockJobStatusData,
    connStatus: ConnStatus,
    isConfigedDurable?: boolean | null
): string {
    let titleText = "Durable Session";

    const status = jobStatus?.status;
    if (status === "connected") {
        titleText = "Durable Session (Attached)";
    } else if (status === "disconnected") {
        titleText = "Durable Session (Detached)";
    } else if (status === "init") {
        titleText = "Durable Session (Starting)";
    } else if (status === "done") {
        const doneReason = jobStatus?.donereason;
        if (doneReason === "terminated") {
            titleText = "Durable Session (Ended, Exited)";
        } else if (doneReason === "gone") {
            titleText = "Durable Session (Ended, Environment Lost)";
        } else if (doneReason === "startuperror") {
            titleText = "Durable Session (Ended, Failed to Start)";
        } else {
            titleText = "Durable Session (Ended)";
        }
    } else if (status == null) {
        if (!connStatus?.connected) {
            titleText = "Durable Session (Awaiting Connection)";
        } else {
            titleText = "No Session";
        }
    }
    return titleText;
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

    const titleText = getTitleText(termDurableStatus, connStatus, termConfigedDurable);
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
                        {termConfigedDurable === false ? (
                            <StandardSessionContent viewModel={viewModel} onClose={handleClose} />
                        ) : termDurableStatus?.status === "connected" ? (
                            <DurableAttachedContent onClose={handleClose} />
                        ) : termDurableStatus?.status === "disconnected" ? (
                            <DurableDetachedContent onClose={handleClose} />
                        ) : (
                            titleText
                        )}
                    </div>
                </FloatingPortal>
            )}
        </>
    );
}
