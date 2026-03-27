// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import type { OutputEntry, StepType, WorkflowDef, WorkflowStep, WorkflowVariable } from "./shellworkflow-model";
import { isSensitive } from "./shellworkflow-model";
import type { ShellWorkflowViewModel } from "./shellworkflow-model";
import "./shellworkflow.scss";

function formatRelativeTime(ts: number): string {
    const diffMs = Date.now() - ts;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr}h ago`;
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function StepTypeBadge({ type }: { type: StepType }) {
    return <span className={`shellworkflow-widget__type-badge shellworkflow-widget__type-badge--${type}`}>{type}</span>;
}

function StatusDot({ status }: { status: string }) {
    return <span className={`shellworkflow-widget__status-dot shellworkflow-widget__status-dot--${status}`} />;
}

function WorkflowStatusBadge({ status }: { status: string }) {
    const labels: Record<string, string> = {
        idle: "Idle",
        running: "Running",
        success: "Success",
        error: "Failed",
    };
    return (
        <span className={`shellworkflow-widget__wf-badge shellworkflow-widget__wf-badge--${status}`}>
            {labels[status] ?? status}
        </span>
    );
}

function WorkflowsTab({ model }: { model: ShellWorkflowViewModel }) {
    const workflows = useAtomValue(model.workflows);
    const [selectedId, setSelectedId] = useAtom(model.selectedWorkflowId);
    const [, setActiveTab] = useAtom(model.activeTab);

    function handleSelect(wf: WorkflowDef) {
        setSelectedId(wf.id);
        setActiveTab("steps");
    }

    return (
        <div className="shellworkflow-widget__tab-content">
            <div className="shellworkflow-widget__section">
                <div className="shellworkflow-widget__section-header">
                    <span>Workflows ({workflows.length})</span>
                    <button className="shellworkflow-widget__action-btn">+ New Workflow</button>
                </div>
                <div className="shellworkflow-widget__workflow-list">
                    {workflows.map((wf) => (
                        <div
                            key={wf.id}
                            className={`shellworkflow-widget__workflow-card ${selectedId === wf.id ? "shellworkflow-widget__workflow-card--selected" : ""}`}
                            onClick={() => handleSelect(wf)}
                        >
                            <div className="shellworkflow-widget__workflow-card-header">
                                <StatusDot status={wf.status} />
                                <span className="shellworkflow-widget__workflow-name">{wf.name}</span>
                                <WorkflowStatusBadge status={wf.status} />
                                <button
                                    className="shellworkflow-widget__delete-btn"
                                    title="Delete workflow"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    ×
                                </button>
                            </div>
                            <div className="shellworkflow-widget__workflow-desc">{wf.description}</div>
                            <div className="shellworkflow-widget__workflow-meta">
                                <span>{wf.steps.length} steps</span>
                                {wf.lastRun != null && <span>Last run: {formatRelativeTime(wf.lastRun)}</span>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function StepCard({
    step,
    workflowId,
    model,
}: {
    step: WorkflowStep;
    workflowId: string;
    model: ShellWorkflowViewModel;
}) {
    return (
        <div className={`shellworkflow-widget__step shellworkflow-widget__step--${step.status}`}>
            <div
                className="shellworkflow-widget__step-header"
                onClick={() => model.toggleStepExpanded(workflowId, step.id)}
            >
                <StatusDot status={step.status} />
                <span className="shellworkflow-widget__step-name">{step.name}</span>
                <StepTypeBadge type={step.type} />
                <button
                    className="shellworkflow-widget__run-btn"
                    title="Run this step"
                    onClick={(e) => {
                        e.stopPropagation();
                        model.runSingleStep(workflowId, step.id);
                    }}
                >
                    ▶
                </button>
                <span className="shellworkflow-widget__step-chevron">{step.expanded ? "▾" : "▸"}</span>
            </div>
            {step.expanded && (
                <div className="shellworkflow-widget__step-body">
                    <pre className="shellworkflow-widget__code-block">{step.command}</pre>
                </div>
            )}
        </div>
    );
}

function StepsTab({ model }: { model: ShellWorkflowViewModel }) {
    const workflows = useAtomValue(model.workflows);
    const selectedId = useAtomValue(model.selectedWorkflowId);
    const wf = workflows.find((w) => w.id === selectedId);

    if (!wf) {
        return (
            <div className="shellworkflow-widget__tab-content shellworkflow-widget__tab-content--empty">
                <span>Select a workflow from the Workflows tab</span>
            </div>
        );
    }

    return (
        <div className="shellworkflow-widget__tab-content">
            <div className="shellworkflow-widget__section">
                <div className="shellworkflow-widget__section-header">
                    <span>
                        {wf.name} — {wf.steps.length} Steps
                    </span>
                    <div className="shellworkflow-widget__header-actions">
                        <button
                            className="shellworkflow-widget__action-btn shellworkflow-widget__action-btn--primary"
                            onClick={() => model.runAllSteps(wf.id)}
                        >
                            ▶ Run All
                        </button>
                        <button className="shellworkflow-widget__action-btn">+ Add Step</button>
                    </div>
                </div>
                <div className="shellworkflow-widget__steps-list">
                    {wf.steps.map((step, idx) => (
                        <div key={step.id} className="shellworkflow-widget__step-wrapper">
                            <div className="shellworkflow-widget__step-index">{idx + 1}</div>
                            <StepCard step={step} workflowId={wf.id} model={model} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function OutputEntryRow({ entry, model }: { entry: OutputEntry; model: ShellWorkflowViewModel }) {
    return (
        <div className={`shellworkflow-widget__output-entry shellworkflow-widget__output-entry--${entry.status}`}>
            <div
                className="shellworkflow-widget__output-header"
                onClick={() => model.toggleOutputExpanded(entry.id)}
            >
                <StatusDot status={entry.status} />
                <span className="shellworkflow-widget__output-step">{entry.stepName}</span>
                <span className="shellworkflow-widget__output-wf">{entry.workflowName}</span>
                <span className="shellworkflow-widget__output-time">{formatRelativeTime(entry.timestamp)}</span>
                <span className="shellworkflow-widget__output-dur">{formatDuration(entry.duration)}</span>
                <span
                    className={`shellworkflow-widget__output-exit ${entry.exitCode === 0 ? "shellworkflow-widget__output-exit--ok" : "shellworkflow-widget__output-exit--err"}`}
                >
                    exit {entry.exitCode}
                </span>
                <span className="shellworkflow-widget__step-chevron">{entry.expanded ? "▾" : "▸"}</span>
            </div>
            {entry.expanded && (
                <pre className="shellworkflow-widget__output-stdout">{entry.stdout}</pre>
            )}
        </div>
    );
}

function OutputTab({ model }: { model: ShellWorkflowViewModel }) {
    const history = useAtomValue(model.outputHistory);

    return (
        <div className="shellworkflow-widget__tab-content">
            <div className="shellworkflow-widget__section">
                <div className="shellworkflow-widget__section-header">
                    <span>Execution History ({history.length})</span>
                    <button
                        className="shellworkflow-widget__action-btn"
                        onClick={() => model.clearOutputHistory()}
                    >
                        Clear
                    </button>
                </div>
                {history.length === 0 ? (
                    <div className="shellworkflow-widget__empty-state">No executions yet — run a workflow to see output</div>
                ) : (
                    <div className="shellworkflow-widget__output-list">
                        {history.map((entry) => (
                            <OutputEntryRow key={entry.id} entry={entry} model={model} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function VariableRow({
    variable,
    onDelete,
}: {
    variable: WorkflowVariable;
    onDelete: (id: string) => void;
}) {
    const masked = isSensitive(variable.name);
    const displayValue = masked ? "••••••••••••" : variable.value;

    return (
        <div className="shellworkflow-widget__var-row">
            <span className="shellworkflow-widget__var-name">${variable.name}</span>
            <span className="shellworkflow-widget__var-value" title={masked ? "(masked)" : variable.value}>
                {displayValue}
                {masked && <span className="shellworkflow-widget__var-masked-icon"> 🔒</span>}
            </span>
            <span className="shellworkflow-widget__var-desc">{variable.description}</span>
            <div className="shellworkflow-widget__var-actions">
                <button className="shellworkflow-widget__icon-btn" title="Edit">✎</button>
                <button
                    className="shellworkflow-widget__icon-btn shellworkflow-widget__icon-btn--danger"
                    title="Delete"
                    onClick={() => onDelete(variable.id)}
                >
                    ×
                </button>
            </div>
        </div>
    );
}

function VariablesTab({ model }: { model: ShellWorkflowViewModel }) {
    const [variables, setVariables] = useAtom(model.variables);

    function handleDelete(id: string) {
        setVariables(variables.filter((v) => v.id !== id));
    }

    return (
        <div className="shellworkflow-widget__tab-content">
            <div className="shellworkflow-widget__section">
                <div className="shellworkflow-widget__section-header">
                    <span>Workflow Variables ({variables.length})</span>
                    <button className="shellworkflow-widget__action-btn">+ Add Variable</button>
                </div>
                <div className="shellworkflow-widget__var-table-header">
                    <span>Name</span>
                    <span>Value</span>
                    <span>Description</span>
                    <span></span>
                </div>
                <div className="shellworkflow-widget__var-list">
                    {variables.map((v) => (
                        <VariableRow key={v.id} variable={v} onDelete={handleDelete} />
                    ))}
                </div>
                <div className="shellworkflow-widget__var-hint">
                    Use <code>$VAR_NAME</code> in step commands to substitute these values at runtime.
                </div>
            </div>
        </div>
    );
}

export const ShellWorkflow: React.FC<ViewComponentProps<ShellWorkflowViewModel>> = ({ model }) => {
    const [activeTab, setActiveTab] = useAtom(model.activeTab);

    type TabId = "workflows" | "steps" | "output" | "variables";
    const tabs: Array<{ id: TabId; label: string }> = [
        { id: "workflows", label: "Workflows" },
        { id: "steps", label: "Steps" },
        { id: "output", label: "Output" },
        { id: "variables", label: "Variables" },
    ];

    return (
        <div className="shellworkflow-widget">
            <div className="shellworkflow-widget__header-bar">
                <div className="shellworkflow-widget__title">
                    <span className="shellworkflow-widget__title-icon">⬡</span>
                    <span>Shell Workflows</span>
                    <span className="shellworkflow-widget__title-sub">Programmable automation</span>
                </div>
            </div>
            <div className="shellworkflow-widget__tabs">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        className={`shellworkflow-widget__tab ${activeTab === tab.id ? "shellworkflow-widget__tab--active" : ""}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="shellworkflow-widget__body">
                {activeTab === "workflows" && <WorkflowsTab model={model} />}
                {activeTab === "steps" && <StepsTab model={model} />}
                {activeTab === "output" && <OutputTab model={model} />}
                {activeTab === "variables" && <VariablesTab model={model} />}
            </div>
        </div>
    );
};
