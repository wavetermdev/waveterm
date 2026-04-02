// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type ZeroAiBackend = "claude" | "qwen" | "codex" | "opencode" | "custom";

export type ZeroAiRole = "user" | "assistant" | "system";

export type ZeroAiEventType =
    | "content"
    | "tool_call"
    | "permission"
    | "error"
    | "end_turn"
    | "plan_update"
    | "stream_start"
    | "stream_end";

export interface ZeroAiSession {
    id: string;
    backend: string;
    workDir: string;
    model: string;
    provider: string;
    thinkingLevel: string;
    yoloMode: boolean;
    sessionId?: string;
    createdAt: number;
    updatedAt: number;
    metadata?: Record<string, unknown>;
}

export interface ZeroAiSessionInfo {
    sessionId: string;
    provider: string;
    model: string;
    workDir: string | null;
    createdAt: number;
    lastMessageAt: number;
}

export interface ZeroAiMessage {
    id: number;
    sessionId: string;
    role: string;
    content: string;
    eventType?: string;
    metadata?: Record<string, unknown>;
    createdAt: number;
}

export interface ZeroAiAgentInfo {
    backend: string;
    model: string;
    provider: string;
    displayName: string;
    description: string;
    enabled: boolean;
    supportedOps: string[];
}

export interface ZeroAiPermissionOption {
    id: string;
    label: string;
    description: string;
}

export interface ZeroAiPermissionRequest {
    callId: string;
    toolName: string;
    description: string;
    options: ZeroAiPermissionOption[];
    sessionId: string;
}

export interface ZeroAiStreamMessageEvent {
    message: ZeroAiMessage | null;
}

export interface ZeroAiStreamEnd {
    finishReason: "stop" | "length" | "error" | null;
    error: string | null;
}

export interface ZeroAiEvent {
    type: ZeroAiEventType;
    session: string;
    data?: unknown;
    error?: string;
    created: number;
}

export interface ZeroAiStatusBarInfo {
    provider: string | null;
    model: string | null;
    thinking: boolean;
    workDir: string | null;
}

export interface CreateSessionRequest {
    backend: ZeroAiBackend;
    model: string;
    provider?: string;
    thinkingLevel?: string;
    yoloMode?: boolean;
    workDir?: string;
}

export interface SendMessageRequest {
    sessionId: string;
    role: ZeroAiRole;
    content: string;
    eventType?: string;
    metadata?: Record<string, unknown>;
}

export interface ZeroAiProviderInfo {
    id: string;
    displayName: string;
    displayIcon: string;
    cliCommand: string;
    cliPath: string;
    cliArgs: string[];
    envVars: Record<string, string>;
    supportsStreaming: boolean;
    defaultModel: string;
    availableModels: string[];
    authRequired: boolean;
    isAvailable: boolean;
    isCustom: boolean;
}

export interface SaveProviderRequest {
    providerId: string;
    displayName: string;
    displayIcon?: string;
    cliCommand: string;
    cliPath?: string;
    cliArgs?: string[];
    envVars?: Record<string, string>;
    supportsStreaming?: boolean;
    defaultModel?: string;
    availableModels?: string[];
    authRequired?: boolean;
}

export interface DeleteProviderRequest {
    providerId: string;
}

export interface TestProviderResult {
    success: boolean;
    version: string;
    error?: string;
    latencyMs: number;
}
