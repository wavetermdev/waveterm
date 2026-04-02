// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabRpcClient } from "@/app/store/wshrpcutil";
import type {
    CreateSessionRequest,
    SendMessageRequest,
    ZeroAiAgentInfo,
    ZeroAiMessage,
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
            const client = TabRpcClient;
            // Note: After running `task generate`, use:
            // return RpcApi.ZeroAiCreateSessionCommand(client, request, opts);
            // For now, use direct call
            const result = await client.wshRpcCall(
                "zeroaicreatesession",
                {
                    backend: request.backend,
                    model: request.model,
                    provider: request.provider,
                    thinkingLevel: request.thinkingLevel,
                    yoloMode: request.yoloMode ?? false,
                    workDir: request.workDir ?? "",
                },
                opts
            );
            return result;
        } catch (error) {
            throw new ZeroAiClientError(`Failed to create session: ${error}`, "CREATE_SESSION_ERROR", error);
        }
    }

    /**
     * Get a session by ID
     */
    async getSession(sessionId: string, opts?: ZeroAiClientOpts): Promise<ZeroAiSession> {
        try {
            const client = TabRpcClient;
            // Note: After running `task generate`, use:
            // return RpcApi.ZeroAiGetSessionCommand(client, { sessionId }, opts);
            const result = await client.wshRpcCall("zeroaigetsession", { sessionId }, opts);
            return result;
        } catch (error) {
            throw new ZeroAiClientError(`Failed to get session: ${error}`, "GET_SESSION_ERROR", error);
        }
    }

    /**
     * List all sessions
     */
    async listSessions(opts?: ZeroAiClientOpts): Promise<ZeroAiSessionInfo[]> {
        try {
            const client = TabRpcClient;
            // Note: After running `task generate`, use:
            // const result = await RpcApi.ZeroAiListSessionsCommand(client, {}, opts);
            // return result.sessions;
            const result = await client.wshRpcCall("zeroailistsessions", {}, opts);
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
            const client = TabRpcClient;
            // Note: After running `task generate`, use:
            // await RpcApi.ZeroAiDeleteSessionCommand(client, { sessionId }, opts);
            await client.wshRpcCall("zeroaideletesession", { sessionId }, opts);
        } catch (error) {
            throw new ZeroAiClientError(`Failed to delete session: ${error}`, "DELETE_SESSION_ERROR", error);
        }
    }

    /**
     * Set work directory for a session
     */
    async setWorkDir(sessionId: string, workDir: string, opts?: ZeroAiClientOpts): Promise<void> {
        try {
            const client = TabRpcClient;
            // Note: After running `task generate`, use:
            // await RpcApi.ZeroAiSetWorkDirCommand(client, { sessionId, workDir }, opts);
            await client.wshRpcCall("zeroaisetworkdir", { sessionId, workDir }, opts);
        } catch (error) {
            throw new ZeroAiClientError(`Failed to set work directory: ${error}`, "SET_WORKDIR_ERROR", error);
        }
    }

    /**
     * Send a non-streaming message to an agent
     */
    async sendMessage(request: SendMessageRequest, opts?: ZeroAiClientOpts): Promise<{ messageId: number }> {
        try {
            const client = TabRpcClient;
            // Note: After running `task generate`, use:
            // return RpcApi.ZeroAiSendMessageCommand(client, request, opts);
            const result = await client.wshRpcCall(
                "zeroaisendmessage",
                {
                    sessionId: request.sessionId,
                    role: request.role,
                    content: request.content,
                    eventType: request.eventType,
                    metadata: request.metadata ?? {},
                },
                opts
            );
            return result;
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
        const client = TabRpcClient;
        // Note: After running `task generate`, use:
        // const stream = RpcApi.ZeroAiSendStreamMessageCommand(client, request, opts);
        const stream = client.wshRpcStream(
            "zeroaisendstreammessage",
            {
                sessionId: request.sessionId,
                role: request.role,
                content: request.content,
                eventType: request.eventType,
                metadata: request.metadata ?? {},
            },
            opts
        );

        try {
            for await (const event of stream) {
                if (event.error) {
                    throw new ZeroAiClientError(`Stream error: ${event.error}`, "STREAM_ERROR", event.error);
                }
                yield event.response as ZeroAiStreamMessageEvent;
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
            const client = TabRpcClient;
            // Note: After running `task generate`, use:
            // const result = await RpcApi.ZeroAiGetMessagesCommand(client, { sessionId, limit, offset }, opts);
            // return result.messages;
            const result = await client.wshRpcCall(
                "zeroaigetmessages",
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
            const client = TabRpcClient;
            // Note: After running `task generate`, use:
            // return RpcApi.ZeroAiGetAgentsCommand(client, {}, opts);
            const result = await client.wshRpcCall("zeroaigetagents", {}, opts);
            return result.agents || [];
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
            const client = TabRpcClient;
            // Note: After running `task generate`, use:
            // await RpcApi.ZeroAiConfirmPermissionCommand(client, { sessionId, callId, optionId, confirmAll }, opts);
            await client.wshRpcCall(
                "zeroaiconfirmermission",
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
