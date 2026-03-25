// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import type { AiSuggestion, CodeEditorViewModel, FileTreeNode, Language, RunRecord } from "./codeeditor-model";
import "./codeeditor.scss";

// ── helpers ──────────────────────────────────────────────────────────────────

const LANGUAGES: Language[] = ["python", "typescript", "javascript", "go", "rust", "sql", "shell", "json"];

function fmtDuration(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function fmtTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
}

// ── syntax highlight ─────────────────────────────────────────────────────────

function tokenizeLine(line: string): React.ReactElement {
    // Very lightweight highlight: keywords, strings, comments, numbers
    const parts: React.ReactElement[] = [];
    const PY_KEYWORDS = /\b(import|from|def|class|return|if|else|elif|for|in|while|with|as|True|False|None|and|or|not|print|raise|try|except|finally|pass|break|continue|lambda|yield|async|await)\b/g;
    const COMMENT = /(#.*)$/;
    const STRING = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|"""[\s\S]*?"""|'''[\s\S]*?'''|f"[^"]*"|f'[^']*')/g;
    const NUMBER = /\b(\d+(?:\.\d+)?)\b/g;

    // Comment takes whole line suffix
    const commentMatch = COMMENT.exec(line);
    const commentStart = commentMatch ? commentMatch.index : line.length;
    const codePart = line.slice(0, commentStart);
    const commentPart = commentMatch ? commentMatch[1] : "";

    // Tokenise the code portion
    let pos = 0;
    const allMatches: Array<{ start: number; end: number; type: string; text: string }> = [];

    const addMatches = (re: RegExp, type: string, src: string) => {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
            allMatches.push({ start: m.index, end: m.index + m[0].length, type, text: m[0] });
        }
    };

    addMatches(STRING, "string", codePart);
    addMatches(PY_KEYWORDS, "keyword", codePart);
    addMatches(NUMBER, "number", codePart);

    // Remove overlaps: keep first-by-start, then by length desc
    allMatches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const filtered: typeof allMatches = [];
    let cursor = 0;
    for (const m of allMatches) {
        if (m.start >= cursor) {
            filtered.push(m);
            cursor = m.end;
        }
    }

    pos = 0;
    filtered.forEach((m, i) => {
        if (pos < m.start) parts.push(<span key={`plain-${i}`}>{codePart.slice(pos, m.start)}</span>);
        parts.push(
            <span key={`tok-${i}`} className={`syntax-${m.type}`}>
                {m.text}
            </span>
        );
        pos = m.end;
    });
    if (pos < codePart.length) parts.push(<span key="tail">{codePart.slice(pos)}</span>);
    if (commentPart) parts.push(<span key="comment" className="syntax-comment">{commentPart}</span>);

    return <>{parts}</>;
}

// ── CodeArea ─────────────────────────────────────────────────────────────────

