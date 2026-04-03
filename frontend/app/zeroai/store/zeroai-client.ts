// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type {
    CreateSessionRequest,
    DeleteProviderRequest,
    SaveProviderRequest,
    SendMessageRequest,
    TestProviderResult,
    ZeroAiAgentInfo,
    ZeroAiMessage,
    ZeroAiProviderInfo,
    ZeroAiSession,
    ZeroAiSessionInfo,
    ZeroAiStreamMessageEvent,
} from "../types";

/**
 * Error class for ZeroAI client errors
 */
export class ZeroAiClientError extends Error {
    constructor(
        message: string,
        public code?: string,
        public details?: any
    ) {
        super(message);
        this.name = "ZeroAiClientError";
    }
}

/**
 * Options for RPC calls - matches the project's RpcOpts
 */
export interface ZeroAiClientOpts {
    /** No response expected */
    noresponse?: boolean;
    /** Timeout in milliseconds */
    timeout?: number;
    /** Route for the RPC call */
    route?: string;
}

/**
 * ZeroAI WSH RPC Client
 * Wrapper around the WSH RPC API for ZeroAI operations
 */
export class ZeroAiClient {
    /**
     * Create a new ZeroAI session
     */
    async createSession(request: CreateSessionRequest, opts?: ZeroAiClientOpts): Promise<{ sessionId: string }> {
        try {
            const createRequest = {
                backend: request.backend,
                model: request.model,
                provider: request.provider || "",
                thinkingLevel: request.thinkingLevel || "",
                yoloMode: request.yoloMode ?? false,
                workDir: request.workDir || "",
            };
            return await RpcApi.ZeroAiCreateSessionCommand(TabRpcClient, createRequest, opts);
        } catch (error) {
            throw new ZeroAiClientError(`Failed to create session: ${error}`, "CREATE_SESSION_ERROR", error);
        }
    }

    /**
     * Get a session by ID
     */
    async getSession(sessionId: string, opts?: ZeroAiClientOpts): Promise<ZeroAiSession> {
        try {
            const result = await RpcApi.ZeroAiGetSessionCommand(TabRpcClient, { sessionId }, opts);
            return result as unknown as ZeroAiSession;
        } catch (error) {
            throw new ZeroAiClientError(`Failed to get session: ${error}`, "GET_SESSION_ERROR", error);
        }
    }

    /**
     * List all sessions
     */
    async listSessions(opts?: ZeroAiClientOpts): Promise<ZeroAiSessionInfo[]> {
        try {
            const result = await RpcApi.ZeroAiListSessionsCommand(TabRpcClient, {}, opts);
            return result.sessions || [];
        } catch (error) {
            throw new ZeroAiClientError(`Failed to list sessions: ${error}`, "LIST_SESSIONS_ERROR", error);
        }
    }

    /**
     * Delete a session
     */
    async deleteSession(sessionId: string, opts?: ZeroAiClientOpts): Promise<void> {
        try {
            await RpcApi.ZeroAiDeleteSessionCommand(TabRpcClient, { sessionId }, opts);
        } catch (error) {
            throw new ZeroAiClientError(`Failed to delete session: ${error}`, "DELETE_SESSION_ERROR", error);
        }
    }

    /**
     * Set work directory for a session
     */
    async setWorkDir(sessionId: string, workDir: string, opts?: ZeroAiClientOpts): Promise<void> {
        try {
            await RpcApi.ZeroAiSetWorkDirCommand(TabRpcClient, { sessionId, workDir }, opts);
        } catch (error) {
            throw new ZeroAiClientError(`Failed to set work directory: ${error}`, "SET_WORKDIR_ERROR", error);
        }
    }

    /**
     * Send a non-streaming message to an agent
     */
    async sendMessage(request: SendMessageRequest, opts?: ZeroAiClientOpts): Promise<{ messageId: number }> {
        try {
            const sendMessageRequest = {
                sessionId: request.sessionId,
                role: request.role,
                content: request.content,
                eventType: request.eventType || "",
                metadata: request.metadata || {},
            };
            return await RpcApi.ZeroAiSendMessageCommand(TabRpcClient, sendMessageRequest, opts);
        } catch (error) {
            throw new ZeroAiClientError(`Failed to send message: ${error}`, "SEND_MESSAGE_ERROR", error);
        }
    }

