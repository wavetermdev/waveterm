// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { ShellWorkflow } from "./shellworkflow";

const WORKFLOWS_STORAGE_KEY = "wave:shellworkflows";

export type StepType = "shell" | "python" | "http" | "condition";
export type StepStatus = "pending" | "running" | "success" | "error";
export type WorkflowStatus = "idle" | "running" | "success" | "error";

export type WorkflowStep = {
    id: string;
    name: string;
    type: StepType;
    command: string;
    status: StepStatus;
    expanded: boolean;
};

export type WorkflowDef = {
    id: string;
    name: string;
    description: string;
    steps: WorkflowStep[];
    lastRun: number | null;
    status: WorkflowStatus;
};

export type OutputEntry = {
    id: string;
    stepName: string;
    workflowName: string;
    timestamp: number;
    duration: number;
    exitCode: number;
    stdout: string;
    status: "success" | "error" | "running";
    expanded: boolean;
};

export type WorkflowVariable = {
    id: string;
    name: string;
    value: string;
    description: string;
    editing: boolean;
};

const INITIAL_WORKFLOWS: WorkflowDef[] = [
    {
        id: "wf-1",
        name: "Deploy API",
        description: "Pull latest code, build Docker image and deploy finstream-api service",
        status: "success",
        lastRun: Date.now() - 1000 * 60 * 14,
        steps: [
            {
                id: "s1-1",
                name: "Pull latest code",
                type: "shell",
                command: 'git pull origin main && echo "Code updated"',
                status: "success",
                expanded: false,
            },
            {
                id: "s1-2",
                name: "Build Docker image",
                type: "shell",
                command: 'docker build -t finstream-api:latest . && echo "Build OK"',
                status: "success",
                expanded: false,
            },
            {
                id: "s1-3",
                name: "Restart container",
                type: "shell",
                command: "docker stop finstream-api || true && docker run -d --name finstream-api -p 3001:3001 finstream-api:latest",
                status: "success",
                expanded: false,
            },
            {
                id: "s1-4",
                name: "Health check",
                type: "http",
                command: "GET http://localhost:3001/health",
                status: "success",
                expanded: false,
            },
        ],
    },
    {
        id: "wf-2",
        name: "ML Training Pipeline",
        description: "Prepare data, train gradient boost model and evaluate on holdout set",
        status: "success",
        lastRun: Date.now() - 1000 * 60 * 60 * 2,
        steps: [
            {
                id: "s2-1",
                name: "Prepare dataset",
                type: "shell",
                command: "cd /workspace && python data_prep.py --source db --output ./data/prepared.parquet",
                status: "success",
                expanded: false,
            },
            {
                id: "s2-2",
                name: "Train model",
                type: "python",
                command: 'model.fit(X_train, y_train); model.export_onnx("./models/gbm.onnx")',
                status: "success",
                expanded: false,
            },
            {
                id: "s2-3",
                name: "Evaluate model",
                type: "shell",
                command: 'python evaluate.py --model ./models/gbm.onnx && echo "Eval complete"',
                status: "success",
                expanded: false,
            },
        ],
    },
    {
        id: "wf-3",
        name: "DB Backup",
        description: "Dump PostgreSQL database and upload to S3 bucket",
        status: "idle",
        lastRun: Date.now() - 1000 * 60 * 60 * 24,
        steps: [
            {
                id: "s3-1",
                name: "Dump database",
                type: "shell",
                command: "pg_dump $DB_URL -f /backups/$(date +%Y%m%d).sql",
                status: "pending",
                expanded: false,
            },
            {
                id: "s3-2",
                name: "Upload to S3",
                type: "shell",
                command: "aws s3 cp /backups/*.sql s3://$S3_BUCKET/backups/",
                status: "pending",
                expanded: false,
            },
        ],
    },
    {
        id: "wf-4",
        name: "Health Check",
        description: "Verify all services are responding and alert on failures",
        status: "error",
        lastRun: Date.now() - 1000 * 60 * 5,
        steps: [
            {
                id: "s4-1",
                name: "Check API",
                type: "http",
                command: "GET http://localhost:3001/health",
                status: "success",
                expanded: false,
            },
            {
                id: "s4-2",
                name: "Check DB",
                type: "shell",
                command: 'pg_isready -h $DB_HOST && echo "DB OK"',
                status: "error",
                expanded: false,
            },
            {
                id: "s4-3",
                name: "Notify on failure",
                type: "condition",
                command: "if [ $PREV_EXIT != 0 ]; then curl -X POST $SLACK_WEBHOOK -d '{\"text\":\"Health check failed\"}'; fi",
                status: "pending",
                expanded: false,
            },
        ],
    },
];

