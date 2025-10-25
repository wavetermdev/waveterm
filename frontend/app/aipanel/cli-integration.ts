// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ecosystemIntegration } from "./ecosystem-integration";
import { AgentContext } from "./aitypes";

interface CLICommand {
    id: string;
    name: string;
    description: string;
    category: "legal" | "forensics" | "memory" | "development" | "mcp" | "analysis";
    repositories: string[];
    command: string;
    parameters: Array<{
        name: string;
        type: string;
        required: boolean;
        description: string;
        default?: any;
    }>;
    examples: string[];
    capabilities: string[];
    riskLevel: "low" | "medium" | "high";
}

interface CLIWorkflow {
    id: string;
    name: string;
    description: string;
    category: string;
    commands: string[];
    parameters: Record<string, any>;
    automation: boolean;
    timeSavings: string;
}

export class CLIIntegrationService {
    private commands: Map<string, CLICommand> = new Map();
    private workflows: Map<string, CLIWorkflow> = new Map();
    private isInitialized: boolean = false;

    constructor() {
        this.initializeCLICommands();
        this.initializeCLIWorkflows();
    }

    private initializeCLICommands(): void {
        const comprehensiveCommands: CLICommand[] = [
            // Legal AI Commands
            {
                id: "legal-search",
                name: "legal search",
                description: "Search legal documents and cases using AI analysis",
                category: "legal",
                repositories: ["legal-ai-project", "hawaii-docket-automation"],
                command: "legal search [query] --jurisdiction=hawaii --case-type=civil",
                parameters: [
                    { name: "query", type: "string", required: true, description: "Legal search query" },
                    { name: "jurisdiction", type: "string", required: false, description: "Legal jurisdiction", default: "hawaii" },
                    { name: "case-type", type: "string", required: false, description: "Type of case", default: "civil" }
                ],
                examples: [
                    "legal search \"contract breach\" --jurisdiction=hawaii --case-type=civil",
                    "legal search \"property dispute\" --case-type=real-estate"
                ],
                capabilities: ["document_analysis", "case_research", "legal_compliance"],
                riskLevel: "low"
            },
            {
                id: "forensics-analyze",
                name: "forensics analyze",
                description: "Analyze evidence files using forensic tools",
                category: "forensics",
                repositories: ["forensic-transcriber", "digital-forensics-report"],
                command: "forensics analyze [file] --type=document --chain-of-custody",
                parameters: [
                    { name: "file", type: "string", required: true, description: "Evidence file path" },
                    { name: "type", type: "string", required: false, description: "Evidence type", default: "document" },
                    { name: "chain-of-custody", type: "boolean", required: false, description: "Maintain chain of custody" }
                ],
                examples: [
                    "forensics analyze evidence.pdf --type=document --chain-of-custody",
                    "forensics analyze audio.mp3 --type=audio"
                ],
                capabilities: ["evidence_analysis", "timeline", "chain_of_custody"],
                riskLevel: "medium"
            },
            {
                id: "docket-fetch",
                name: "docket fetch",
                description: "Fetch court docket information and case details",
                category: "legal",
                repositories: ["hawaii-docket-automation", "federal-admissibility-report"],
                command: "docket fetch --court=federal --date-range=2025-01-01:2025-12-31",
                parameters: [
                    { name: "court", type: "string", required: false, description: "Court type", default: "federal" },
                    { name: "date-range", type: "string", required: false, description: "Date range for cases" }
                ],
                examples: [
                    "docket fetch --court=federal --date-range=2025-01-01:2025-12-31",
                    "docket fetch --court=state --date-range=2025-10-01:2025-10-31"
                ],
                capabilities: ["court_automation", "docket_management", "case_tracking"],
                riskLevel: "low"
            },

            // Memory & Intelligence Commands
            {
                id: "memory-recall",
                name: "memory recall",
                description: "Recall information from memory systems",
                category: "memory",
                repositories: ["glaciereq-memory-master", "supermemory", "quantum-memory-orchestrator"],
                command: "memory recall [query] --sources=all --relevance=0.9 --context=legal",
                parameters: [
                    { name: "query", type: "string", required: true, description: "Memory search query" },
                    { name: "sources", type: "string", required: false, description: "Memory sources", default: "all" },
                    { name: "relevance", type: "number", required: false, description: "Relevance threshold", default: 0.9 },
                    { name: "context", type: "string", required: false, description: "Context filter" }
                ],
                examples: [
                    "memory recall \"previous legal research on similar case\"",
                    "memory recall \"contract templates\" --context=legal --relevance=0.95"
                ],
                capabilities: ["context_storage", "recall", "memory_management"],
                riskLevel: "low"
            },
            {
                id: "quantum-reason",
                name: "quantum reason",
                description: "Advanced reasoning using quantum intelligence systems",
                category: "development",
                repositories: ["godmind-quantum-intelligence", "quantum-memory-orchestrator"],
                command: "quantum reason [query] --context=evidence --models=claude,gpt4",
                parameters: [
                    { name: "query", type: "string", required: true, description: "Reasoning query" },
                    { name: "context", type: "string", required: false, description: "Context type" },
                    { name: "models", type: "string", required: false, description: "AI models to use" }
                ],
                examples: [
                    "quantum reason \"analyze case strategy\" --context=evidence --models=claude,gpt4",
                    "quantum reason \"optimize workflow\" --models=all"
                ],
                capabilities: ["quantum_reasoning", "advanced_intelligence", "multi_model_coordination"],
                riskLevel: "medium"
            },

            // Development & Automation Commands
            {
                id: "dev-setup",
                name: "dev setup",
                description: "Setup development projects with AI assistance",
                category: "development",
                repositories: ["wave-terminal", "fileboss-automation", "crewai"],
                command: "dev setup [project] --framework=langchain --integrations=mcp,supabase",
                parameters: [
                    { name: "project", type: "string", required: true, description: "Project name" },
                    { name: "framework", type: "string", required: false, description: "Development framework" },
                    { name: "integrations", type: "string", required: false, description: "Integration list" }
                ],
                examples: [
                    "dev setup legal-ai-project --framework=langchain --integrations=mcp,supabase",
                    "dev setup automation-system --framework=crewai --integrations=all"
                ],
                capabilities: ["development", "project_setup", "integration"],
                riskLevel: "low"
            },
            {
                id: "test-run",
                name: "test run",
                description: "Run comprehensive tests across the ecosystem",
                category: "development",
                repositories: ["wave-terminal", "fileboss-automation"],
                command: "test run all --coverage --security --performance",
                parameters: [
                    { name: "scope", type: "string", required: false, description: "Test scope", default: "all" },
                    { name: "coverage", type: "boolean", required: false, description: "Include coverage" },
                    { name: "security", type: "boolean", required: false, description: "Security testing" },
                    { name: "performance", type: "boolean", required: false, description: "Performance testing" }
                ],
                examples: [
                    "test run all --coverage --security --performance",
                    "test run legal-ai --security"
                ],
                capabilities: ["testing", "quality_assurance", "validation"],
                riskLevel: "low"
            },

            // MCP Protocol Commands
            {
                id: "mcp-connect",
                name: "mcp connect",
                description: "Connect to MCP servers and establish communication",
                category: "mcp",
                repositories: ["hyper-intelligent-mcp-hub", "browserbase-mcp", "mongodb-mcp"],
                command: "mcp connect [server] --port=3000 --capabilities=all",
                parameters: [
                    { name: "server", type: "string", required: true, description: "MCP server name" },
                    { name: "port", type: "number", required: false, description: "Server port", default: 3000 },
                    { name: "capabilities", type: "string", required: false, description: "Required capabilities" }
                ],
                examples: [
                    "mcp connect mongodb --port=3003 --capabilities=database,query",
                    "mcp connect browserbase --capabilities=web_automation,scraping"
                ],
                capabilities: ["mcp_coordination", "service_discovery", "protocol_management"],
                riskLevel: "low"
            },
            {
                id: "agent-coordinate",
                name: "agent coordinate",
                description: "Coordinate multiple AI agents for complex tasks",
                category: "development",
                repositories: ["crewai", "fileboss-automation", "ninja-swarm-manager"],
                command: "agent coordinate [task] --agents=doc-analyzer,case-finder,precedent-search",
                parameters: [
                    { name: "task", type: "string", required: true, description: "Coordination task" },
                    { name: "agents", type: "string", required: false, description: "Agent list" },
                    { name: "parallel", type: "boolean", required: false, description: "Parallel execution" }
                ],
                examples: [
                    "agent coordinate legal-research --agents=doc-analyzer,case-finder,precedent-search",
                    "agent coordinate code-review --agents=all --parallel"
                ],
                capabilities: ["multi_agent", "coordination", "workflow_management"],
                riskLevel: "medium"
            }
        ];

        // Register all commands
        comprehensiveCommands.forEach(cmd => {
            this.commands.set(cmd.id, cmd);
        });

        this.isInitialized = true;
        console.log(`🖥️ CLI Integration initialized with ${comprehensiveCommands.length} commands`);
        console.log(`📋 Command categories:`, {
            legal: comprehensiveCommands.filter(c => c.category === "legal").length,
            forensics: comprehensiveCommands.filter(c => c.category === "forensics").length,
            memory: comprehensiveCommands.filter(c => c.category === "memory").length,
            development: comprehensiveCommands.filter(c => c.category === "development").length,
            mcp: comprehensiveCommands.filter(c => c.category === "mcp").length,
            analysis: comprehensiveCommands.filter(c => c.category === "analysis").length
        });
    }

