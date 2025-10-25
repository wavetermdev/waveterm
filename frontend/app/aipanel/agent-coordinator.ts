// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIAgent, AgentType, AgentStatus, AgentContext, AgentMessage, MessageType } from "./aitypes";
import * as jotai from "jotai";

export class AgentCoordinator {
    private agents: Map<string, AIAgent> = new Map();
    private messageQueue: AgentMessage[] = [];
    private isProcessing: boolean = false;

    // Jotai atoms for state management
    agentsAtom = jotai.atom<AIAgent[]>([]);
    activeAgentAtom = jotai.atom<string | null>(null);
    agentMessagesAtom = jotai.atom<AgentMessage[]>([]);

    constructor() {
        this.initializeAgents();
        this.startMessageProcessing();
    }

    private initializeAgents() {
        const defaultAgents: AIAgent[] = [
            {
                id: "command-analyzer",
                name: "Command Analyzer",
                type: "command_analysis",
                capabilities: ["command_suggestions", "command_corrections", "syntax_analysis"],
                status: "active",
                priority: 1,
                context: this.createDefaultContext(),
                settings: {
                    confidenceThreshold: 0.7,
                    maxSuggestions: 5,
                    enableCorrections: true
                }
            },
            {
                id: "context-manager",
                name: "Context Manager",
                type: "context_manager",
                capabilities: ["context_tracking", "session_management", "environment_analysis"],
                status: "active",
                priority: 2,
                context: this.createDefaultContext(),
                settings: {
                    maxContextSize: 1000,
                    enablePersistence: true,
                    contextWindow: 50
                }
            },
            {
                id: "command-explainer",
                name: "Command Explainer",
                type: "command_explanation",
                capabilities: ["command_explanations", "examples_generation", "documentation"],
                status: "active",
                priority: 3,
                context: this.createDefaultContext(),
                settings: {
                    explanationDepth: "detailed",
                    includeExamples: true,
                    maxExamples: 3
                }
            },
            {
                id: "pattern-analyzer",
                name: "Pattern Analyzer",
                type: "pattern_analysis",
                capabilities: ["pattern_detection", "optimization_suggestions", "workflow_analysis"],
                status: "active",
                priority: 4,
                context: this.createDefaultContext(),
                settings: {
                    minPatternFrequency: 2,
                    enableAutomation: true,
                    optimizationLevel: "aggressive"
                }
            },
            {
                id: "security-monitor",
                name: "Security Monitor",
                type: "security_monitor",
                capabilities: ["threat_detection", "risk_analysis", "protection_management"],
                status: "active",
                priority: 0, // Highest priority
                context: this.createDefaultContext(),
                settings: {
                    riskThreshold: "medium",
                    enableRealTimeMonitoring: true,
                    autoProtection: true
                }
            },
            {
                id: "optimization-engine",
                name: "Optimization Engine",
                type: "optimization_engine",
                capabilities: ["performance_optimization", "resource_management", "efficiency_analysis"],
                status: "active",
                priority: 5,
                context: this.createDefaultContext(),
                settings: {
                    optimizationInterval: 30000, // 30 seconds
                    enableAutoOptimization: true,
                    targetEfficiency: 0.9
                }
            },
            {
                id: "mcp-integration",
                name: "MCP Integration",
                type: "mcp_integration",
                capabilities: ["mcp_protocol", "tool_integration", "api_management"],
                status: "active",
                priority: 6,
                context: this.createDefaultContext(),
                settings: {
                    mcpPort: 3000,
                    enableToolDiscovery: true,
                    maxConnections: 10
                }
            }
        ];

        defaultAgents.forEach(agent => this.agents.set(agent.id, agent));
        this.updateAgentsAtom();
    }

    private createDefaultContext(): AgentContext {
        return {
            sessionId: "default",
            tabId: "main",
            workingDirectory: process.cwd(),
            recentCommands: [],
            environmentVariables: process.env,
            shellType: process.platform === 'win32' ? 'powershell' : 'bash',
            sharedContext: {},
            performance: {
                responseTime: 0,
                accuracy: 0,
                reliability: 1.0
            }
        };
    }

    async sendMessage(message: AgentMessage): Promise<void> {
        this.messageQueue.push(message);
        this.updateMessagesAtom();

        // Process immediately if not already processing
        if (!this.isProcessing) {
            this.processMessageQueue();
        }
    }

    private async processMessageQueue(): Promise<void> {
        if (this.isProcessing || this.messageQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift()!;
            await this.routeMessage(message);
        }

        this.isProcessing = false;
    }