function CodeArea({ code, onChange }: { code: string; onChange: (v: string) => void }) {
    const lines = code.split("\n");
    return (
        <div className="code-editor-widget__code-area">
            <div className="code-editor-widget__line-numbers" aria-hidden>
                {lines.map((_, i) => (
                    <div key={i} className="code-editor-widget__line-num">
                        {i + 1}
                    </div>
                ))}
            </div>
            <div className="code-editor-widget__highlight-layer" aria-hidden>
                {lines.map((line, i) => (
                    <div key={i} className="code-editor-widget__hl-line">
                        {tokenizeLine(line)}
                        {"\n"}
                    </div>
                ))}
            </div>
            <textarea
                className="code-editor-widget__textarea"
                value={code}
                onChange={(e) => onChange(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
            />
        </div>
    );
}

// ── EditorTab ─────────────────────────────────────────────────────────────────

function EditorTab({ model }: { model: CodeEditorViewModel }) {
    const [code, setCode] = useAtom(model.code);
    const [lang, setLang] = useAtom(model.selectedLanguage);
    const [filename, setFilename] = useAtom(model.filename);
    const output = useAtomValue(model.output);
    const isRunning = useAtomValue(model.isRunning);

    return (
        <div className="code-editor-widget__tab-content">
            <div className="code-editor-widget__editor-toolbar">
                <select
                    className="code-editor-widget__select"
                    value={lang}
                    onChange={(e) => setLang(e.target.value as Language)}
                >
                    {LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                            {l.charAt(0).toUpperCase() + l.slice(1)}
                        </option>
                    ))}
                </select>
                <input
                    className="code-editor-widget__filename-input"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    placeholder="filename"
                    spellCheck={false}
                />
                <div className="code-editor-widget__toolbar-spacer" />
                <button
                    className="code-editor-widget__btn code-editor-widget__btn--run"
                    onClick={() => model.runCode()}
                    disabled={isRunning}
                >
                    {isRunning ? "⏳ Running…" : "▶ Run"}
                </button>
                <button className="code-editor-widget__btn code-editor-widget__btn--save">💾 Save</button>
            </div>

            <CodeArea code={code} onChange={setCode} />

            <div className="code-editor-widget__output-pane">
                <div className="code-editor-widget__output-header">
                    <span>Output</span>
                    {isRunning && <span className="code-editor-widget__spinner">●</span>}
                </div>
                <pre className="code-editor-widget__output-text">{output}</pre>
            </div>
        </div>
    );
}

// ── AiTab ─────────────────────────────────────────────────────────────────────