    private initializeCLIWorkflows(): void {
        const comprehensiveWorkflows: CLIWorkflow[] = [
            {
                id: "legal-case-analysis",
                name: "Legal Case Analysis",
                description: "Complete legal case analysis workflow",
                category: "legal",
                commands: ["legal-search", "docket-fetch", "memory-recall", "quantum-reason"],
                parameters: {
                    jurisdiction: "hawaii",
                    caseType: "civil",
                    analysisDepth: "comprehensive"
                },
                automation: true,
                timeSavings: "4-6 hours"
            },
            {
                id: "forensic-investigation",
                name: "Forensic Investigation",
                description: "Digital forensic investigation workflow",
                category: "forensics",
                commands: ["forensics-analyze", "memory-recall", "agent-coordinate"],
                parameters: {
                    evidenceType: "digital",
                    chainOfCustody: true,
                    reportFormat: "court-ready"
                },
                automation: true,
                timeSavings: "2-3 hours"
            },
            {
                id: "ai-development-setup",
                name: "AI Development Setup",
                description: "Complete AI project setup and integration",
                category: "development",
                commands: ["dev-setup", "test-run", "mcp-connect", "agent-coordinate"],
                parameters: {
                    framework: "langchain",
                    integrations: "all",
                    testing: "comprehensive"
                },
                automation: true,
                timeSavings: "1-2 hours"
            }
        ];

        // Register all workflows
        comprehensiveWorkflows.forEach(workflow => {
            this.workflows.set(workflow.id, workflow);
        });

        console.log(`⚡ CLI Workflows initialized with ${comprehensiveWorkflows.length} automation workflows`);
    }

