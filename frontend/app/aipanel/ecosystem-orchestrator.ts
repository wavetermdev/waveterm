// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AgentContext, AgentMessage, MessageType } from "./aitypes";
import { ecosystemIntegration } from "./ecosystem-integration";
import { AgentCoordinator } from "./agent-coordinator";

interface OrchestrationTask {
    id: string;
    name: string;
    description: string;
    priority: number;
    status: "pending" | "running" | "completed" | "failed";
    repository: string;
    agent: string;
    parameters: Record<string, any>;
    dependencies: string[];
    result?: any;
    error?: string;
    startedAt?: number;
    completedAt?: number;
}

interface OrchestrationWorkflow {
    id: string;
    name: string;
    description: string;
    tasks: OrchestrationTask[];
    status: "idle" | "running" | "completed" | "failed";
    currentTaskIndex: number;
    context: AgentContext;
    results: Record<string, any>;
    errors: string[];
}

interface EcosystemMetrics {
    totalRepositories: number;
    activeRepositories: number;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    averageResponseTime: number;
    uptime: number;
    lastActivity: number;
}

export class EcosystemOrchestrator {
    private workflows: Map<string, OrchestrationWorkflow> = new Map();
    private tasks: Map<string, OrchestrationTask> = new Map();
    private isRunning: boolean = false;
    private metrics: EcosystemMetrics;
    private agentCoordinator: AgentCoordinator;

    constructor(agentCoordinator: AgentCoordinator) {
        this.agentCoordinator = agentCoordinator;
        this.metrics = this.initializeMetrics();
        this.startOrchestration();
    }

    private initializeMetrics(): EcosystemMetrics {
        return {
            totalRepositories: 0,
            activeRepositories: 0,
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            averageResponseTime: 0,
            uptime: 100,
            lastActivity: Date.now()
        };
    }

    private startOrchestration(): void {
        this.isRunning = true;
        console.log("🚀 Ecosystem Orchestrator started");

        // Start periodic health checks
        setInterval(() => {
            this.performHealthCheck();
        }, 30000); // Every 30 seconds

        // Start task processing
        this.processPendingTasks();
    }

    public async createWorkflow(
        name: string,
        description: string,
        tasks: Omit<OrchestrationTask, "id" | "status" | "startedAt" | "completedAt" | "result" | "error">[],
        context: AgentContext
    ): Promise<string> {
        const workflowId = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const workflow: OrchestrationWorkflow = {
            id: workflowId,
            name,
            description,
            tasks: tasks.map(task => ({
                ...task,
                id: `${workflowId}_task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                status: "pending"
            })),
            status: "idle",
            currentTaskIndex: 0,
            context,
            results: {},
            errors: []
        };

        this.workflows.set(workflowId, workflow);

        // Add tasks to task registry
        workflow.tasks.forEach(task => {
            this.tasks.set(task.id, task);
        });

        this.metrics.totalTasks += tasks.length;
        this.updateMetrics();

        console.log(`📋 Created orchestration workflow: ${name} (${workflowId})`);

        // Start workflow execution
        this.executeWorkflow(workflowId);

        return workflowId;
    }

    private async executeWorkflow(workflowId: string): Promise<void> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow ${workflowId} not found`);
        }

        workflow.status = "running";
        console.log(`▶️ Executing workflow: ${workflow.name}`);

        try {
            for (let i = 0; i < workflow.tasks.length; i++) {
                workflow.currentTaskIndex = i;
                const task = workflow.tasks[i];

                // Check dependencies
                if (task.dependencies.length > 0) {
                    const dependenciesMet = task.dependencies.every(depId => {
                        const depTask = this.tasks.get(depId);
                        return depTask && depTask.status === "completed";
                    });

                    if (!dependenciesMet) {
                        console.log(`⏳ Task ${task.name} waiting for dependencies`);
                        continue;
                    }
                }

                // Execute task
                await this.executeTask(task, workflow.context);

                // Store result
                workflow.results[task.id] = task.result;
            }

            workflow.status = "completed";
            console.log(`✅ Workflow completed: ${workflow.name}`);

        } catch (error) {
            workflow.status = "failed";
            workflow.errors.push(error.message);
            console.error(`❌ Workflow failed: ${workflow.name}`, error);
        }
    }

    private async executeTask(task: OrchestrationTask, context: AgentContext): Promise<void> {
        task.status = "running";
        task.startedAt = Date.now();

        try {
            console.log(`⚙️ Executing task: ${task.name} (Repository: ${task.repository})`);

            // Use ecosystem integration to execute through appropriate repository
            const repo = ecosystemIntegration.getRepository(task.repository);
            if (!repo) {
                throw new Error(`Repository ${task.repository} not found`);
            }

            if (repo.status !== "active") {
                throw new Error(`Repository ${task.repository} is not active`);
            }

            // Execute through MCP or agent system
            if (repo.integration.mcpPort) {
                await this.executeThroughMCP(task, repo);
            } else {
                await this.executeThroughAgent(task, context);
            }

            task.status = "completed";
            task.completedAt = Date.now();

            this.metrics.completedTasks++;
            this.updateMetrics();

        } catch (error) {
            task.status = "failed";
            task.error = error.message;
            task.completedAt = Date.now();

            this.metrics.failedTasks++;
            this.updateMetrics();

            console.error(`❌ Task failed: ${task.name}`, error);
        }
    }

    private async executeThroughMCP(task: OrchestrationTask, repo: any): Promise<void> {
        // This would implement actual MCP protocol communication
        console.log(`🔌 Executing ${task.name} through MCP server at port ${repo.integration.mcpPort}`);

        // Simulate MCP execution
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

        task.result = {
            success: true,
            data: `Executed ${task.name} through ${repo.name}`,
            timestamp: Date.now()
        };
    }

    private async executeThroughAgent(task: OrchestrationTask, context: AgentContext): Promise<void> {
        // Execute through the agent coordinator
        const message: AgentMessage = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            from: "orchestrator",
            to: task.agent,
            type: "coordination_request",
            payload: {
                task: task.name,
                parameters: task.parameters,
                repository: task.repository
            },
            timestamp: Date.now(),
            priority: task.priority,
            context
        };

        // Send message through agent coordinator
        await this.agentCoordinator.sendMessage(message);

        // Wait for response (simplified)
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));

