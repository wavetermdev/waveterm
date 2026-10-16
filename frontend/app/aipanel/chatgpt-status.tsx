// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { localApi } from "@/app/view/waveconfig/localapi";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { WaveAIModel } from "./waveai-model";

type Status = { active: string; accounts: { id: string; email: string; signedIn: boolean; planUsage: boolean }[] };
export function ChatGPTAccountStatus() {
    const model = WaveAIModel.getInstance();
    const mode = useAtomValue(model.currentAIMode);
    const configs = useAtomValue(model.aiModeConfigs);
    const enabled = configs[mode]?.["ai:provider"] === "chatgpt-plan";
    const previousAccount = useRef<string>(undefined);
    const [status, setStatus] = useState<Status>();
    const [error, setError] = useState("");
    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        const refresh = () =>
            localApi<Status>("chatgpt", undefined, controller.signal)
                .then((next) => {
                    if (controller.signal.aborted) return;
                    if (previousAccount.current !== undefined && previousAccount.current !== next.active)
                        model.clearChat();
                    previousAccount.current = next.active;
                    setStatus(next);
                    setError("");
                })
                .catch((e) => {
                    if (!controller.signal.aborted) setError(e.message);
                });
        void refresh();
        const timer = setInterval(refresh, 2500);
        return () => {
            controller.abort();
            clearInterval(timer);
        };
    }, [enabled, model]);
    if (!enabled) return null;
    const account = status?.accounts.find((a) => a.id === status.active);
    return (
        <div className="px-3 py-1 text-xs text-secondary" role="status">
            {error ||
                (account?.signedIn
                    ? `ChatGPT: ${account.email || account.id.slice(0, 8)} · ${account.planUsage ? "Plan usage authorized" : "Plan usage permission missing"}`
                    : "Sign in with ChatGPT in Settings → Wave AI Modes")}
        </div>
    );
}