    private async routeMessage(message: AgentMessage): Promise<void> {
        const targetAgent = this.agents.get(message.to);
        if (!targetAgent) {
            console.error(`Agent ${message.to} not found`);
            return;
        }

        try {
            const response = await this.processAgentMessage(targetAgent, message);
            if (response) {
                await this.sendMessage(response);
            }
        } catch (error) {
            console.error(`Error processing message for agent ${targetAgent.id}:`, error);
        }
    }

    private async processAgentMessage(agent: AIAgent, message: AgentMessage): Promise<AgentMessage | null> {
        // Update agent status to processing
        agent.status = "processing";
        this.updateAgentsAtom();

        try {
            let response: AgentMessage | null = null;

            switch (agent.type) {
                case "command_analysis":
                    response = await this.processCommandAnalysis(agent, message);
                    break;
                case "context_manager":
                    response = await this.processContextManagement(agent, message);
                    break;
                case "command_explanation":
                    response = await this.processCommandExplanation(agent, message);
                    break;
                case "pattern_analysis":
                    response = await this.processPatternAnalysis(agent, message);
                    break;
                case "security_monitor":
                    response = await this.processSecurityMonitoring(agent, message);
                    break;
                case "optimization_engine":
                    response = await this.processOptimization(agent, message);
                    break;
                case "mcp_integration":
                    response = await this.processMCPIntegration(agent, message);
                    break;
                case "coordinator":
                    response = await this.processCoordination(agent, message);
                    break;
            }

            // Update agent status back to active
            agent.status = "active";
            agent.context.performance.responseTime = Date.now() - message.timestamp;
            agent.context.performance.accuracy = this.calculateAccuracy(agent, message);

            this.updateAgentsAtom();
            return response;

        } catch (error) {
            agent.status = "error";
            this.updateAgentsAtom();
            console.error(`Agent ${agent.id} processing error:`, error);
            return null;
        }
    }

    private async processCommandAnalysis(agent: AIAgent, message: AgentMessage): Promise<AgentMessage | null> {
        const { command } = message.payload;

        // Analyze command and generate suggestions
        const analysis = await this.analyzeCommand(command, message.context);

        return {
            id: `analysis-${Date.now()}`,
            from: agent.id,
            to: message.from,
            type: "command_analysis_response",
            payload: analysis,
            timestamp: Date.now(),
            priority: message.priority,
            context: message.context
        };
    }

    private async analyzeCommand(command: string, context: AgentContext): Promise<any> {
        // Command analysis logic would go here
        // For now, return basic analysis
        return {
            command,
            suggestions: [],
            corrections: [],
            confidence: 0.8,
            context: context.workingDirectory,
            analysis: "Command analyzed successfully"
        };
    }

    private async processContextManagement(agent: AIAgent, message: AgentMessage): Promise<AgentMessage | null> {
        // Update context based on message
        const updatedContext = { ...agent.context, ...message.payload };

        return {
            id: `context-${Date.now()}`,
            from: agent.id,
            to: message.from,
            type: "context_update",
            payload: updatedContext,
            timestamp: Date.now(),
            priority: message.priority,
            context: updatedContext
        };
    }

    private async processCommandExplanation(agent: AIAgent, message: AgentMessage): Promise<AgentMessage | null> {
        const { command } = message.payload;

        const explanation = await this.generateCommandExplanation(command);

        return {
            id: `explanation-${Date.now()}`,
            from: agent.id,
            to: message.from,
            type: "command_analysis_response",
            payload: explanation,
            timestamp: Date.now(),
            priority: message.priority,
            context: message.context
        };
    }

    private async generateCommandExplanation(command: string): Promise<any> {
        // Generate explanation using AI
        return {
            command,
            purpose: "Execute a command",
            syntax: command,
            options: {},
            examples: [{ command, description: "Example usage" }],
            warnings: [],
            relatedCommands: [],
            difficulty: "beginner"
        };
    }

    private async processPatternAnalysis(agent: AIAgent, message: AgentMessage): Promise<AgentMessage | null> {
        const { commands } = message.payload;

        const analysis = await this.analyzeCommandPatterns(commands);

        return {
            id: `pattern-${Date.now()}`,
            from: agent.id,
            to: message.from,
            type: "pattern_detected",
            payload: analysis,
            timestamp: Date.now(),
            priority: message.priority,
            context: message.context
        };
    }

    private async analyzeCommandPatterns(commands: string[]): Promise<any> {
        // Pattern analysis logic
        return {
            patterns: [],
            suggestions: [],
            aliases: [],
            workflows: []
        };
    }