    /**
     * Send a streaming message to an agent
     * Returns an async generator that yields message events
     */
    async *streamMessage(
        request: SendMessageRequest,
        opts?: ZeroAiClientOpts
    ): AsyncGenerator<ZeroAiStreamMessageEvent, void, unknown> {
        try {
            const stream = RpcApi.ZeroAiSendStreamMessageCommand(TabRpcClient, request, opts);

            for await (const event of stream) {
                yield event as ZeroAiStreamMessageEvent;
            }
        } catch (error) {
            throw new ZeroAiClientError(`Stream failed: ${error}`, "STREAM_ERROR", error);
        }
    }

    /**
     * Get messages for a session
     */
    async getMessages(
        sessionId: string,
        opts?: ZeroAiClientOpts & { limit?: number; offset?: number }
    ): Promise<ZeroAiMessage[]> {
        try {
            const result = await RpcApi.ZeroAiGetMessagesCommand(
                TabRpcClient,
                {
                    sessionId,
                    limit: opts?.limit ?? 100,
                    offset: opts?.offset ?? 0,
                },
                opts
            );
            return result.messages || [];
        } catch (error) {
            throw new ZeroAiClientError(`Failed to get messages: ${error}`, "GET_MESSAGES_ERROR", error);
        }
    }

    /**
     * List available agents
     */
    async getAgents(opts?: ZeroAiClientOpts): Promise<ZeroAiAgentInfo[]> {
        try {
            return await RpcApi.ZeroAiGetAgentsCommand(TabRpcClient, {}, opts);
        } catch (error) {
            throw new ZeroAiClientError(`Failed to get agents: ${error}`, "GET_AGENTS_ERROR", error);
        }
    }

    /**
     * Confirm a permission request
     */
    async confirmPermission(
        sessionId: string,
        callId: string,
        optionId: string,
        confirmAll: boolean = false,
        opts?: ZeroAiClientOpts
    ): Promise<void> {
        try {
            await RpcApi.ZeroAiConfirmPermissionCommand(
                TabRpcClient,
                {
                    sessionId,
                    callId,
                    optionId,
                    confirmAll,
                },
                opts
            );
        } catch (error) {
            throw new ZeroAiClientError(`Failed to confirm permission: ${error}`, "CONFIRM_PERMISSION_ERROR", error);
        }
    }

    async listProviders(opts?: ZeroAiClientOpts): Promise<ZeroAiProviderInfo[]> {
        const result = await RpcApi.ZeroAiListProvidersCommand(TabRpcClient, {}, opts);
        return result.providers || [];
    }

    async saveProvider(request: SaveProviderRequest, opts?: ZeroAiClientOpts): Promise<void> {
        const saveRequest = {
            providerId: request.providerId,
            displayName: request.displayName,
            displayIcon: request.displayIcon || "",
            cliCommand: request.cliCommand,
            cliPath: request.cliPath || "",
            cliArgs: request.cliArgs || [],
            envVars: request.envVars || {},
            supportsStreaming: request.supportsStreaming ?? false,
            defaultModel: request.defaultModel || "",
            availableModels: request.availableModels || [],
            authRequired: request.authRequired ?? false,
        };
        await RpcApi.ZeroAiSaveProviderCommand(TabRpcClient, saveRequest, opts);
    }

    async deleteProvider(request: DeleteProviderRequest, opts?: ZeroAiClientOpts): Promise<void> {
        await RpcApi.ZeroAiDeleteProviderCommand(TabRpcClient, request, opts);
    }

    async testProvider(providerId: string, opts?: ZeroAiClientOpts): Promise<TestProviderResult> {
        const result = await RpcApi.ZeroAiTestProviderCommand(TabRpcClient, { providerId }, opts);
        return result.result as TestProviderResult;
    }
}

/**
 * Singleton ZeroAI client instance
 */
export const zeroAiClient = new ZeroAiClient();

/**
 * Retry helper for RPC calls with exponential backoff
 */
export async function retryRpcCall<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isLastAttempt = attempt === maxRetries - 1;
            if (isLastAttempt) throw error;

            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw new Error("Retry failed");
}

/**
 * Helper to execute a call with retry support
 */
export function withRetry<T>(fn: () => Promise<T>, opts: { retries?: number; delay?: number } = {}): Promise<T> {
    return retryRpcCall(fn, opts.retries ?? 3, opts.delay ?? 1000);
}
