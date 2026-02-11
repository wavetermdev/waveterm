// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MagnifyIcon } from "@/app/element/magnify";
import { cn, makeIconClass } from "@/util/util";
import { CommandReveal } from "./onboarding-command";

export type FakeTermBlockProps = {
    connectionName?: string;
    durableStatus?: "connected" | "detached" | null;
    className?: string;
    command?: string;
    typeIntervalMs?: number;
    onComplete?: () => void;
};

export const FakeTermBlock = ({
    connectionName = "ubuntu@remoteserver",
    durableStatus = null,
    className,
    command,
    typeIntervalMs = 80,
    onComplete,
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
                {command ? (
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

export const TailDeployLogCommand = ({ onComplete }: { onComplete?: () => void }) => {
    return (
        <FakeTermBlock
            connectionName="ubuntu@remoteserver"
            durableStatus="connected"
            command="tail -f deploy.log"
            typeIntervalMs={80}
            onComplete={onComplete}
        />
    );
};
