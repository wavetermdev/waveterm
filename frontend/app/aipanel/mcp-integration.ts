// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AgentContext, AgentMessage, MessageType } from "./aitypes";

interface MCPTool {
    id: string;
    name: string;
    description: string;
    parameters: Record<string, any>;
    capabilities: string[];
    endpoint?: string;
    status: "connected" | "disconnected" | "error";
}

interface MCPConnection {
    id: string;
    server: string;
    port: number;
    tools: MCPTool[];
    status: "connected" | "disconnected" | "error";
    lastHeartbeat: number;
}

export class MCPIntegrationService {
    private connections: Map<string, MCPConnection> = new Map();
    private tools: Map<string, MCPTool> = new Map();
    private isInitialized: boolean = false;
    private heartbeatInterval: NodeJS.Timeout | null = null;

    // Default MCP servers to connect to
    private defaultServers = [
        {
            id: "wave-terminal-mcp",
            server: "localhost",
            port: 3000,
            name: "Wave Terminal MCP Server",
            tools: ["terminal", "file_system", "process_management", "ai_chat"]
        },
        {
            id: "claude-mcp",
            server: "localhost",
            port: 3001,
            name: "Claude MCP Server",
            tools: ["ai_assistance", "code_analysis", "documentation"]
        },
        {
            id: "codex-mcp",
            server: "localhost",
            port: 3002,
            name: "Codex MCP Server",
            tools: ["code_execution", "debugging", "testing"]
        }
    ];

    constructor() {
        this.initialize();
    }

    private async initialize(): Promise<void> {
        if (this.isInitialized) return;

        console.log("Initializing MCP Integration Service...");

        try {
            // Start heartbeat monitoring
            this.startHeartbeat();

            // Connect to default servers
            await this.connectToDefaultServers();

            this.isInitialized = true;
            console.log("MCP Integration Service initialized successfully");

        } catch (error) {
            console.error("Error initializing MCP service:", error);
        }
    }

    private async connectToDefaultServers(): Promise<void> {
        for (const serverConfig of this.defaultServers) {
            try {
                await this.connectToServer(serverConfig);
            } catch (error) {
                console.warn(`Failed to connect to MCP server ${serverConfig.name}:`, error);
            }
        }
    }

    private async connectToServer(serverConfig: any): Promise<void> {
        const connection: MCPConnection = {
            id: serverConfig.id,
            server: serverConfig.server,
            port: serverConfig.port,
            tools: [],
            status: "disconnected",
            lastHeartbeat: 0
        };

        this.connections.set(connection.id, connection);

        try {
            // Attempt to connect via WebSocket or HTTP
            const tools = await this.discoverTools(connection);
            connection.tools = tools;
            connection.status = "connected";
            connection.lastHeartbeat = Date.now();

            // Register tools
            tools.forEach(tool => {
                this.tools.set(tool.id, tool);
            });

            console.log(`Connected to MCP server ${serverConfig.name} with ${tools.length} tools`);

        } catch (error) {
            connection.status = "error";
            console.error(`Failed to connect to ${serverConfig.name}:`, error);
        }
    }