const INITIAL_VARIABLES: WorkflowVariable[] = [
    {
        id: "v1",
        name: "DB_URL",
        value: "postgres://admin:s3cr3t@localhost:5432/finstream",
        description: "PostgreSQL connection string",
        editing: false,
    },
    {
        id: "v2",
        name: "S3_BUCKET",
        value: "finstream-backups-prod",
        description: "S3 bucket for database backups",
        editing: false,
    },
    {
        id: "v3",
        name: "DB_HOST",
        value: "localhost",
        description: "Database hostname",
        editing: false,
    },
    {
        id: "v4",
        name: "SLACK_WEBHOOK",
        value: "https://hooks.slack.com/services/T00000/B00000/secret",
        description: "Slack incoming webhook URL",
        editing: false,
    },
];

function deepCopy<T>(val: T): T {
    return JSON.parse(JSON.stringify(val)) as T;
}

export function isSensitive(name: string): boolean {
    return /password|secret|token|key|webhook/i.test(name);
}

function generateMockOutput(type: StepType, command: string): string {
    switch (type) {
        case "shell":
            if (command.includes("git pull")) return "Already up to date.\nCode updated";
            if (command.includes("docker build"))
                return "Step 1/12 : FROM node:18-alpine\n...\nSuccessfully built abc123def456\nBuild OK";
            if (command.includes("docker stop")) return "finstream-api\nfc3a2b1d9e8f";
            if (command.includes("pg_dump"))
                return 'pg_dump: dumping contents of table "orders"\npg_dump: dumping contents of table "trades"\nDone.';
            if (command.includes("aws s3"))
                return "upload: /backups/20260115.sql to s3://finstream-backups-prod/backups/20260115.sql";
            if (command.includes("evaluate.py")) return "Accuracy: 0.713\nF1-score: 0.701\nAUC-ROC: 0.841\nEval complete";
            if (command.includes("pg_isready")) return "/var/run/postgresql:5432 - no response\nError: database unreachable";
            return "Command executed successfully.";
        case "python":
            return "[INFO] Training fold 1/5...\n[INFO] Training fold 2/5...\n[INFO] Training fold 3/5...\n[INFO] Best iteration: 847\nModel exported to ./models/gbm.onnx";
        case "http":
            return 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"status":"healthy","uptime":3847,"version":"1.2.3"}';
        case "condition":
            return "Condition evaluated: false\nSkipping notification (all checks passed)";
        default:
            return "Done.";
    }
}

export class ShellWorkflowViewModel implements ViewModel {
    viewType = "shellworkflow";
    blockId: string;

    viewIcon = jotai.atom<string>("diagram-project");
    viewName = jotai.atom<string>("Shell Workflows");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"workflows" | "steps" | "output" | "variables">("workflows");
    workflows = jotai.atom<WorkflowDef[]>(deepCopy(INITIAL_WORKFLOWS));
    selectedWorkflowId = jotai.atom<string | null>("wf-1");
    outputHistory = jotai.atom<OutputEntry[]>([]);
    variables = jotai.atom<WorkflowVariable[]>(deepCopy(INITIAL_VARIABLES));

    viewText: jotai.Atom<HeaderElem[]>;

    private runTimers: ReturnType<typeof setTimeout>[] = [];

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;

        // Restore persisted workflows if available
        try {
            const saved = localStorage.getItem(WORKFLOWS_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as WorkflowDef[];
                if (Array.isArray(parsed) && parsed.length > 0) {
                    globalStore.set(this.workflows, parsed);
                }
            }
        } catch {
            // localStorage unavailable or invalid JSON — use defaults
        }