    private async processSecurityMonitoring(agent: AIAgent, message: AgentMessage): Promise<AgentMessage | null> {
        const analysis = await this.performSecurityAnalysis(message.context);

        return {
            id: `security-${Date.now()}`,
            from: agent.id,
            to: message.from,
            type: "security_alert",
            payload: analysis,
            timestamp: Date.now(),
            priority: 0, // High priority for security
            context: message.context
        };
    }

    private async performSecurityAnalysis(context: AgentContext): Promise<any> {
        return {
            riskLevel: "low",
            threats: [],
            protections: [],
            recommendations: []
        };
    }

    private async processOptimization(agent: AIAgent, message: AgentMessage): Promise<AgentMessage | null> {
        const optimization = await this.generateOptimization(message.context);

        return {
            id: `optimization-${Date.now()}`,
            from: agent.id,
            to: message.from,
            type: "optimization_suggestion",
            payload: optimization,
            timestamp: Date.now(),
            priority: message.priority,
            context: message.context
        };
    }

    private async generateOptimization(context: AgentContext): Promise<any> {
        return {
            performance: { responseTime: 100, throughput: 90, efficiency: 85 },
            reliability: { uptime: 99.9, errorRate: 0.1, recoveryTime: 50 },
            userExperience: { satisfaction: 95, taskCompletion: 98, learningCurve: 20 },
            resourceUsage: { memory: 45, cpu: 30, network: 15 }
        };
    }

    private async processMCPIntegration(agent: AIAgent, message: AgentMessage): Promise<AgentMessage | null> {
        // MCP integration logic
        return {
            id: `mcp-${Date.now()}`,
            from: agent.id,
            to: message.from,
            type: "coordination_response",
            payload: { status: "connected", tools: [] },
            timestamp: Date.now(),
            priority: message.priority,
            context: message.context
        };
    }

    private async processCoordination(agent: AIAgent, message: AgentMessage): Promise<AgentMessage | null> {
        // Coordination logic
        return {
            id: `coord-${Date.now()}`,
            from: agent.id,
            to: message.from,
            type: "coordination_response",
            payload: { coordinated: true, status: "success" },
            timestamp: Date.now(),
            priority: message.priority,
            context: message.context
        };
    }

    private calculateAccuracy(agent: AIAgent, message: AgentMessage): number {
        // Simple accuracy calculation based on message type and response time
        const baseAccuracy = 0.9;
        const timeBonus = Math.max(0, (1000 - agent.context.performance.responseTime) / 1000);
        return Math.min(1.0, baseAccuracy + timeBonus * 0.1);
    }

    private updateAgentsAtom() {
        const agentsArray = Array.from(this.agents.values());
        // This would update the Jotai atom in a React context
        // globalStore.set(this.agentsAtom, agentsArray);
    }

    private updateMessagesAtom() {
        // This would update the Jotai atom in a React context
        // globalStore.set(this.agentMessagesAtom, [...this.messageQueue]);
    }

    private startMessageProcessing() {
        // Start background message processing
        setInterval(() => {
            this.processMessageQueue();
        }, 100); // Process every 100ms
    }

    getAgent(id: string): AIAgent | undefined {
        return this.agents.get(id);
    }

    getAgents(): AIAgent[] {
        return Array.from(this.agents.values());
    }

    updateAgentContext(agentId: string, context: Partial<AgentContext>) {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.context = { ...agent.context, ...context };
            this.updateAgentsAtom();
        }
    }

    // Public API methods
    async requestCommandAnalysis(command: string, context: AgentContext): Promise<any> {
        const message: AgentMessage = {
            id: `req-${Date.now()}`,
            from: "user",
            to: "command-analyzer",
            type: "command_analysis_request",
            payload: { command },
            timestamp: Date.now(),
            priority: 1,
            context
        };

        return new Promise((resolve) => {
            this.sendMessage(message).then(() => {
                // In a real implementation, this would wait for the response
                // For now, return a promise that resolves with the analysis
                setTimeout(() => resolve({}), 100);
            });
        });
    }

    async requestCommandExplanation(command: string, context: AgentContext): Promise<any> {
        const message: AgentMessage = {
            id: `req-explain-${Date.now()}`,
            from: "user",
            to: "command-explanation",
            type: "command_analysis_request",
            payload: { command },
            timestamp: Date.now(),
            priority: 2,
            context
        };

        await this.sendMessage(message);
        return { status: "processing" };
    }

    async updateContext(context: AgentContext) {
        const message: AgentMessage = {
            id: `context-${Date.now()}`,
            from: "user",
            to: "context-manager",
            type: "context_update",
            payload: context,
            timestamp: Date.now(),
            priority: 3,
            context
        };

        await this.sendMessage(message);
    }
}

// Singleton instance
export const agentCoordinator = new AgentCoordinator();
