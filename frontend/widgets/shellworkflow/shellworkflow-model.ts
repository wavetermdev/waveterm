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


function deepCopy<T>(val: T): T {
    return JSON.parse(JSON.stringify(val)) as T;
}

export function isSensitive(name: string): boolean {
    return /password|secret|token|key|webhook/i.test(name);
}


export class ShellWorkflowViewModel implements ViewModel {
    viewType = "shellworkflow";
    blockId: string;

    viewIcon = jotai.atom<string>("diagram-project");
    viewName = jotai.atom<string>("Shell Workflows");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"workflows" | "steps" | "output" | "variables">("workflows");
    workflows = jotai.atom<WorkflowDef[]>([]);
    selectedWorkflowId = jotai.atom<string | null>(null);
    outputHistory = jotai.atom<OutputEntry[]>([]);
    variables = jotai.atom<WorkflowVariable[]>([]);

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

    /** Substitutes $VARIABLE_NAME tokens in command strings with values from the variables atom.
     *  Variable names must be uppercase with underscores (e.g. $DB_URL, $S3_BUCKET). */
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

        // Fixed durations per step type — realistic but deterministic
        const STEP_DURATIONS: Record<StepType, number> = {
            shell: 1400,
            python: 2200,
            http: 450,
            condition: 200,
        };

        let delay = 0;
        wf.steps.forEach((step, idx) => {
            const stepDuration = STEP_DURATIONS[step.type];

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
                    const resolvedCommand = this.substituteVariables(step.command);
                    const output = `$ ${resolvedCommand}\n[Step queued — connect a terminal block to execute shell commands]`;
                    const exitCode = 0;
                    const status: StepStatus = "success";
                    this.updateStep(workflowId, step.id, { status });
                    const entry: OutputEntry = {
                        id: `out-${Date.now()}-${idx}`,
                        stepName: step.name,
                        workflowName: wf.name,
                        timestamp: Date.now(),
                        duration: stepDuration,
                        exitCode,
                        stdout: output,
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
            const STEP_DURATIONS: Record<StepType, number> = { shell: 1400, python: 2200, http: 450, condition: 200 };
            const duration = STEP_DURATIONS[step.type];
            const t = setTimeout(() => {
                const entry: OutputEntry = {
                    id: `out-${Date.now()}`,
                    stepName: step.name,
                    workflowName: wf.name,
                    timestamp: Date.now(),
                    duration,
                    exitCode: 0,
                    stdout: `$ ${this.substituteVariables(step.command)}\n[Step queued — connect a terminal block to execute shell commands]`,
                    status: "success",
                    expanded: false,
                };
                this.updateStep(workflowId, stepId, { status: "success" });
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