        this.viewText = jotai.atom((get) => {
            const wfId = get(this.selectedWorkflowId);
            const workflows = get(this.workflows);
            const wf = workflows.find((w) => w.id === wfId);
            const elems: HeaderElem[] = [];
            if (wf) {
                elems.push({
                    elemtype: "text",
                    text: `${wf.name} | ${wf.steps.length} steps`,
                    noGrow: true,
                });
            }
            elems.push({
                elemtype: "iconbutton",
                icon: "play",
                title: "Run All Steps",
                click: () => {
                    const currentWfId = globalStore.get(this.selectedWorkflowId);
                    if (currentWfId) this.runAllSteps(currentWfId);
                },
            });
            return elems;
        });
    }

    get viewComponent(): ViewComponent {
        return ShellWorkflow as ViewComponent;
    }

    private substituteVariables(command: string): string {
        const vars = globalStore.get(this.variables);
        return command.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, name) => {
            const v = vars.find((v) => v.name === name);
            return v ? v.value : match;
        });
    }

    private async executeHttpStep(step: WorkflowStep): Promise<{ success: boolean; output: string; durationMs: number }> {
        const start = Date.now();
        const command = this.substituteVariables(step.command);
        const parts = command.trim().split(/\s+/);
        const method = parts[0]?.toUpperCase() ?? "GET";
        const url = parts[1] ?? "";
        if (!url) {
            return { success: false, output: "Error: HTTP step command must be 'METHOD URL'", durationMs: 0 };
        }
        try {
            const res = await fetch(url, {
                method,
                headers: { Accept: "application/json, text/plain, */*" },
                signal: AbortSignal.timeout(10000),
            });
            const body = await res.text();
            const durationMs = Date.now() - start;
            const success = res.status >= 200 && res.status < 400;
            const output = `HTTP/${res.status} ${res.statusText}\nContent-Type: ${res.headers.get("content-type") ?? "unknown"}\n\n${body.slice(0, 2000)}`;
            return { success, output, durationMs };
        } catch (err) {
            return {
                success: false,
                output: `Error: ${(err as Error).message}`,
                durationMs: Date.now() - start,
            };
        }
    }

    runAllSteps(workflowId: string) {
        const workflows = globalStore.get(this.workflows);
        const wf = workflows.find((w) => w.id === workflowId);
        if (!wf) return;

        this.updateWorkflow(workflowId, (w) => ({
            ...w,
            status: "running",
            steps: w.steps.map((s) => ({ ...s, status: "pending" as StepStatus })),
        }));

        let delay = 0;
        wf.steps.forEach((step, idx) => {
            // HTTP steps use realistic durations; shell/python vary more
            const stepDuration = step.type === "http"
                ? 300 + Math.random() * 700
                : 1200 + Math.random() * 1800;

            const runningTimer = setTimeout(() => {
                this.updateStep(workflowId, step.id, { status: "running" });
            }, delay);
            this.runTimers.push(runningTimer);

            const capturedDelay = delay + stepDuration;
            if (step.type === "http") {
                const startMs = delay;
                const httpTimer = setTimeout(async () => {
                    const { success, output, durationMs } = await this.executeHttpStep(step);
                    const status: StepStatus = success ? "success" : "error";
                    this.updateStep(workflowId, step.id, { status });
                    const entry: OutputEntry = {
                        id: `out-${Date.now()}-${idx}`,
                        stepName: step.name,
                        workflowName: wf.name,
                        timestamp: Date.now(),
                        duration: durationMs,
                        exitCode: success ? 0 : 1,
                        stdout: output,
                        status,
                        expanded: false,
                    };
                    const prev = globalStore.get(this.outputHistory);
                    globalStore.set(this.outputHistory, [entry, ...prev]);
                    if (idx === wf.steps.length - 1) {
                        this.finalizeWorkflow(workflowId);
                    }
                }, startMs);
                this.runTimers.push(httpTimer);
            } else {
                const doneTimer = setTimeout(() => {
                    const success = Math.random() > 0.15;
                    const status: StepStatus = success ? "success" : "error";
                    this.updateStep(workflowId, step.id, { status });
                    const resolvedCommand = this.substituteVariables(step.command);
                    const entry: OutputEntry = {
                        id: `out-${Date.now()}-${idx}`,
                        stepName: step.name,
                        workflowName: wf.name,
                        timestamp: Date.now(),
                        duration: Math.round(stepDuration),
                        exitCode: success ? 0 : 1,
                        stdout: success
                            ? generateMockOutput(step.type, resolvedCommand)
                            : `Error: command exited with code 1\nstderr: execution failed`,
                        status,
                        expanded: false,
                    };
                    const prev = globalStore.get(this.outputHistory);
                    globalStore.set(this.outputHistory, [entry, ...prev]);
                    if (idx === wf.steps.length - 1) {
                        this.finalizeWorkflow(workflowId);
                    }
                }, capturedDelay);
                this.runTimers.push(doneTimer);
            }

            delay += stepDuration;
        });
    }

    private finalizeWorkflow(workflowId: string) {
        const updatedSteps = globalStore.get(this.workflows).find((w) => w.id === workflowId)?.steps ?? [];
        const hasError = updatedSteps.some((s) => s.status === "error");
        this.updateWorkflow(workflowId, (w) => ({
            ...w,
            status: hasError ? "error" : "success",
            lastRun: Date.now(),
        }));
        this.saveWorkflows();
    }

    runSingleStep(workflowId: string, stepId: string) {
        const workflows = globalStore.get(this.workflows);
        const wf = workflows.find((w) => w.id === workflowId);
        const step = wf?.steps.find((s) => s.id === stepId);
        if (!wf || !step) return;

        this.updateStep(workflowId, stepId, { status: "running" });

        if (step.type === "http") {
            const t = setTimeout(async () => {
                const { success, output, durationMs } = await this.executeHttpStep(step);
                const status: StepStatus = success ? "success" : "error";
                this.updateStep(workflowId, stepId, { status });
                const entry: OutputEntry = {
                    id: `out-${Date.now()}`,
                    stepName: step.name,
                    workflowName: wf.name,
                    timestamp: Date.now(),
                    duration: durationMs,
                    exitCode: success ? 0 : 1,
                    stdout: output,
                    status,
                    expanded: false,
                };
                const prev = globalStore.get(this.outputHistory);
                globalStore.set(this.outputHistory, [entry, ...prev]);
            }, 0);
            this.runTimers.push(t);
        } else {
            const duration = 1200 + Math.random() * 1800;
            const t = setTimeout(() => {
                const success = Math.random() > 0.1;
                const status: StepStatus = success ? "success" : "error";
                this.updateStep(workflowId, stepId, { status });
                const resolvedCommand = this.substituteVariables(step.command);
                const entry: OutputEntry = {
                    id: `out-${Date.now()}`,
                    stepName: step.name,
                    workflowName: wf.name,
                    timestamp: Date.now(),
                    duration: Math.round(duration),
                    exitCode: success ? 0 : 1,
                    stdout: success
                        ? generateMockOutput(step.type, resolvedCommand)
                        : `Error: command exited with code 1\nstderr: execution failed`,
                    status,
                    expanded: false,
                };
                const prev = globalStore.get(this.outputHistory);
                globalStore.set(this.outputHistory, [entry, ...prev]);
            }, duration);
            this.runTimers.push(t);
        }
    }

    persistWorkflows() {
        this.saveWorkflows();
    }

    private saveWorkflows() {
        try {
            const workflows = globalStore.get(this.workflows);
            localStorage.setItem(WORKFLOWS_STORAGE_KEY, JSON.stringify(workflows));
        } catch {
            // localStorage may be unavailable
        }
    }

    toggleStepExpanded(workflowId: string, stepId: string) {
        this.updateStep(workflowId, stepId, {});
        this.updateWorkflow(workflowId, (w) => ({
            ...w,
            steps: w.steps.map((s) => (s.id === stepId ? { ...s, expanded: !s.expanded } : s)),
        }));
    }

    toggleOutputExpanded(entryId: string) {
        const prev = globalStore.get(this.outputHistory);
        globalStore.set(
            this.outputHistory,
            prev.map((e) => (e.id === entryId ? { ...e, expanded: !e.expanded } : e))
        );
    }

    clearOutputHistory() {
        globalStore.set(this.outputHistory, []);
    }

    private updateWorkflow(workflowId: string, fn: (w: WorkflowDef) => WorkflowDef) {
        const workflows = globalStore.get(this.workflows);
        globalStore.set(
            this.workflows,
            workflows.map((w) => (w.id === workflowId ? fn(w) : w))
        );
    }

    private updateStep(workflowId: string, stepId: string, patch: Partial<WorkflowStep>) {
        this.updateWorkflow(workflowId, (w) => ({
            ...w,
            steps: w.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
        }));
    }

    dispose() {
        this.runTimers.forEach(clearTimeout);
        this.runTimers = [];
    }

    giveFocus(): boolean {
        return true;
    }
}