    private async discoverTools(connection: MCPConnection): Promise<MCPTool[]> {
        // In a real implementation, this would query the MCP server for available tools
        // For now, return mock tools based on server configuration
        const mockTools: MCPTool[] = [];

        for (const toolName of connection.server === "localhost" ? ["terminal", "file_system", "ai_chat"] : ["ai_assistance", "code_analysis"]) {
            mockTools.push({
                id: `${connection.id}_${toolName}`,
                name: toolName,
                description: `MCP tool for ${toolName} operations`,
                parameters: {},
                capabilities: [toolName],
                endpoint: `ws://${connection.server}:${connection.port}/mcp/${toolName}`,
                status: "connected"
            });
        }

        return mockTools;
    }

    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            this.checkConnections();
        }, 5000); // Check every 5 seconds
    }

    private async checkConnections(): Promise<void> {
        for (const [connectionId, connection] of this.connections) {
            if (connection.status === "connected") {
                const timeSinceHeartbeat = Date.now() - connection.lastHeartbeat;

                if (timeSinceHeartbeat > 30000) { // 30 seconds timeout
                    connection.status = "disconnected";
                    console.warn(`MCP connection ${connectionId} timed out`);
                }
            }
        }
    }

    // Public API methods
    async executeTool(toolId: string, parameters: Record<string, any>, context: AgentContext): Promise<any> {
        const tool = this.tools.get(toolId);
        if (!tool) {
            throw new Error(`Tool ${toolId} not found`);
        }

        if (tool.status !== "connected") {
            throw new Error(`Tool ${toolId} is not connected`);
        }

        try {
            // In a real implementation, this would make an HTTP/WebSocket call to the MCP server
            const result = await this.callMCPTool(tool, parameters, context);

            // Update tool usage statistics
            tool.parameters = { ...tool.parameters, lastUsed: Date.now() };

            return result;

        } catch (error) {
            console.error(`Error executing tool ${toolId}:`, error);
            throw error;
        }
    }

    private async callMCPTool(tool: MCPTool, parameters: Record<string, any>, context: AgentContext): Promise<any> {
        // Mock implementation - in reality this would call the MCP server
        console.log(`Executing MCP tool ${tool.name} with parameters:`, parameters);

        // Simulate different tool responses based on tool type
        switch (tool.name) {
            case "terminal":
                return {
                    type: "terminal_command",
                    command: parameters.command,
                    output: `Mock terminal output for: ${parameters.command}`,
                    success: true
                };

            case "file_system":
                return {
                    type: "file_operation",
                    operation: parameters.operation,
                    path: parameters.path,
                    success: true,
                    result: `File operation ${parameters.operation} completed`
                };

            case "ai_chat":
                return {
                    type: "ai_response",
                    message: parameters.message,
                    response: `AI response to: ${parameters.message}`,
                    model: parameters.model || "gpt-3.5-turbo"
                };

            case "code_analysis":
                return {
                    type: "code_analysis",
                    file: parameters.file,
                    analysis: {
                        syntax: "valid",
                        complexity: "medium",
                        suggestions: ["Add error handling", "Optimize performance"]
                    }
                };

            default:
                return {
                    type: "generic_response",
                    tool: tool.name,
                    parameters,
                    result: `Tool ${tool.name} executed successfully`
                };
        }
    }

    async discoverAvailableTools(): Promise<MCPTool[]> {
        const allTools: MCPTool[] = [];

        for (const connection of this.connections.values()) {
            if (connection.status === "connected") {
                allTools.push(...connection.tools);
            }
        }

        return allTools;
    }

    getConnectedTools(): MCPTool[] {
        return Array.from(this.tools.values()).filter(tool => tool.status === "connected");
    }

    getConnectionStatus(): Record<string, string> {
        const status: Record<string, string> = {};

        for (const [id, connection] of this.connections) {
            status[id] = connection.status;
        }

        return status;
    }

    async addCustomServer(serverConfig: { id: string; server: string; port: number; name: string; tools: string[] }): Promise<void> {
        await this.connectToServer(serverConfig);
    }

    async removeServer(serverId: string): Promise<void> {
        const connection = this.connections.get(serverId);
        if (connection) {
            // Disconnect and clean up
            connection.status = "disconnected";
            connection.tools.forEach(tool => {
                this.tools.delete(tool.id);
            });
            this.connections.delete(serverId);
        }
    }

    // Agent integration methods
    async registerAgentWithMCP(agentId: string, capabilities: string[]): Promise<void> {
        // Register agent capabilities with connected MCP servers
        for (const connection of this.connections.values()) {
            if (connection.status === "connected") {
                await this.notifyServerOfAgent(connection, agentId, capabilities);
            }
        }
    }

    private async notifyServerOfAgent(connection: MCPConnection, agentId: string, capabilities: string[]): Promise<void> {
        // Notify MCP server about new agent
        try {
            // This would send a registration message to the MCP server
            console.log(`Registering agent ${agentId} with MCP server ${connection.id}`);
        } catch (error) {
            console.error(`Error registering agent with MCP server ${connection.id}:`, error);
        }
    }

    // Cleanup
    destroy(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        // Disconnect all connections
        for (const connection of this.connections.values()) {
            connection.status = "disconnected";
        }

        this.connections.clear();
        this.tools.clear();
        this.isInitialized = false;
    }
}

// Singleton instance
export const mcpService = new MCPIntegrationService();
