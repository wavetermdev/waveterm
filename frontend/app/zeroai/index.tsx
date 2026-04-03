import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { ChatArea, ProviderSettings, ResizableInput, SessionList, StatusBar, ZeroAIHeader } from "./components";
import "./index.scss";
import { dispatchMessageAction, messagesAtom } from "./models/message-model";
import { activeSessionIdAtom, dispatchSessionAction, removeSession, sessionsAtom } from "./models/session-model";
import { inputHeightAtom, inputWidthAtom, setThinking, showProviderSettingsAtom, toggleProviderSettings } from "./models/ui-model";
import { ZeroAiClient } from "./store/zeroai-client";
import type { CreateSessionRequest, ZeroAiAgentInfo, ZeroAiSession, ZeroAiSessionInfo } from "./types";

export function ZeroAIPanel() {
    const sessions = useAtomValue(sessionsAtom);
    const activeSessionId = useAtomValue(activeSessionIdAtom);
    const messagesMap = useAtomValue(messagesAtom);
    const inputHeight = useAtomValue(inputHeightAtom);
    const inputWidth = useAtomValue(inputWidthAtom);
    const showProviderSettings = useAtomValue(showProviderSettingsAtom);

    const [inputValue, setInputValue] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);

    const clientRef = useRef<ZeroAiClient | null>(null);

    useEffect(() => {
        const client = new ZeroAiClient();
        clientRef.current = client;

        const initializeSessions = async () => {
            try {
                const sessionList = await client.listSessions();
                dispatchSessionAction({ type: "setSessions", sessions: sessionList });
            } catch (error) {
                console.error("Failed to load sessions:", error);
            }
        };

        initializeSessions();

        return () => {
            setIsStreaming(false);
        };
    }, []);

    const currentMessages = activeSessionId ? messagesMap[activeSessionId] || [] : [];
    const currentSession = sessions.find((s) => s.sessionId === activeSessionId);

    const handleSelectSession = (sessionId: string) => {
        dispatchSessionAction({ type: "setActiveSession", sessionId });
    };

    const handleCreateSession = async () => {
        if (!clientRef.current) return;

        try {
            setIsStreaming(true);
            setThinking(true);

            const request: CreateSessionRequest = {
                backend: "claude",
                model: "claude-sonnet-4-5",
                provider: "anthropic",
            };

            const result = await clientRef.current.createSession(request);

            const newSession: ZeroAiSessionInfo = {
                sessionId: result.sessionId,
                provider: "anthropic",
                model: "claude-sonnet-4-5",
                workDir: null,
                createdAt: Date.now() / 1000,
                lastMessageAt: Date.now() / 1000,
            };

            dispatchSessionAction({ type: "addSession", session: newSession, setActive: true });
        } catch (error) {
            console.error("Failed to create session:", error);
        } finally {
            setIsStreaming(false);
            setThinking(false);
        }
    };

    const handleDeleteSession = async (sessionId: string) => {
        if (!clientRef.current) return;

        try {
            setIsStreaming(true);
            await clientRef.current.deleteSession(sessionId);
            removeSession(sessionId);

            if (activeSessionId === sessionId) {
                const remaining = sessions.filter((s) => s.sessionId !== sessionId);
                dispatchSessionAction({
                    type: "setActiveSession",
                    sessionId: remaining.length > 0 ? remaining[0].sessionId : null,
                });
            }

            dispatchMessageAction({ type: "deleteSession", sessionId });
        } catch (error) {
            console.error("Failed to delete session:", error);
        } finally {
            setIsStreaming(false);
        }
    };

    const handleSendMessage = async () => {
        if (!inputValue.trim() || !activeSessionId || !clientRef.current || isStreaming) {
            return;
        }

        const content = inputValue.trim();
        setInputValue("");
        setIsStreaming(true);
        setThinking(true);

        try {
            const stream = clientRef.current.streamMessage({
                sessionId: activeSessionId,
                role: "user",
                content,
            });

            for await (const event of stream) {
                if (event.message) {
                    dispatchMessageAction({ type: "addMessage", sessionId: activeSessionId, message: event.message });
                }
            }
        } catch (error) {
            console.error("Failed to send message:", error);
        } finally {
            setIsStreaming(false);
            setThinking(false);
        }
    };

    const minHeight = typeof inputHeight === "number" ? inputHeight : 100;
    const minWidth = typeof inputWidth === "number" ? inputWidth : 300;

    const agentInfo: ZeroAiAgentInfo | undefined = currentSession
        ? {
              backend: "claude",
              model: currentSession.model,
              provider: currentSession.provider,
              displayName: "Claude Code",
              description: "AI coding assistant",
              enabled: true,
              supportedOps: ["chat", "edit"],
          }
        : undefined;

    return (
        <div className="zeroai-panel">
            <StatusBar
                session={currentSession as unknown as ZeroAiSession}
                agentInfo={agentInfo}
                onWorkDirClick={() => console.log("Change work dir")}
                isStreaming={isStreaming}
            />
            <ZeroAIHeader showSettings={showProviderSettings} onToggleSettings={toggleProviderSettings} />
            <div className="zeroai-content">
                {showProviderSettings ? (
                    <ProviderSettings className="provider-settings-full" />
                ) : (
                    <>
                        <SessionList
                            sessions={sessions as unknown as ZeroAiSession[]}
                            currentSessionId={activeSessionId || undefined}
                            onSelectSession={handleSelectSession}
                            onCreateSession={handleCreateSession}
                            onDeleteSession={handleDeleteSession}
                        />
                        <div className="chat-area-wrapper">
                            <ChatArea messages={currentMessages} />
                            <ResizableInput
                                value={inputValue}
                                onChange={setInputValue}
                                onSend={handleSendMessage}
                                isSending={isStreaming}
                                minHeight={minHeight}
                                maxHeight={400}
                                minWidth={minWidth}
                                maxWidth={1200}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