    public getCommands(): CLICommand[] {
        return Array.from(this.commands.values());
    }

    public getCommand(id: string): CLICommand | undefined {
        return this.commands.get(id);
    }

    public getCommandsByCategory(category: string): CLICommand[] {
        return Array.from(this.commands.values()).filter(cmd => cmd.category === category);
    }

    public getWorkflows(): CLIWorkflow[] {
        return Array.from(this.workflows.values());
    }

    public getWorkflow(id: string): CLIWorkflow | undefined {
        return this.workflows.get(id);
    }

    public generateCommandString(commandId: string, parameters: Record<string, any>): string {
        const command = this.commands.get(commandId);
        if (!command) {
            throw new Error(`Command ${commandId} not found`);
        }

        let cmdString = command.command;

        // Replace parameters in command string
        Object.entries(parameters).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                // Handle boolean flags
                if (typeof value === "boolean" && value) {
                    cmdString += ` --${key}`;
                } else if (typeof value !== "boolean") {
                    cmdString = cmdString.replace(`[${key}]`, value.toString());
                    if (key !== "query" && key !== "file") {
                        cmdString += ` --${key}=${value}`;
                    }
                }
            }
        });

        return cmdString;
    }

    public async executeCommand(commandId: string, parameters: Record<string, any>, context: AgentContext): Promise<any> {
        const command = this.commands.get(commandId);
        if (!command) {
            throw new Error(`Command ${commandId} not found`);
        }

        console.log(`🖥️ Executing CLI command: ${command.name}`);
        console.log(`📋 Command: ${this.generateCommandString(commandId, parameters)}`);

        // Find appropriate repositories for this command
        const availableRepos = command.repositories.filter(repoId => {
            const repo = ecosystemIntegration.getRepository(repoId);
            return repo && repo.status === "active";
        });

        if (availableRepos.length === 0) {
            throw new Error(`No active repositories available for command ${command.name}`);
        }

        // Execute through the first available repository
        const targetRepo = ecosystemIntegration.getRepository(availableRepos[0]);
        if (!targetRepo) {
            throw new Error(`Target repository not found`);
        }

        // Simulate command execution through MCP
        const result = {
            command: command.name,
            commandString: this.generateCommandString(commandId, parameters),
            repository: targetRepo.name,
            timestamp: Date.now(),
            success: true,
            output: `Executed ${command.name} through ${targetRepo.name} with parameters: ${JSON.stringify(parameters)}`
        };

        return result;
    }

    public getCommandSuggestions(context: string): CLICommand[] {
        // Find commands that match the current context
        const contextKeywords = context.toLowerCase().split(' ');

        return Array.from(this.commands.values()).filter(cmd => {
            const cmdText = `${cmd.name} ${cmd.description} ${cmd.capabilities.join(' ')}`.toLowerCase();
            return contextKeywords.some(keyword => cmdText.includes(keyword));
        }).slice(0, 5); // Return top 5 matches
    }

    public getCapabilityMatrix(): Record<string, string[]> {
        const matrix: Record<string, string[]> = {};

        this.commands.forEach(cmd => {
            cmd.capabilities.forEach(cap => {
                if (!matrix[cap]) {
                    matrix[cap] = [];
                }
                matrix[cap].push(cmd.name);
            });
        });

        return matrix;
    }

    public validateCommand(commandId: string, parameters: Record<string, any>): { valid: boolean; errors: string[] } {
        const command = this.commands.get(commandId);
        if (!command) {
            return { valid: false, errors: [`Command ${commandId} not found`] };
        }

        const errors: string[] = [];

        // Check required parameters
        command.parameters.forEach(param => {
            if (param.required && (parameters[param.name] === undefined || parameters[param.name] === null)) {
                errors.push(`Required parameter '${param.name}' is missing`);
            }
        });

        // Check parameter types
        Object.entries(parameters).forEach(([key, value]) => {
            const param = command.parameters.find(p => p.name === key);
            if (param && value !== undefined && value !== null) {
                // Type validation could be enhanced here
                if (param.type === "number" && isNaN(Number(value))) {
                    errors.push(`Parameter '${key}' must be a number`);
                }
            }
        });

        return { valid: errors.length === 0, errors };
    }

    public getCLIStatus(): {
        totalCommands: number;
        totalWorkflows: number;
        categories: string[];
        activeRepositories: number;
        capabilities: string[];
    } {
        const repos = ecosystemIntegration.getActiveRepositories();

        return {
            totalCommands: this.commands.size,
            totalWorkflows: this.workflows.size,
            categories: [...new Set(Array.from(this.commands.values()).map(c => c.category))],
            activeRepositories: repos.length,
            capabilities: Object.keys(this.getCapabilityMatrix())
        };
    }
}

// Global CLI integration instance
export const cliIntegration = new CLIIntegrationService();
