// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MagnifyIcon } from "@/app/element/magnify";
import { cn, makeIconClass } from "@/util/util";
import { useCallback, useLayoutEffect, useState } from "react";
import { CommandReveal } from "./onboarding-command";

export type FakeTermBlockProps = {
    connectionName?: string;
    durableStatus?: "connected" | "detached" | null;
    className?: string;
    command?: string;
    typeIntervalMs?: number;
    onComplete?: () => void;
    children?: React.ReactNode;
};

export const FakeTermBlock = ({
    connectionName = "ubuntu@remoteserver",
    durableStatus = null,
    className,
    command,
    typeIntervalMs = 80,
    onComplete,
    children,
}: FakeTermBlockProps) => {
    const color = "var(--conn-icon-color-1)";

    const durableIconColor = durableStatus === "connected" ? "text-sky-500" : "text-sky-300";

    return (
        <div
            className={cn(
                "w-full h-full bg-background rounded flex flex-col overflow-hidden border-2 border-accent",
                className
            )}
        >
            <div className="flex items-center gap-2 px-2 py-1.5 bg-border/20 border-b border-border/50 pl-[2px]">
                <div className="group flex items-center flex-nowrap overflow-hidden text-ellipsis min-w-0 font-normal text-primary rounded-sm">
                    <span className="fa-stack flex-[1_1_auto] overflow-hidden">
                        <i
                            className={cn(makeIconClass("arrow-right-arrow-left", false), "fa-stack-1x mr-[2px]")}
                            style={{ color: color }}
                        />
                    </span>
                    <div className="flex-[1_2_auto] overflow-hidden pr-1 ellipsis">{connectionName}</div>
                </div>
                {durableStatus && (
                    <div className="iconbutton disabled text-[13px] ml-[-4px]">
                        <i className={`fa-sharp fa-solid fa-shield ${durableIconColor}`} />
                    </div>
                )}
                <div className="flex-1" />
                <span className="inline-block [&_svg]:fill-foreground/50 [&_svg_path]:!fill-foreground/50">
                    <MagnifyIcon enabled={false} />
                </span>
                <i className={makeIconClass("xmark-large", false) + " text-xs text-foreground/50"} />
            </div>
            <div className="flex-1 overflow-auto p-4">
                {children ? (
                    children
                ) : command ? (
                    <div className="font-mono text-sm">
                        <CommandReveal command={command} typeIntervalMs={typeIntervalMs} onComplete={onComplete} />
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <i className={makeIconClass("terminal", false) + " text-4xl text-foreground/50"} />
                    </div>
                )}
            </div>
        </div>
    );
};

const deployMessages = [
    "[1/8] Installing dependencies...",
    "[2/8] Generating TypeScript types from Go...",
    "[3/8] Building Go backend (wavesrv)...",
    "[4/8] Compiling TypeScript frontend...",
    "[5/8] Bundling Electron renderer...",
    "[6/8] Packaging application artifacts...",
    "[7/8] Code signing binaries...",
    "[8/8] Deploy complete ✓",
];

const DeployLogOutput = ({ onComplete }: { onComplete?: () => void }) => {
    const [commandComplete, setCommandComplete] = useState(false);
    const [visibleLines, setVisibleLines] = useState(0);
    const [showPrompt, setShowPrompt] = useState(false);
    const [showCursor, setShowCursor] = useState(false);

    const handleCommandComplete = useCallback(() => {
        setCommandComplete(true);
    }, []);

    useLayoutEffect(() => {
        if (!commandComplete) return;

        let lineIndex = 0;
        const lineInterval = setInterval(() => {
            if (lineIndex < deployMessages.length) {
                setVisibleLines(lineIndex + 1);
                lineIndex++;
            } else {
                clearInterval(lineInterval);
                setTimeout(() => {
                    setShowPrompt(true);
                    setShowCursor(true);
                    if (onComplete) {
                        onComplete();
                    }
                }, 200);
            }
        }, 1000);

        return () => clearInterval(lineInterval);
    }, [commandComplete, onComplete]);

    useLayoutEffect(() => {
        if (!showCursor) return;

        const cursorInterval = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => clearInterval(cursorInterval);
    }, [showCursor]);

    return (
        <div className="font-mono text-sm flex flex-col gap-1">
            <CommandReveal command="tail -f deploy.log" typeIntervalMs={80} onComplete={handleCommandComplete} />
            {commandComplete && (
                <>
                    {deployMessages.slice(0, visibleLines).map((msg, idx) => (
                        <div key={idx} className="text-foreground/70">
                            {msg}
                        </div>
                    ))}
                    {showPrompt && (
                        <div className="flex items-center gap-2">
                            <span className="text-accent">&gt;</span>
                            {showCursor && <span className="inline-block w-2 h-4 bg-foreground/80 align-middle"></span>}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export const TailDeployLogCommand = ({ onComplete }: { onComplete?: () => void }) => {
    return (
        <FakeTermBlock connectionName="ubuntu@remoteserver" durableStatus="connected" className="">
            <DeployLogOutput onComplete={onComplete} />
        </FakeTermBlock>
    );
};
