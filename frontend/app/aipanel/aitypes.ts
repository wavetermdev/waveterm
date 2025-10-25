// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ChatRequestOptions, FileUIPart, UIMessage, UIMessagePart } from "ai";

type WaveUIDataTypes = {
    userfile: {
        filename: string;
        size: number;
        mimetype: string;
        previewurl?: string;
    };
    tooluse: {
        toolcallid: string;
        toolname: string;
        tooldesc: string;
        status: "pending" | "error" | "completed";
        errormessage?: string;
        approval?: "needs-approval" | "user-approved" | "user-denied" | "auto-approved" | "timeout";
        blockid?: string;
    };
    // Enhanced AI agent types
    commandanalysis: {
        command: string;
        suggestions: string[];
        corrections: string[];
        confidence: number;
        context: string;
        analysis: string;
    };
    commandexplanation: {
        command: string;
        purpose: string;
        options: Record<string, string>;
        examples: Array<{ command: string; description?: string }>;
        warnings?: string;
        related: string[];
    };
    patternanalysis: {
        patterns: Array<{ pattern: string; frequency: number; optimization: string }>;
        suggestions: string[];
        aliases: Array<{ alias: string; command: string; description: string }>;
        workflows: Array<{ name: string; commands: string[]; optimization: string }>;
    };
    context: {
        workingDirectory: string;
        recentCommands: string[];
        environmentVariables: Record<string, string>;
        shellType: string;
        sessionId: string;
        tabId: string;
    };
    agentcoordination: {
        agentId: string;
        agentType: string;
        status: "active" | "idle" | "processing" | "error";
        capabilities: string[];
        priority: number;
        context: Record<string, any>;
    };
    // Enhanced AI types for multi-agent system
    agent: {
        id: string;
        name: string;
        type: AgentType;
        capabilities: string[];
        status: AgentStatus;
        priority: number;
        context: AgentContext;
        settings: Record<string, any>;
    };
    commandSuggestion: {
        command: string;
        description: string;
        confidence: number;
        type: "completion" | "correction" | "optimization" | "alternative";
        context: string;
        examples: string[];
    };
    commandExplanation: {
        command: string;
        purpose: string;
        syntax: string;
        options: Record<string, { description: string; example: string }>;
        examples: Array<{ command: string; description: string; output?: string }>;
        warnings: string[];
        relatedCommands: string[];
        difficulty: "beginner" | "intermediate" | "advanced";
    };
};

export type WaveUIMessage = UIMessage<unknown, WaveUIDataTypes, {}>;
export type WaveUIMessagePart = UIMessagePart<WaveUIDataTypes, {}>;

export type UseChatSetMessagesType = (
    messages: WaveUIMessage[] | ((messages: WaveUIMessage[]) => WaveUIMessage[])
) => void;

export type UseChatSendMessageType = (
    message?:
        | (Omit<WaveUIMessage, "id" | "role"> & {
              id?: string;
              role?: "system" | "user" | "assistant";
          } & {
              text?: never;
              files?: never;
              messageId?: string;
          })
        | {
              text: string;
              files?: FileList | FileUIPart[];
              metadata?: unknown;
              parts?: never;
              messageId?: string;
          }
        | {
              files: FileList | FileUIPart[];
              metadata?: unknown;
              parts?: never;
              messageId?: string;
          },
    options?: ChatRequestOptions
) => Promise<void>;

export interface AIAgent {
    id: string;
    name: string;
    type: AgentType;
    capabilities: string[];
    status: AgentStatus;
    priority: number;
    context: AgentContext;
    settings: Record<string, any>;
}

export type AgentStatus = "active" | "idle" | "processing" | "error" | "disabled";

export type AgentType =
    | "command_analysis"
    | "context_manager"
    | "command_explanation"
    | "pattern_analysis"
    | "security_monitor"
    | "optimization_engine"
    | "coordinator"
    | "mcp_integration";

export interface AgentContext {
    sessionId: string;
    tabId: string;
    workingDirectory: string;
    recentCommands: string[];
    environmentVariables: Record<string, string>;
    shellType: string;
    sharedContext: Record<string, any>;
    performance: {
        responseTime: number;
        accuracy: number;
        reliability: number;
    };
}

export interface AgentMessage {
    id: string;
    from: string;
    to: string;
    type: MessageType;
    payload: any;
    timestamp: number;
    priority: number;
    context: AgentContext;
}

export type MessageType =
    | "command_analysis_request"
    | "command_analysis_response"
    | "context_update"
    | "pattern_detected"
    | "optimization_suggestion"
    | "security_alert"
    | "coordination_request"
    | "coordination_response"
    | "status_update"
    | "error_report";

export interface CommandSuggestion {
    command: string;
    description: string;
    confidence: number;
    type: "completion" | "correction" | "optimization" | "alternative";
    context: string;
    examples: string[];
}

export interface CommandExplanation {
    command: string;
    purpose: string;
    syntax: string;
    options: Record<string, { description: string; example: string }>;
    examples: Array<{ command: string; description: string; output?: string }>;
    warnings: string[];
    relatedCommands: string[];
    difficulty: "beginner" | "intermediate" | "advanced";
}

export interface PatternAnalysis {
    patterns: Array<{
        pattern: string;
        frequency: number;
        trend: "increasing" | "decreasing" | "stable";
        optimization: string;
        automation: string;
    }>;
    workflowSuggestions: Array<{
        name: string;
        description: string;
        commands: string[];
        timeSavings: string;
        automation: string;
    }>;
    commandAliases: Array<{
        alias: string;
        command: string;
        description: string;
        usage: number;
    }>;
}

export interface SecurityAnalysis {
    riskLevel: "low" | "medium" | "high" | "critical";
    threats: Array<{
        type: string;
        severity: string;
        description: string;
        recommendation: string;
    }>;
    protections: Array<{
        type: string;
        status: "active" | "inactive" | "failed";
        description: string;
    }>;
    recommendations: string[];
}

export interface OptimizationMetrics {
    performance: {
        responseTime: number;
        throughput: number;
        efficiency: number;
    };
    reliability: {
        uptime: number;
        errorRate: number;
        recoveryTime: number;
    };
    userExperience: {
        satisfaction: number;
        taskCompletion: number;
        learningCurve: number;
    };
    resourceUsage: {
        memory: number;
        cpu: number;
        network: number;
    };
}
