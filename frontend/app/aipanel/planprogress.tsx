// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { memo, useCallback, useEffect, useState } from "react";

type PlanStep = {
    id: number;
    label: string;
    status: string;
    result?: string;
    error?: string;
    doneAt?: string;
};

type Plan = {
    tabId: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    steps: PlanStep[];
};

async function fetchPlan(tabId: string): Promise<Plan | null> {
    try {
        const resp = await fetch(getWebServerEndpoint() + `/wave/plan/status?tabid=${encodeURIComponent(tabId)}`);
        const data = await resp.json();
        return data?.plan ?? null;
    } catch {
        return null;
    }
}

const statusIcon: Record<string, { icon: string; color: string }> = {
    pending: { icon: "fa-circle", color: "text-gray-500" },
    running: { icon: "fa-spinner fa-spin", color: "text-accent-400" },
    done: { icon: "fa-check-circle", color: "text-green-400" },
    failed: { icon: "fa-times-circle", color: "text-red-400" },
    skipped: { icon: "fa-minus-circle", color: "text-gray-400" },
};

const PlanStepItem = memo(({ step }: { step: PlanStep }) => {
    const [expanded, setExpanded] = useState(false);
    const hasDetails = step.result || step.error;
    const { icon, color } = statusIcon[step.status] ?? statusIcon.pending;

    return (
        <div className="group">
            <div
                className={`flex items-center gap-2 py-1 px-1 rounded ${hasDetails ? "cursor-pointer hover:bg-gray-700/30" : ""}`}
                onClick={() => hasDetails && setExpanded(!expanded)}
            >
                <i className={`fa ${icon} ${color} w-4 text-center flex-shrink-0`} />
                <span className={`flex-1 ${step.status === "done" ? "text-gray-400" : "text-gray-200"}`}>
                    {step.label}
                </span>
                {hasDetails && (
                    <i className={`fa fa-chevron-${expanded ? "down" : "right"} text-gray-600 text-[10px]`} />
                )}
            </div>
            {expanded && hasDetails && (
                <div className="ml-6 mb-1">
                    {step.error && (
                        <div className="text-red-300 text-[11px] bg-red-900/20 rounded px-2 py-1 mt-0.5">
                            {step.error}
                        </div>
                    )}
                    {step.result && (
                        <pre className="text-gray-400 text-[11px] bg-gray-900/50 rounded px-2 py-1 mt-0.5 whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {step.result}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
});
PlanStepItem.displayName = "PlanStepItem";

export const PlanProgressPanel = memo(({ tabId }: { tabId: string }) => {
    const [plan, setPlan] = useState<Plan | null>(null);
    const [minimized, setMinimized] = useState(false);

    const refresh = useCallback(() => {
        fetchPlan(tabId).then(setPlan);
    }, [tabId]);

    const dismissPlan = useCallback(async () => {
        try {
            await fetch(getWebServerEndpoint() + `/wave/plan/delete?tabid=${encodeURIComponent(tabId)}`);
        } catch {}
        setPlan(null);
    }, [tabId]);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, 3000);
        return () => clearInterval(interval);
    }, [refresh]);

    if (!plan || plan.steps.length === 0) return null;

    const doneCount = plan.steps.filter(
        (s) => s.status === "done" || s.status === "failed" || s.status === "skipped"
    ).length;
    const totalCount = plan.steps.length;
    const isComplete = doneCount === totalCount;
    const progressPct = Math.round((doneCount / totalCount) * 100);

    return (
        <div className="mx-2 mt-2 bg-gray-800/60 border border-gray-600/50 rounded-lg text-xs overflow-hidden">
            {/* Header */}
            <div
                className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-700/30 transition-colors"
                onClick={() => setMinimized(!minimized)}
            >
                <i className={`fa ${isComplete ? "fa-check-circle text-green-400" : "fa-list-check text-accent-400"} flex-shrink-0`} />
                <span className="text-gray-200 font-medium flex-1 truncate">{plan.name}</span>
                <span className="text-gray-400">
                    {doneCount}/{totalCount}
                </span>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        dismissPlan();
                    }}
                    className="text-gray-500 hover:text-white transition-colors ml-1"
                    title="Close plan"
                >
                    <i className="fa fa-times" />
                </button>
                <i className={`fa fa-chevron-${minimized ? "right" : "down"} text-gray-500 w-3`} />
            </div>

            {/* Progress bar */}
            {!minimized && (
                <>
                    <div className="mx-2 mb-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${isComplete ? "bg-green-500" : "bg-accent-500"}`}
                            style={{ width: `${progressPct}%` }}
                        />
                    </div>

                    {/* Steps */}
                    <div className="px-2 pb-2 max-h-64 overflow-y-auto">
                        {plan.steps.map((step) => (
                            <PlanStepItem key={step.id} step={step} />
                        ))}
                    </div>

                    {plan.description && (
                        <div className="px-2 pb-2 text-gray-500 border-t border-gray-700/50 pt-1">
                            {plan.description}
                        </div>
                    )}
                </>
            )}
        </div>
    );
});

PlanProgressPanel.displayName = "PlanProgressPanel";
