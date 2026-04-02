// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { ZeroAiBackend, ZeroAiSession, ZeroAiSessionInfo } from "../types";

export const sessionsAtom: PrimitiveAtom<ZeroAiSessionInfo[]> = atom<ZeroAiSessionInfo[]>([]);

export const activeSessionIdAtom: PrimitiveAtom<string | null> = atom<string | null>(null as string | null);

export const activeSessionAtom = atom<ZeroAiSession | null>((get) => {
    const activeId = get(activeSessionIdAtom);
    if (!activeId) return null;

    const sessions = get(sessionsAtom);
    const sessionInfo = sessions.find((s) => s.sessionId === activeId);
    if (!sessionInfo) return null;

    return {
        id: activeId,
        backend: (sessionInfo.provider || "claude") as ZeroAiBackend,
        workDir: sessionInfo.workDir ?? "",
        model: sessionInfo.model,
        provider: sessionInfo.provider,
        thinkingLevel: null,
        yoloMode: false,
        sessionId: activeId,
        createdAt: sessionInfo.createdAt,
        updatedAt: sessionInfo.lastMessageAt,
        metadata: null,
    };
});

export const sessionsByAgentAtom = atom<Record<string, ZeroAiSessionInfo[]>>((get) => {
    const sessions = get(sessionsAtom);
    const grouped: Record<string, ZeroAiSessionInfo[]> = {};
    for (const session of sessions) {
        const provider = session.provider || "unknown";
        if (!grouped[provider]) {
            grouped[provider] = [];
        }
        grouped[provider].push(session);
    }
    return grouped;
});

export type SessionAction =
    | { type: "setSessions"; sessions: ZeroAiSessionInfo[] }
    | { type: "setActiveSession"; sessionId: string | null }
    | { type: "addSession"; session: ZeroAiSessionInfo; setActive?: boolean }
    | { type: "removeSession"; sessionId: string }
    | { type: "updateSession"; sessionId: string; updates: Partial<ZeroAiSessionInfo>; lastMessageAt?: number };

export const sessionActionsAtom = atom(null, (_get, _set, action: SessionAction) => {
    switch (action.type) {
        case "setSessions":
            globalStore.set(sessionsAtom, action.sessions);
            break;

        case "setActiveSession":
            globalStore.set(activeSessionIdAtom, action.sessionId);
            break;

        case "addSession": {
            globalStore.set(sessionsAtom, (prev) => {
                return [...prev, { ...action.session, lastMessageAt: Date.now() / 1000 }];
            });
            if (action.setActive) {
                globalStore.set(activeSessionIdAtom, action.session.sessionId);
            }
            break;
        }

        case "removeSession": {
            globalStore.set(sessionsAtom, (prev) => prev.filter((s) => s.sessionId !== action.sessionId));
            globalStore.set(activeSessionIdAtom, (prev) => (prev === action.sessionId ? null : prev));
            break;
        }

        case "updateSession": {
            globalStore.set(sessionsAtom, (prev) =>
                prev.map((s) =>
                    s.sessionId === action.sessionId
                        ? {
                              ...s,
                              ...action.updates,
                              lastMessageAt: Math.max(s.lastMessageAt, action.lastMessageAt ?? Date.now() / 1000),
                          }
                        : s
                )
            );
            break;
        }
    }
});

export function dispatchSessionAction(action: SessionAction): void {
    globalStore.set(sessionActionsAtom, action);
}

export function setSessions(sessions: ZeroAiSessionInfo[]): void {
    dispatchSessionAction({ type: "setSessions", sessions });
}

export function setActiveSessionId(sessionId: string | null): void {
    dispatchSessionAction({ type: "setActiveSession", sessionId });
}

export function addSession(session: ZeroAiSessionInfo, setActive = false): void {
    dispatchSessionAction({ type: "addSession", session, setActive });
}

export function removeSession(sessionId: string): void {
    dispatchSessionAction({ type: "removeSession", sessionId });
}
