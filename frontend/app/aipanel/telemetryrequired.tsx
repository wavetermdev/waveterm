// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useState } from "react";
import { WaveAIModel } from "./waveai-model";

interface TelemetryRequiredMessageProps {
    className?: string;
}

const TelemetryRequiredMessage = ({ className }: TelemetryRequiredMessageProps) => {
    const [isEnabling, setIsEnabling] = useState(false);

    const handleEnableTelemetry = async () => {
        setIsEnabling(true);
        try {
            await RpcApi.WaveAIEnableTelemetryCommand(TabRpcClient);
            setTimeout(() => {
                WaveAIModel.getInstance().focusInput();
            }, 100);
        } catch (error) {
            console.error("Failed to enable telemetry:", error);
            setIsEnabling(false);
        }
    };

    return (
        <div className={cn("flex flex-col h-full", className)}>
            <div className="flex-grow"></div>
            <div className="flex items-center justify-center p-8 text-center">
                <div className="max-w-md space-y-6">
                    <div className="space-y-4">
                        <i className="fa fa-sparkles text-accent text-5xl"></i>
                        <h2 className="text-2xl font-semibold text-foreground">Wave AI</h2>
                        <p className="text-secondary leading-relaxed">
                            Wave AI is free to use and provides integrated AI chat that can interact with your widgets,
                            help you with code, analyze files, and assist with your terminal workflows.
                        </p>
                    </div>

                    <div className="bg-blue-900/20 border border-blue-500 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <i className="fa fa-info-circle text-blue-400 text-lg mt-0.5"></i>
                            <div className="text-left">
                                <div className="text-blue-400 font-medium mb-1">Telemetry keeps Wave AI free</div>
                                <div className="text-secondary text-sm mb-3">
                                    <p className="mb-2">
                                        To keep Wave AI free for everyone, we require a small amount of <i>anonymous</i>{" "}
                                        usage data (app version, feature usage, system info).
                                    </p>
                                    <p className="mb-2">
                                        This helps us block abuse by automated systems and ensure it's used by real
                                        people like you.
                                    </p>
                                    <p>
                                        We never collect your files, prompts, keystrokes, hostnames, or personally
                                        identifying information. Wave AI is powered by OpenAI's APIs, please refer to
                                        OpenAI's privacy policy for details on how they handle your data.
                                    </p>
                                </div>
                                <button
                                    onClick={handleEnableTelemetry}
                                    disabled={isEnabling}
                                    className="bg-accent/80 hover:bg-accent disabled:bg-accent/50 text-background px-4 py-2 rounded-lg font-medium cursor-pointer disabled:cursor-not-allowed"
                                >
                                    {isEnabling ? "Enabling..." : "Enable Telemetry and Continue"}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="text-xs text-secondary">
                        <a
                            href="https://waveterm.dev/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="!text-secondary hover:!text-accent/80 cursor-pointer"
                        >
                            Privacy Policy
                        </a>
                    </div>
                </div>
            </div>
            <div className="flex-grow-[2]"></div>
        </div>
    );
};

TelemetryRequiredMessage.displayName = "TelemetryRequiredMessage";

export { TelemetryRequiredMessage };
