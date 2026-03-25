// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import type { ChatMessage, StorageEntry, WidgetBuilderViewModel } from "./widgetbuilder-model";
import "./widgetbuilder.scss";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function truncate(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max) + "…";
}

function copyToClipboard(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
}

// ─── AI Chat Tab ─────────────────────────────────────────────────────────────

function CodeBlock({ code }: { code: string }) {
    const [copied, setCopied] = React.useState(false);
    const handleCopy = () => {
        copyToClipboard(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <div className="widgetbuilder-widget__code-block">
            <div className="widgetbuilder-widget__code-block-header">
                <span>TypeScript</span>
                <button className="widgetbuilder-widget__copy-btn" onClick={handleCopy}>
                    {copied ? "✓ Copied" : "Copy code"}
                </button>
            </div>
            <pre className="widgetbuilder-widget__code-pre">{code}</pre>
        </div>
    );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
    const isUser = msg.role === "user";
    return (
        <div className={`widgetbuilder-widget__bubble-wrap ${isUser ? "user" : "assistant"}`}>
            <div className={`widgetbuilder-widget__bubble ${isUser ? "user" : "assistant"}`}>
                <div className="widgetbuilder-widget__bubble-content">{msg.content}</div>
                {msg.codeBlock && <CodeBlock code={msg.codeBlock} />}
                <div className="widgetbuilder-widget__bubble-time">{fmtTime(msg.timestamp)}</div>
            </div>
        </div>
    );
}

function AiChatTab({ model }: { model: WidgetBuilderViewModel }) {
    const messages = useAtomValue(model.chatMessages);
    const [selectedModel, setSelectedModel] = useAtom(model.selectedAiModel);
    const isStreaming = useAtomValue(model.isStreaming);
    const [input, setInput] = React.useState("");
    const scrollRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = () => {
        if (!input.trim() || isStreaming) return;
        const msg = input;
        setInput("");
        model.sendChatMessage(msg);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="widgetbuilder-widget__tab-content widgetbuilder-widget__tab-content--chat">
            <div className="widgetbuilder-widget__chat-toolbar">
                <select
                    className="widgetbuilder-widget__model-select"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                >
                    <option value="GPT-4o">GPT-4o</option>
                    <option value="Claude Sonnet">Claude Sonnet</option>
                    <option value="Llama-3">Llama-3</option>
                </select>
                <button
                    className="widgetbuilder-widget__btn widgetbuilder-widget__btn--ghost"
                    onClick={() => model.clearChat()}
                >
                    Clear Chat
                </button>
            </div>

            <div className="widgetbuilder-widget__chat-history" ref={scrollRef}>
                {messages.length === 0 && (
                    <div className="widgetbuilder-widget__chat-empty">Start a conversation to build a widget.</div>
                )}
                {messages.map((msg) => (
                    <ChatBubble key={msg.id} msg={msg} />
                ))}
                {isStreaming && (
                    <div className="widgetbuilder-widget__bubble-wrap assistant">
                        <div className="widgetbuilder-widget__streaming-indicator">
                            <span />
                            <span />
                            <span />
                        </div>
                    </div>
                )}
            </div>

            <div className="widgetbuilder-widget__chat-input-row">
                <textarea
                    className="widgetbuilder-widget__chat-textarea"
                    placeholder="Ask the AI to build or modify a widget…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={2}
                    disabled={isStreaming}
                />
                <button
                    className="widgetbuilder-widget__btn widgetbuilder-widget__btn--primary"
                    onClick={handleSend}
                    disabled={isStreaming || !input.trim()}
                >
                    Send
                </button>
            </div>
        </div>
    );
}

// ─── Storage Tab ─────────────────────────────────────────────────────────────

function StorageTab({ model }: { model: WidgetBuilderViewModel }) {
    const [entries, setEntries] = useAtom(model.storageEntries);
    const [namespace, setNamespace] = useAtom(model.selectedNamespace);
    const [newKey, setNewKey] = React.useState("");
    const [newValue, setNewValue] = React.useState("");
    const [ttl, setTtl] = React.useState("none");
    const [getKey, setGetKey] = React.useState("");
    const [getResult, setGetResult] = React.useState<string | null>(null);

    const totalBytes = entries.reduce((s, e) => s + e.size, 0);
    const maxQuota = 1024 * 50; // 50 KB mock quota

    const handleSave = () => {
        if (!newKey.trim()) return;
        const existing = entries.find((e) => e.key === newKey);
        if (existing) {
            setEntries(entries.map((e) => e.key === newKey ? { ...e, value: newValue, updatedAt: Date.now(), size: newValue.length } : e));
        } else {
            const entry: StorageEntry = {
                key: newKey,
                value: newValue,
                size: newValue.length,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            setEntries([...entries, entry]);
        }
        setNewKey("");
        setNewValue("");
    };

    const handleGet = () => {
        const entry = entries.find((e) => e.key === getKey);
        setGetResult(entry ? entry.value : "Key not found");
    };

    const handleDelete = (key: string) => {
        setEntries(entries.filter((e) => e.key !== key));
    };

    const handleExport = () => {
        const obj: Record<string, string> = {};
        entries.forEach((e) => { obj[e.key] = e.value; });
        copyToClipboard(JSON.stringify(obj, null, 2));
    };

    const usedPct = Math.min(100, Math.round((totalBytes / maxQuota) * 100));

    return (
        <div className="widgetbuilder-widget__tab-content">
            <div className="widgetbuilder-widget__storage-toolbar">
                <select
                    className="widgetbuilder-widget__model-select"
                    value={namespace}
                    onChange={(e) => setNamespace(e.target.value)}
                >
                    <option value="widget">Widget namespace</option>
                    <option value="global">Global namespace</option>
                </select>
                <button className="widgetbuilder-widget__btn widgetbuilder-widget__btn--ghost" onClick={handleExport}>
                    Export JSON
                </button>
            </div>

            <div className="widgetbuilder-widget__quota-row">
                <span className="widgetbuilder-widget__quota-label">Storage: {totalBytes}B / {maxQuota}B</span>
                <div className="widgetbuilder-widget__quota-bar">
                    <div className="widgetbuilder-widget__quota-fill" style={{ width: `${usedPct}%` }} />
                </div>
                <span className="widgetbuilder-widget__quota-pct">{usedPct}%</span>
            </div>

            <div className="widgetbuilder-widget__storage-table-wrap">
                <div className="widgetbuilder-widget__table-header">
                    <span>Key</span>
                    <span>Value</span>
                    <span>Size</span>
                    <span>Updated</span>
                    <span></span>
                </div>
                {entries.map((entry, idx) => (
                    <div key={entry.key} className={`widgetbuilder-widget__table-row ${idx % 2 === 0 ? "even" : "odd"}`}>
                        <span className="widgetbuilder-widget__storage-key">{entry.key}</span>
                        <span className="widgetbuilder-widget__storage-value">{truncate(entry.value, 40)}</span>
                        <span className="widgetbuilder-widget__storage-size">{entry.size}B</span>
                        <span className="widgetbuilder-widget__storage-ts">{fmtDate(entry.updatedAt)}</span>
                        <button
                            className="widgetbuilder-widget__delete-btn"
                            onClick={() => handleDelete(entry.key)}
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>

            <div className="widgetbuilder-widget__storage-forms">
                <div className="widgetbuilder-widget__form-section">
                    <div className="widgetbuilder-widget__form-title">Set Key</div>
                    <div className="widgetbuilder-widget__form-row">
                        <input
                            className="widgetbuilder-widget__input"
                            placeholder="Key name"
                            value={newKey}
                            onChange={(e) => setNewKey(e.target.value)}
                        />
                        <select className="widgetbuilder-widget__model-select" value={ttl} onChange={(e) => setTtl(e.target.value)}>
                            <option value="none">No expiry</option>
                            <option value="1h">1 hour</option>
                            <option value="24h">24 hours</option>
                            <option value="7d">7 days</option>
                        </select>
                    </div>
                    <textarea
                        className="widgetbuilder-widget__storage-textarea"
                        placeholder='Value (JSON)'
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        rows={2}
                    />
                    <button className="widgetbuilder-widget__btn widgetbuilder-widget__btn--primary" onClick={handleSave}>
                        Save
                    </button>
                </div>

                <div className="widgetbuilder-widget__form-section">
                    <div className="widgetbuilder-widget__form-title">Get Key</div>
                    <div className="widgetbuilder-widget__form-row">
                        <input
                            className="widgetbuilder-widget__input"
                            placeholder="Key name"
                            value={getKey}
                            onChange={(e) => setGetKey(e.target.value)}
                        />
                        <button className="widgetbuilder-widget__btn widgetbuilder-widget__btn--primary" onClick={handleGet}>
                            Get
                        </button>
                    </div>
                    {getResult != null && (
                        <div className="widgetbuilder-widget__get-result">{getResult}</div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── DB Query Tab ────────────────────────────────────────────────────────────

function DbQueryTab({ model }: { model: WidgetBuilderViewModel }) {
    const [connection, setConnection] = useAtom(model.selectedDbConnection);
    const [sql, setSql] = useAtom(model.sqlQuery);
    const queryResults = useAtomValue(model.queryResults);
    const queryHistory = useAtomValue(model.queryHistory);
    const isRunning = useAtomValue(model.isRunningQuery);

    return (
        <div className="widgetbuilder-widget__tab-content">
            <div className="widgetbuilder-widget__db-toolbar">
                <select
                    className="widgetbuilder-widget__model-select"
                    value={connection}
                    onChange={(e) => setConnection(e.target.value)}
                >
                    <option value="wave-postgres (local)">wave-postgres (local)</option>
                    <option value="finstream-db (docker)">finstream-db (docker)</option>
                    <option value="analytics-db">analytics-db</option>
                </select>
                <button
                    className="widgetbuilder-widget__btn widgetbuilder-widget__btn--primary"
                    onClick={() => model.runQuery()}
                    disabled={isRunning}
                >
                    {isRunning ? "Running…" : "▶ Run Query"}
                </button>
                <button className="widgetbuilder-widget__btn widgetbuilder-widget__btn--ghost" disabled={isRunning}>
                    Explain
                </button>
            </div>

            <div className="widgetbuilder-widget__sql-editor-wrap">
                <textarea
                    className="widgetbuilder-widget__sql-editor"
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    spellCheck={false}
                    rows={6}
                />
            </div>

            {queryResults && (
                <div className="widgetbuilder-widget__query-results">
                    <div className="widgetbuilder-widget__results-meta">
                        <span>{queryResults.rows.length} rows</span>
                        <span>{queryResults.executionMs}ms</span>
                        <button
                            className="widgetbuilder-widget__btn widgetbuilder-widget__btn--ghost"
                            style={{ marginLeft: "auto", fontSize: 10 }}
                            onClick={() => {
                                const lines = [queryResults.columns.join(","), ...queryResults.rows.map((r) => r.join(","))];
                                copyToClipboard(lines.join("\n"));
                            }}
                        >
                            Export CSV
                        </button>
                    </div>
                    <div className="widgetbuilder-widget__results-table-wrap">
                        <div className="widgetbuilder-widget__results-table-header">
                            {queryResults.columns.map((col) => (
                                <span key={col}>{col}</span>
                            ))}
                        </div>
                        {queryResults.rows.map((row, i) => (
                            <div key={i} className={`widgetbuilder-widget__results-row ${i % 2 === 0 ? "even" : "odd"}`}>
                                {row.map((cell, j) => (
                                    <span key={j}>{cell}</span>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="widgetbuilder-widget__query-history">
                <div className="widgetbuilder-widget__section-title">Query History</div>
                {queryHistory.map((q, i) => (
                    <button
                        key={i}
                        className="widgetbuilder-widget__history-item"
                        onClick={() => setSql(q)}
                    >
                        {truncate(q.replace(/\s+/g, " "), 80)}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ─── HTTP Tab ────────────────────────────────────────────────────────────────

function StatusBadge({ code }: { code: number }) {
    const cls = code >= 500 ? "red" : code >= 400 ? "orange" : "green";
    return <span className={`widgetbuilder-widget__status-badge widgetbuilder-widget__status-badge--${cls}`}>{code}</span>;
}

function HttpTab({ model }: { model: WidgetBuilderViewModel }) {
    const [method, setMethod] = useAtom(model.httpMethod);
    const [url, setUrl] = useAtom(model.httpUrl);
    const httpResponse = useAtomValue(model.httpResponse);
    const requestHistory = useAtomValue(model.requestHistory);
    const isSending = useAtomValue(model.isSendingRequest);
    const [reqTab, setReqTab] = React.useState<"params" | "headers" | "body">("params");

    const handleCurl = () => {
        copyToClipboard(`curl -X ${method} "${url}"`);
    };

    return (
        <div className="widgetbuilder-widget__tab-content">
            <div className="widgetbuilder-widget__http-url-row">
                <select
                    className="widgetbuilder-widget__method-select"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                >
                    {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => (
                        <option key={m} value={m}>{m}</option>
                    ))}
                </select>
                <input
                    className="widgetbuilder-widget__url-input"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://…"
                />
                <button
                    className="widgetbuilder-widget__btn widgetbuilder-widget__btn--primary"
                    onClick={() => model.sendHttpRequest()}
                    disabled={isSending}
                >
                    {isSending ? "Sending…" : "Send"}
                </button>
            </div>

            <div className="widgetbuilder-widget__http-sub-tabs">
                {(["params", "headers", "body"] as const).map((t) => (
                    <button
                        key={t}
                        className={`widgetbuilder-widget__sub-tab ${reqTab === t ? "active" : ""}`}
                        onClick={() => setReqTab(t)}
                    >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                ))}
                <button className="widgetbuilder-widget__btn widgetbuilder-widget__btn--ghost" style={{ marginLeft: "auto" }} onClick={handleCurl}>
                    Copy cURL
                </button>
                <button className="widgetbuilder-widget__btn widgetbuilder-widget__btn--ghost">
                    Save as Collection
                </button>
            </div>

            <div className="widgetbuilder-widget__http-req-body">
                {reqTab === "params" && (
                    <div className="widgetbuilder-widget__http-placeholder">No query parameters</div>
                )}
                {reqTab === "headers" && (
                    <div className="widgetbuilder-widget__http-placeholder">
                        <div className="widgetbuilder-widget__header-row"><span>Content-Type</span><span>application/json</span></div>
                        <div className="widgetbuilder-widget__header-row"><span>Accept</span><span>*/*</span></div>
                    </div>
                )}
                {reqTab === "body" && (
                    <textarea className="widgetbuilder-widget__sql-editor" rows={3} placeholder='{"key": "value"}' />
                )}
            </div>

            {httpResponse && (
                <div className="widgetbuilder-widget__http-response">
                    <div className="widgetbuilder-widget__response-meta">
                        <StatusBadge code={httpResponse.status} />
                        <span className="widgetbuilder-widget__response-time">{httpResponse.ms}ms</span>
                        <span className="widgetbuilder-widget__response-label">Response</span>
                    </div>
                    <pre className="widgetbuilder-widget__response-body">{httpResponse.body}</pre>
                    <div className="widgetbuilder-widget__response-headers">
                        {Object.entries(httpResponse.headers).map(([k, v]) => (
                            <div key={k} className="widgetbuilder-widget__header-row">
                                <span>{k}</span>
                                <span>{v}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="widgetbuilder-widget__request-history">
                <div className="widgetbuilder-widget__section-title">Request History</div>
                {requestHistory.map((req) => (
                    <div
                        key={req.id}
                        className="widgetbuilder-widget__req-history-item"
                        onClick={() => {
                            setMethod(req.method);
                            setUrl(req.url);
                        }}
                    >
                        <span className={`widgetbuilder-widget__method-tag widgetbuilder-widget__method-tag--${req.method.toLowerCase()}`}>
                            {req.method}
                        </span>
                        <span className="widgetbuilder-widget__req-url">{truncate(req.url, 50)}</span>
                        <StatusBadge code={req.status} />
                        <span className="widgetbuilder-widget__req-ms">{req.ms}ms</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Builder Tab ─────────────────────────────────────────────────────────────

const PALETTE_COMPONENTS = [
    { id: "button", label: "Button", icon: "⬛" },
    { id: "text", label: "Text", icon: "T" },
    { id: "input", label: "Input", icon: "▭" },
    { id: "chart", label: "Chart", icon: "📈" },
    { id: "table", label: "Table", icon: "⊞" },
    { id: "divider", label: "Divider", icon: "─" },
];

const MOCK_TEMPLATES = [
    { id: "price", name: "Price Ticker", desc: "Live asset price with sparkline" },
    { id: "table", name: "Data Table", desc: "Sortable key-value table widget" },
    { id: "form", name: "Input Form", desc: "User input form with validation" },
];

const MOCK_CANVAS_LAYOUT = [
    { id: "c1", type: "text", label: "Widget Title", x: 10, y: 10, w: 200, h: 28 },
    { id: "c2", type: "chart", label: "Chart", x: 10, y: 48, w: 280, h: 90 },
    { id: "c3", type: "table", label: "Data Table", x: 10, y: 148, w: 280, h: 80 },
    { id: "c4", type: "button", label: "Refresh", x: 10, y: 238, w: 80, h: 28 },
];

function BuilderTab() {
    const [selected, setSelected] = React.useState<string | null>("c2");
    const [widgetName, setWidgetName] = React.useState("MyWidget");
    const [widgetDesc, setWidgetDesc] = React.useState("A custom Wave Terminal widget");
    const [exported, setExported] = React.useState(false);

    const selectedComp = MOCK_CANVAS_LAYOUT.find((c) => c.id === selected);

    const handleExport = () => {
        const code = `// ${widgetName}.tsx\nexport const ${widgetName}: React.FC = () => (\n  <div className="${widgetName.toLowerCase()}-widget">\n    {/* Generated by Widget Builder */}\n  </div>\n);`;
        copyToClipboard(code);
        setExported(true);
        setTimeout(() => setExported(false), 1500);
    };

    return (
        <div className="widgetbuilder-widget__tab-content widgetbuilder-widget__tab-content--builder">
            <div className="widgetbuilder-widget__builder-layout">
                {/* Left: palette */}
                <div className="widgetbuilder-widget__palette">
                    <div className="widgetbuilder-widget__section-title">Components</div>
                    {PALETTE_COMPONENTS.map((c) => (
                        <div key={c.id} className="widgetbuilder-widget__palette-item" draggable>
                            <span className="widgetbuilder-widget__palette-icon">{c.icon}</span>
                            <span>{c.label}</span>
                        </div>
                    ))}
                    <div className="widgetbuilder-widget__section-title" style={{ marginTop: 12 }}>Templates</div>
                    {MOCK_TEMPLATES.map((t) => (
                        <div key={t.id} className="widgetbuilder-widget__template-item">
                            <div className="widgetbuilder-widget__template-name">{t.name}</div>
                            <div className="widgetbuilder-widget__template-desc">{t.desc}</div>
                        </div>
                    ))}
                </div>

                {/* Center: canvas */}
                <div className="widgetbuilder-widget__canvas">
                    <div className="widgetbuilder-widget__section-title">Canvas</div>
                    <div className="widgetbuilder-widget__canvas-area">
                        {MOCK_CANVAS_LAYOUT.map((comp) => (
                            <div
                                key={comp.id}
                                className={`widgetbuilder-widget__canvas-comp widgetbuilder-widget__canvas-comp--${comp.type} ${selected === comp.id ? "selected" : ""}`}
                                style={{ left: comp.x, top: comp.y, width: comp.w, height: comp.h }}
                                onClick={() => setSelected(comp.id)}
                            >
                                <span>{comp.label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right: properties */}
                <div className="widgetbuilder-widget__properties">
                    <div className="widgetbuilder-widget__section-title">Widget</div>
                    <label className="widgetbuilder-widget__prop-label">Name</label>
                    <input
                        className="widgetbuilder-widget__input"
                        value={widgetName}
                        onChange={(e) => setWidgetName(e.target.value)}
                    />
                    <label className="widgetbuilder-widget__prop-label">Description</label>
                    <input
                        className="widgetbuilder-widget__input"
                        value={widgetDesc}
                        onChange={(e) => setWidgetDesc(e.target.value)}
                    />

                    {selectedComp && (
                        <>
                            <div className="widgetbuilder-widget__section-title" style={{ marginTop: 12 }}>
                                Selected: {selectedComp.type}
                            </div>
                            <label className="widgetbuilder-widget__prop-label">Label</label>
                            <input className="widgetbuilder-widget__input" defaultValue={selectedComp.label} />
                            <label className="widgetbuilder-widget__prop-label">Width</label>
                            <input className="widgetbuilder-widget__input" defaultValue={selectedComp.w} type="number" />
                            <label className="widgetbuilder-widget__prop-label">Height</label>
                            <input className="widgetbuilder-widget__input" defaultValue={selectedComp.h} type="number" />
                        </>
                    )}

                    <div className="widgetbuilder-widget__builder-actions">
                        <button
                            className="widgetbuilder-widget__btn widgetbuilder-widget__btn--primary"
                            onClick={handleExport}
                        >
                            {exported ? "✓ Copied!" : "Export Code"}
                        </button>
                        <button className="widgetbuilder-widget__btn widgetbuilder-widget__btn--ghost">
                            Preview
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Root Component ──────────────────────────────────────────────────────────

type TabId = "aichat" | "storage" | "dbquery" | "http" | "builder";

const TABS: Array<{ id: TabId; label: string }> = [
    { id: "aichat", label: "AI Chat" },
    { id: "storage", label: "Storage" },
    { id: "dbquery", label: "DB Query" },
    { id: "http", label: "HTTP" },
    { id: "builder", label: "Builder" },
];

export const WidgetBuilder: React.FC<ViewComponentProps<WidgetBuilderViewModel>> = ({ model }) => {
    const [activeTab, setActiveTab] = useAtom(model.activeTab);

    return (
        <div className="widgetbuilder-widget">
            <div className="widgetbuilder-widget__header-bar">
                <div className="widgetbuilder-widget__title">
                    <span className="widgetbuilder-widget__title-icon">✦</span>
                    <span>Custom Widget Builder</span>
                </div>
            </div>
            <div className="widgetbuilder-widget__tabs">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        className={`widgetbuilder-widget__tab ${activeTab === tab.id ? "active" : ""}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="widgetbuilder-widget__body">
                {activeTab === "aichat" && <AiChatTab model={model} />}
                {activeTab === "storage" && <StorageTab model={model} />}
                {activeTab === "dbquery" && <DbQueryTab model={model} />}
                {activeTab === "http" && <HttpTab model={model} />}
                {activeTab === "builder" && <BuilderTab />}
            </div>
        </div>
    );
};
