// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";
import { globalStore } from "@/app/store/jotaiStore";
import type { ZeroAiMessage } from "../types";

/**
 * Messages atom - a map of session ID to array of messages
 * Using Record<string, ZeroAiMessage[]> for efficient lookup by session
 */
export const messagesAtom = atom<Record<string, ZeroAiMessage[]>>({});

/**
 * Streaming message atom - holds the current streaming message for each session
 * Key is session ID, value is the streaming message being built
 */
export const streamingMessageAtom = atom<Record<string, ZeroAiMessage>>({});

/**
 * Messages for a specific session - derived atom helper
 */
export function getMessagesAtom(sessionId: string): ZeroAiMessage[] {
  const messages = globalStore.get(messagesAtom);
  return messages[sessionId] || [];
}

/**
 * Get messages for a session
 */
export function getMessagesForSession(sessionId: string): ZeroAiMessage[] {
  return globalStore.get(messagesAtom)[sessionId] || [];
}

/**
 * Set messages for a session (replaces all messages)
 */
export function setMessagesForSession(sessionId: string, messages: ZeroAiMessage[]): void {
  globalStore.set(messagesAtom, (prev) => ({
    ...prev,
    [sessionId]: messages,
  }));
}

/**
 * Add a single message to a session
 */
export function addMessage(sessionId: string, message: ZeroAiMessage): void {
  globalStore.set(messagesAtom, (prev) => {
    const sessionMessages = prev[sessionId] || [];
    return {
      ...prev,
      [sessionId]: [...sessionMessages, message],
    };
  });
}

/**
 * Update an existing message in a session
 */
export function updateMessage(sessionId: string, messageId: number, updates: Partial<ZeroAiMessage>): void {
  globalStore.set(messagesAtom, (prev) => {
    const sessionMessages = prev[sessionId] || [];
    return {
      ...prev,
      [sessionId]: sessionMessages.map((msg) =>
        msg.id === messageId ? { ...msg, ...updates } : msg
      ),
    };
  });
}

/**
 * Delete all messages for a session
 */
export function deleteSessionMessages(sessionId: string): void {
  globalStore.set(messagesAtom, (prev) => {
    const updated = { ...prev };
    delete updated[sessionId];
    return updated;
  });
}

/**
 * Get streaming message for a session
 */
export function getStreamingMessage(sessionId: string): ZeroAiMessage | undefined {
  return globalStore.get(streamingMessageAtom)[sessionId];
}

/**
 * Set streaming message for a session (start a new stream)
 */
export function startStreamingMessage(sessionId: string, initialMessage: Omit<ZeroAiMessage, "id">): void {
  globalStore.set(streamingMessageAtom, (prev) => ({
    ...prev,
    [sessionId]: {
      id: Date.now(), // Use timestamp as ID for streaming messages
      sessionId,
      ...initialMessage,
    } as ZeroAiMessage,
  }));
}

/**
 * Append content to streaming message
 */
export function appendStreamChunk(sessionId: string, chunk: ZeroAiMessage): void {
  const current = getStreamingMessage(sessionId);
  if (current) {
    globalStore.set(streamingMessageAtom, (prev) => ({
      ...prev,
      [sessionId]: {
        ...current,
        content: current.content + chunk.content,
      },
    }));
  }
}

/**
 * Finalize streaming message - move from streaming to messages atom
 */
export function finalizeStream(sessionId: string): void {
  const streaming = getStreamingMessage(sessionId);
  if (streaming) {
    // Add the finalized message to the messages atom
    addMessage(sessionId, streaming);
    // Clear from streaming atom
    globalStore.set(streamingMessageAtom, (prev) => {
      const updated = { ...prev };
      delete updated[sessionId];
      return updated;
    });
  }
}

/**
 * Clear streaming message for a session (cancel stream)
 */
export function clearStreamingMessage(sessionId: string): void {
  globalStore.set(streamingMessageAtom, (prev) => {
    const updated = { ...prev };
    delete updated[sessionId];
    return updated;
  });
}

/**
 * Message actions atom - provides batch operations on messages
 */
export const messageActionsAtom = atom(null, (_get, set, action: MessageAction) => {
  switch (action.type) {
    case "setMessages":
      globalStore.set(messagesAtom, action.messages);
      break;

    case "addMessage":
      addMessage(action.sessionId, action.message);
      break;

    case "setMessageList":
      setMessagesForSession(action.sessionId, action.messages);
      break;

    case "startStream":
      startStreamingMessage(action.sessionId, action.message);
      break;

    case "appendChunk":
      appendStreamChunk(action.sessionId, action.chunk);
      break;

    case "finalizeStream":
      finalizeStream(action.sessionId);
      break;

    case "cancelStream":
      clearStreamingMessage(action.sessionId);
      break;

    case "deleteSession":
      deleteSessionMessages(action.sessionId);
      break;

    case "clearAll":
      globalStore.set(messagesAtom, {});
      globalStore.set(streamingMessageAtom, {});
      break;
  }
});

/**
 * Action types for message actions
 */
export type MessageAction =
  | { type: "setMessages"; messages: Record<string, ZeroAiMessage[]> }
  | { type: "setMessageList"; sessionId: string; messages: ZeroAiMessage[] }
  | { type: "addMessage"; sessionId: string; message: ZeroAiMessage }
  | { type: "startStream"; sessionId: string; message: Omit<ZeroAiMessage, "id"> }
  | { type: "appendChunk"; sessionId: string; chunk: ZeroAiMessage }
  | { type: "finalizeStream"; sessionId: string }
  | { type: "cancelStream"; sessionId: string }
  | { type: "deleteSession"; sessionId: string }
  | { type: "clearAll" };

/**
 * Helper: Dispatch message action
 */
export function dispatchMessageAction(action: MessageAction): void {
  globalStore.set(messageActionsAtom, action);
}
