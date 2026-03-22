// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { memo, useCallback, useEffect, useState } from "react";

type SessionEntry = {
    role: string;
    text: string;
    tool?: string;
};

type SessionLog = {
    tabId: string;
    timestamp: string;
    model?: string;
    entries?: SessionEntry[];
};

async function fetchSessionHistory(tabId: string): Promise<SessionLog | null> {
    try {
        const resp = await fetch(getWebServerEndpoint() + `/wave/session-history?tabid=${encodeURIComponent(tabId)}`);
        const data = await resp.json();
        if (data?.entries && data.entries.length > 0) {
            return data as SessionLog;
        }
        return null;
    } catch {
        return null;
    }
}

export const SessionHistoryBanner = memo(({ tabId }: { tabId: string }) => {
    const [session, setSession] = useState<SessionLog | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (dismissed) return;
        let cancelled = false;
        fetchSessionHistory(tabId).then((data) => {
            if (!cancelled) setSession(data);
        });
        return () => {
            cancelled = true;
        };
    }, [tabId, dismissed]);

    if (!session || dismissed) return null;

    const timestamp = new Date(session.timestamp).toLocaleString();
    const entryCount = session.entries?.length ?? 0;

    return (
        <div className="mx-2 mt-2 bg-gray-800/60 border border-gray-600/50 rounded-lg text-xs overflow-hidden">
            <div
                className="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-700/30 transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <i className={`fa fa-chevron-${expanded ? "down" : "right"} text-gray-500 w-3`} />
                <i className="fa fa-clock-rotate-left text-gray-400" />
                <span className="text-gray-300 flex-1">
                    Previous session <span className="text-gray-500">({timestamp})</span>
                </span>
                <span className="text-gray-500">{entryCount} messages</span>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setDismissed(true);
                    }}
                    className="text-gray-500 hover:text-white transition-colors ml-1"
                    title="Dismiss"
                >
                    <i className="fa fa-times" />
                </button>
            </div>
            {expanded && session.entries && (
                <div className="px-3 pb-2 max-h-48 overflow-y-auto border-t border-gray-700/50">
                    {session.entries.map((entry, idx) => (
                        <div key={idx} className="py-1 flex gap-2">
                            <span
                                className={`flex-shrink-0 w-10 text-right ${
                                    entry.role === "user" ? "text-blue-400" : "text-green-400"
                                }`}
                            >
                                {entry.role === "user" ? "You" : "AI"}
                            </span>
                            <span className="text-gray-300 flex-1 break-words">
                                {entry.tool && (
                                    <span className="text-yellow-400/70 mr-1">[{entry.tool}]</span>
                                )}
                                {entry.text}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
});

SessionHistoryBanner.displayName = "SessionHistoryBanner";