function AiTab({ model }: { model: CodeEditorViewModel }) {
    const suggestions = useAtomValue(model.aiSuggestions);
    const lang = useAtomValue(model.selectedLanguage);
    const [prompt, setPrompt] = React.useState("");
    const [pendingId, setPendingId] = React.useState<string | null>(null);
    const [, setCode] = useAtom(model.code);

    function insertSuggestion(sug: AiSuggestion) {
        setCode((prev) => prev + "\n\n" + sug.code);
        setPendingId(null);
    }

    return (
        <div className="code-editor-widget__tab-content">
            <div className="code-editor-widget__section">
                <div className="code-editor-widget__section-header">Generate Code</div>
                <div className="code-editor-widget__ai-prompt-row">
                    <input
                        className="code-editor-widget__ai-prompt-input"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Describe the code you want to generate…"
                        onKeyDown={(e) => e.key === "Enter" && setPrompt("")}
                    />
                    <button className="code-editor-widget__btn code-editor-widget__btn--primary" onClick={() => setPrompt("")}>
                        Generate
                    </button>
                </div>
            </div>

            <div className="code-editor-widget__section">
                <div className="code-editor-widget__section-header">Context Summary</div>
                <div className="code-editor-widget__context-summary">
                    <div className="code-editor-widget__context-row">
                        <span className="code-editor-widget__context-key">Language</span>
                        <span className="code-editor-widget__context-val">{lang}</span>
                    </div>
                    <div className="code-editor-widget__context-row">
                        <span className="code-editor-widget__context-key">Detected Imports</span>
                        <span className="code-editor-widget__context-val">numpy, sklearn, sklearn.metrics</span>
                    </div>
                    <div className="code-editor-widget__context-row">
                        <span className="code-editor-widget__context-key">Main Pattern</span>
                        <span className="code-editor-widget__context-val">ML training pipeline</span>
                    </div>
                    <div className="code-editor-widget__context-row">
                        <span className="code-editor-widget__context-key">Functions Defined</span>
                        <span className="code-editor-widget__context-val">—</span>
                    </div>
                </div>
            </div>

            <div className="code-editor-widget__section">
                <div className="code-editor-widget__section-header">AI Suggestions</div>
                <div className="code-editor-widget__suggestions-list">
                    {suggestions.map((sug) => (
                        <div key={sug.id} className="code-editor-widget__suggestion-card">
                            <div className="code-editor-widget__suggestion-header">
                                <span className="code-editor-widget__suggestion-desc">{sug.description}</span>
                                <div className="code-editor-widget__suggestion-actions">
                                    <button
                                        className="code-editor-widget__btn code-editor-widget__btn--sm"
                                        onClick={() => setPendingId(pendingId === sug.id ? null : sug.id)}
                                    >
                                        {pendingId === sug.id ? "Hide" : "Preview"}
                                    </button>
                                    <button
                                        className="code-editor-widget__btn code-editor-widget__btn--sm code-editor-widget__btn--primary"
                                        onClick={() => insertSuggestion(sug)}
                                    >
                                        Insert
                                    </button>
                                </div>
                            </div>
                            {pendingId === sug.id && (
                                <div className="code-editor-widget__diff-preview">
                                    <pre className="code-editor-widget__diff-code">{sug.code}</pre>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── FilesTab ──────────────────────────────────────────────────────────────────

const FILE_TREE_BASE_INDENT_PX = 8;
const FILE_TREE_INDENT_STEP_PX = 14;

function FileNode({ node, depth = 0 }: { node: FileTreeNode; depth?: number }) {
    const [open, setOpen] = React.useState(true);
    const isFolder = node.type === "folder";
    const indent = depth * FILE_TREE_INDENT_STEP_PX;

    return (
        <div className="code-editor-widget__file-node">
            <div
                className={`code-editor-widget__file-row ${node.active ? "active" : ""}`}
                style={{ paddingLeft: indent + FILE_TREE_BASE_INDENT_PX }}
                onClick={() => isFolder && setOpen((v) => !v)}
            >
                <span className="code-editor-widget__file-icon">
                    {isFolder ? (open ? "📂" : "📁") : getFileIcon(node.name)}
                </span>
                <span className="code-editor-widget__file-name">{node.name}</span>
            </div>
            {isFolder && open && node.children?.map((child) => (
                <FileNode key={child.name} node={child} depth={depth + 1} />
            ))}
        </div>
    );
}

function getFileIcon(name: string): string {
    if (name.endsWith(".py")) return "🐍";
    if (name.endsWith(".ts") || name.endsWith(".tsx")) return "🔷";
    if (name.endsWith(".js") || name.endsWith(".jsx")) return "📜";
    if (name.endsWith(".json")) return "{}";
    if (name.endsWith(".md")) return "📝";
    if (name.endsWith(".ipynb")) return "📓";
    if (name.endsWith(".txt")) return "📄";
    return "📄";
}

function FilesTab({ model }: { model: CodeEditorViewModel }) {
    const fileTree = useAtomValue(model.fileTree);
    const [search, setSearch] = React.useState("");

    return (
        <div className="code-editor-widget__tab-content">
            <div className="code-editor-widget__files-toolbar">
                <input
                    className="code-editor-widget__search-input"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search files…"
                />
                <button className="code-editor-widget__btn code-editor-widget__btn--sm" title="New file">
                    + File
                </button>
                <button className="code-editor-widget__btn code-editor-widget__btn--sm" title="New folder">
                    + Folder
                </button>
            </div>
            <div className="code-editor-widget__file-tree">
                {fileTree.map((node) => (
                    <FileNode key={node.name} node={node} depth={0} />
                ))}
            </div>
        </div>
    );
}

// ── MetricsTab ─────────────────────────────────────────────────────────────────

const LANG_BREAKDOWN: Array<{ lang: string; pct: number; color: string }> = [
    { lang: "Python", pct: 62, color: "#3b82f6" },
    { lang: "TypeScript", pct: 18, color: "#06b6d4" },
    { lang: "Shell", pct: 12, color: "#22c55e" },
    { lang: "JSON", pct: 8, color: "#f59e0b" },
];

function MetricsTab({ model }: { model: CodeEditorViewModel }) {
    const metrics = useAtomValue(model.executionMetrics);
    const history = useAtomValue(model.runHistory);

    return (
        <div className="code-editor-widget__tab-content">
            <div className="code-editor-widget__stat-row">
                <div className="code-editor-widget__stat-card">
                    <div className="code-editor-widget__stat-label">Last Duration</div>
                    <div className="code-editor-widget__stat-value">{fmtDuration(metrics.lastRunDurationMs)}</div>
                </div>
                <div className="code-editor-widget__stat-card">
                    <div className="code-editor-widget__stat-label">Memory Used</div>
                    <div className="code-editor-widget__stat-value">{metrics.lastRunMemoryMb} MB</div>
                </div>
                <div className="code-editor-widget__stat-card">
                    <div className="code-editor-widget__stat-label">CPU Peak</div>
                    <div className="code-editor-widget__stat-value">{metrics.lastRunCpuPeak}%</div>
                </div>
                <div className="code-editor-widget__stat-card">
                    <div className="code-editor-widget__stat-label">Total Runs</div>
                    <div className="code-editor-widget__stat-value">{metrics.totalRuns}</div>
                </div>
            </div>

            <div className="code-editor-widget__section">
                <div className="code-editor-widget__section-header">Language Breakdown</div>
                <div className="code-editor-widget__lang-chart">
                    {LANG_BREAKDOWN.map((l) => (
                        <div key={l.lang} className="code-editor-widget__lang-row">
                            <span className="code-editor-widget__lang-name">{l.lang}</span>
                            <div className="code-editor-widget__lang-bar-bg">
                                <div
                                    className="code-editor-widget__lang-bar-fill"
                                    style={{ width: `${l.pct}%`, background: l.color }}
                                />
                            </div>
                            <span className="code-editor-widget__lang-pct">{l.pct}%</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="code-editor-widget__section">
                <div className="code-editor-widget__section-header">Execution History</div>
                <div className="code-editor-widget__history-table">
                    <div className="code-editor-widget__history-header">
                        <span>Time</span>
                        <span>Language</span>
                        <span>Exit</span>
                        <span>Duration</span>
                        <span>Memory</span>
                    </div>
                    {history.map((r: RunRecord) => (
                        <div key={r.id} className="code-editor-widget__history-row">
                            <span>{fmtTime(r.timestamp)}</span>
                            <span className="code-editor-widget__lang-badge">{r.language}</span>
                            <span className={r.exitCode === 0 ? "code-editor-widget__exit-ok" : "code-editor-widget__exit-err"}>
                                {r.exitCode === 0 ? "✓ 0" : `✗ ${r.exitCode}`}
                            </span>
                            <span>{fmtDuration(r.durationMs)}</span>
                            <span>{r.memoryMb} MB</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── Root component ────────────────────────────────────────────────────────────

export const CodeEditor: React.FC<ViewComponentProps<CodeEditorViewModel>> = ({ model }) => {
    const [activeTab, setActiveTab] = useAtom(model.activeTab);

    type TabId = "editor" | "ai" | "files" | "metrics";
    const tabs: Array<{ id: TabId; label: string }> = [
        { id: "editor", label: "Editor" },
        { id: "ai", label: "AI Assist" },
        { id: "files", label: "Files" },
        { id: "metrics", label: "Metrics" },
    ];

    return (
        <div className="code-editor-widget">
            <div className="code-editor-widget__header-bar">
                <div className="code-editor-widget__title">
                    <span className="code-editor-widget__title-icon">⌨️</span>
                    <span>AI-Assisted Code Editor</span>
                    <span className="code-editor-widget__title-sub">GBM · sklearn · Python</span>
                </div>
            </div>
            <div className="code-editor-widget__tabs">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        className={`code-editor-widget__tab ${activeTab === tab.id ? "active" : ""}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="code-editor-widget__body">
                {activeTab === "editor" && <EditorTab model={model} />}
                {activeTab === "ai" && <AiTab model={model} />}
                {activeTab === "files" && <FilesTab model={model} />}
                {activeTab === "metrics" && <MetricsTab model={model} />}
            </div>
        </div>
    );
};
