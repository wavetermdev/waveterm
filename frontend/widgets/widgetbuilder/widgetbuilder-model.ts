// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { WidgetBuilder } from "./widgetbuilder";

export type ChatMessage = {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    codeBlock?: string;
};

export type StorageEntry = {
    key: string;
    value: string;
    size: number;
    createdAt: number;
    updatedAt: number;
};

export type QueryResult = {
    columns: string[];
    rows: string[][];
    executionMs: number;
};

export type HttpResponse = {
    status: number;
    body: string;
    ms: number;
    headers: Record<string, string>;
};

export type RequestHistoryItem = {
    id: string;
    method: string;
    url: string;
    status: number;
    ms: number;
    timestamp: number;
};


const INITIAL_QUERY = `SELECT asset, supply_apy, borrow_apy, utilization
FROM money_markets
ORDER BY utilization DESC
LIMIT 10;`;



function generateMsgId() {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const WIDGET_SYSTEM_PROMPT =
    "You are an expert Wave Terminal widget developer. The user wants to build widgets using React + Jotai atoms + TypeScript following Wave Terminal's ViewModel pattern. Generate clean, typed, production-ready code. Respond with concise explanations followed by code blocks.";

export class WidgetBuilderViewModel implements ViewModel {
    viewType = "widgetbuilder";
    blockId: string;

    viewIcon = jotai.atom<string>("wand-magic-sparkles");
    viewName = jotai.atom<string>("Widget Builder");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"aichat" | "storage" | "dbquery" | "http" | "builder">("aichat");
    chatMessages = jotai.atom<ChatMessage[]>([]);
    selectedAiModel = jotai.atom<string>("GPT-4o");
    isStreaming = jotai.atom<boolean>(false);

    storageEntries = jotai.atom<StorageEntry[]>([]);
    selectedNamespace = jotai.atom<string>("widget");

    selectedDbConnection = jotai.atom<string>("wave-postgres (local)");
    sqlQuery = jotai.atom<string>(INITIAL_QUERY);
    queryResults = jotai.atom(null as QueryResult | null);
    queryHistory = jotai.atom<string[]>([INITIAL_QUERY]);
    isRunningQuery = jotai.atom<boolean>(false);

    httpMethod = jotai.atom<string>("GET");
    httpUrl = jotai.atom<string>("https://api.hyperliquid.xyz/info");
    httpResponse = jotai.atom<HttpResponse | null>(null) as jotai.PrimitiveAtom<HttpResponse | null>;
    requestHistory = jotai.atom<RequestHistoryItem[]>([]);
    isSendingRequest = jotai.atom<boolean>(false);

    viewText: jotai.Atom<HeaderElem[]>;

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;
        this.viewText = jotai.atom((get) => {
            const tab = get(this.activeTab);
            const tabLabels: Record<string, string> = {
                aichat: "AI Chat",
                storage: "Storage",
                dbquery: "DB Query",
                http: "HTTP",
                builder: "Builder",
            };
            const elems: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: `Widget Builder | ${tabLabels[tab] ?? tab}`,
                    noGrow: true,
                },
            ];
            return elems;
        });
    }

    get viewComponent(): ViewComponent {
        return WidgetBuilder as ViewComponent;
    }

    async sendChatMessage(content: string) {
        if (!content.trim()) return;

        const userMsg: ChatMessage = {
            id: generateMsgId(),
            role: "user",
            content: content.trim(),
            timestamp: Date.now(),
        };
        const prev = globalStore.get(this.chatMessages);
        globalStore.set(this.chatMessages, [...prev, userMsg]);
        globalStore.set(this.isStreaming, true);

        const assistantMsg: ChatMessage = {
            id: generateMsgId(),
            role: "assistant",
            content: "",
            timestamp: Date.now(),
        };
        globalStore.set(this.chatMessages, [...globalStore.get(this.chatMessages), assistantMsg]);

        try {
            const request: WaveAIStreamRequest = {
                opts: { model: null, apitoken: null, timeoutms: 60000 },
                prompt: [
                    { role: "system", content: WIDGET_SYSTEM_PROMPT },
                    { role: "user", content: content.trim() },
                ],
            };
            const gen = RpcApi.StreamWaveAiCommand(TabRpcClient, request, { timeout: 60000 });
            let fullText = "";
            for await (const packet of gen) {
                if (packet.error) {
                    const updated = globalStore.get(this.chatMessages).map((m) =>
                        m.id === assistantMsg.id ? { ...m, content: `Error: ${packet.error}` } : m
                    );
                    globalStore.set(this.chatMessages, updated);
                    break;
                }
                if (packet.text) {
                    fullText += packet.text;
                    // Extract code block if present (```...```)
                    const codeMatch = fullText.match(/```(?:\w+\n)?([\s\S]*?)```/);
                    const codeBlock = codeMatch ? codeMatch[1].trim() : undefined;
                    const displayText = codeMatch ? fullText.slice(0, fullText.indexOf("```")).trim() : fullText;
                    const updated = globalStore.get(this.chatMessages).map((m) =>
                        m.id === assistantMsg.id ? { ...m, content: displayText, codeBlock } : m
                    );
                    globalStore.set(this.chatMessages, updated);
                }
            }
        } catch (err) {
            const errText = (err as Error).message ?? String(err);
            const updated = globalStore.get(this.chatMessages).map((m) =>
                m.id === assistantMsg.id ? { ...m, content: `Error: ${errText}` } : m
            );
            globalStore.set(this.chatMessages, updated);
        } finally {
            globalStore.set(this.isStreaming, false);
        }
    }

    clearChat() {
        globalStore.set(this.chatMessages, []);
        globalStore.set(this.isStreaming, false);
    }

    async runQuery() {
        const sql = globalStore.get(this.sqlQuery);
        if (!sql.trim()) return;
        globalStore.set(this.isRunningQuery, true);
        globalStore.set(this.queryResults, null);

        // Client-side SQL syntax check
        const upperSql = sql.trim().toUpperCase();
        const validKeywords = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "WITH", "EXPLAIN"];
        const isValid = validKeywords.some((kw) => upperSql.startsWith(kw));
        if (!isValid) {
            await new Promise((r) => setTimeout(r, 80));
            globalStore.set(this.queryResults, {
                columns: ["error"],
                rows: [["Syntax error: statement must begin with a valid SQL keyword"]],
                executionMs: 1,
            });
            globalStore.set(this.isRunningQuery, false);
            return;
        }

        await new Promise((r) => setTimeout(r, 200));
        const execMs = 28;

        // Derive columns and mock rows from the query content
        let result: QueryResult;
        if (upperSql.startsWith("SELECT")) {
            // Try to extract column names from SELECT clause
            const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
            const fromMatch = sql.match(/FROM\s+(\w+)/i);
            const tableName = fromMatch ? fromMatch[1] : "result";

            let columns: string[];
            if (selectMatch && !selectMatch[1].trim().startsWith("*")) {
                columns = selectMatch[1].split(",").map((c) => c.trim().split(/\s+/).pop()!.replace(/['"]/g, ""));
            } else {
                columns = ["id", "name", "value", "created_at"];
            }

            // Use the table name's first char code as a deterministic seed for mock row values
            const seed = tableName.charCodeAt(0) ?? 65; /* fallback: 'A' */
            const rows: string[][] = Array.from({ length: 5 }, (_, i) => {
                return columns.map((col) => {
                    const c = col.toLowerCase();
                    if (c.includes("id")) return String(seed * 10 + i + 1);
                    if (c.includes("apy") || c.includes("rate")) return `${(4.82 + i * 0.31).toFixed(2)}%`;
                    if (c.includes("utilization") || c.includes("pct")) return `${(72 + i * 3).toFixed(1)}%`;
                    if (c.includes("price") || c.includes("amount")) return `${(1000 + seed * 10 + i * 250).toFixed(2)}`;
                    if (c.includes("name") || c.includes("asset") || c.includes("symbol")) {
                        const names = ["USDC", "ETH", "BTC", "SOL", "ARB"];
                        return names[(i + seed) % names.length];
                    }
                    if (c.includes("date") || c.includes("_at")) return new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
                    return `value_${i + 1}`;
                });
            });
            result = { columns, rows, executionMs: execMs };
        } else if (upperSql.startsWith("INSERT")) {
            result = { columns: ["affected_rows"], rows: [["1"]], executionMs: execMs };
        } else if (upperSql.startsWith("UPDATE")) {
            result = { columns: ["affected_rows"], rows: [["3"]], executionMs: execMs };
        } else if (upperSql.startsWith("DELETE")) {
            result = { columns: ["affected_rows"], rows: [["1"]], executionMs: execMs };
        } else {
            result = { columns: ["status"], rows: [["OK"]], executionMs: execMs };
        }

        globalStore.set(this.queryResults, result);

        // Add to history (keep last 5)
        const hist = globalStore.get(this.queryHistory);
        const next = [sql, ...hist.filter((q) => q !== sql)].slice(0, 5);
        globalStore.set(this.queryHistory, next);
        globalStore.set(this.isRunningQuery, false);
    }

    async sendHttpRequest() {
        globalStore.set(this.isSendingRequest, true);
        globalStore.set(this.httpResponse, null);

        const method = globalStore.get(this.httpMethod);
        const url = globalStore.get(this.httpUrl);

        let resp: HttpResponse;

        const start = Date.now();
        try {
            const fetchOpts: RequestInit = {
                method,
                headers: { Accept: "application/json, text/plain, */*" },
                signal: AbortSignal.timeout(15000),
            };
            const res = await fetch(url, fetchOpts);
            const body = await res.text();
            const ms = Date.now() - start;
            const headers: Record<string, string> = {};
            res.headers.forEach((value, key) => { headers[key] = value; });
            resp = { status: res.status, body, ms, headers };
        } catch (err) {
            resp = {
                status: 0,
                body: `Network error: ${(err as Error).message}`,
                ms: Date.now() - start,
                headers: {},
            };
        }

        globalStore.set(this.httpResponse, resp);

        const hist = globalStore.get(this.requestHistory);
        const newItem: RequestHistoryItem = {
            id: `req-${Date.now()}`,
            method,
            url,
            status: resp.status,
            ms: resp.ms,
            timestamp: Date.now(),
        };
        globalStore.set(this.requestHistory, [newItem, ...hist].slice(0, 6));
        globalStore.set(this.isSendingRequest, false);
    }

    giveFocus(): boolean {
        return true;
    }
}