        task.result = {
            success: true,
            agent: task.agent,
            timestamp: Date.now()
        };
    }

    private async processPendingTasks(): Promise<void> {
        // Process tasks that are ready to run
        for (const task of this.tasks.values()) {
            if (task.status === "pending") {
                const workflow = Array.from(this.workflows.values()).find(w =>
                    w.tasks.some(t => t.id === task.id)
                );

                if (workflow && workflow.status === "running") {
                    await this.executeTask(task, workflow.context);
                }
            }
        }

        // Schedule next processing
        setTimeout(() => this.processPendingTasks(), 1000);
    }

    private performHealthCheck(): void {
        // Check repository health
        ecosystemIntegration.getRepositories().forEach(repo => {
            if (repo.status === "error") {
                console.warn(`⚠️ Repository ${repo.name} is in error state`);
            }
        });

        // Check agent health
        this.agentCoordinator.getAgents().forEach(agent => {
            if (agent.status === "error") {
                console.warn(`⚠️ Agent ${agent.name} is in error state`);
            }
        });

        this.metrics.lastActivity = Date.now();
        this.updateMetrics();
    }

    private updateMetrics(): void {
        const repos = ecosystemIntegration.getRepositories();
        this.metrics.totalRepositories = repos.length;
        this.metrics.activeRepositories = repos.filter(r => r.status === "active").length;
    }

    public getWorkflow(id: string): OrchestrationWorkflow | undefined {
        return this.workflows.get(id);
    }

    public getWorkflows(): OrchestrationWorkflow[] {
        return Array.from(this.workflows.values());
    }

    public getTask(id: string): OrchestrationTask | undefined {
        return this.tasks.get(id);
    }

    public getTasks(): OrchestrationTask[] {
        return Array.from(this.tasks.values());
    }

    public getMetrics(): EcosystemMetrics {
        return { ...this.metrics };
    }

    public async cancelWorkflow(workflowId: string): Promise<boolean> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            return false;
        }

        workflow.status = "failed";
        workflow.errors.push("Cancelled by user");

        // Cancel running tasks
        workflow.tasks.forEach(task => {
            if (task.status === "running") {
                task.status = "failed";
                task.error = "Cancelled";
            }
        });

        return true;
    }

    public async pauseWorkflow(workflowId: string): Promise<boolean> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow || workflow.status !== "running") {
            return false;
        }

        workflow.status = "idle";
        return true;
    }

    public async resumeWorkflow(workflowId: string): Promise<boolean> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow || workflow.status !== "idle") {
            return false;
        }

        workflow.status = "running";
        await this.executeWorkflow(workflowId);
        return true;
    }

    public getActiveWorkflows(): OrchestrationWorkflow[] {
        return Array.from(this.workflows.values()).filter(w => w.status === "running");
    }

    public getCompletedWorkflows(): OrchestrationWorkflow[] {
        return Array.from(this.workflows.values()).filter(w => w.status === "completed");
    }

    public getFailedWorkflows(): OrchestrationWorkflow[] {
        return Array.from(this.workflows.values()).filter(w => w.status === "failed");
    }
}

// Create singleton instance with agent coordinator
export const ecosystemOrchestrator = new EcosystemOrchestrator(agentCoordinator);