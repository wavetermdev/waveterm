// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isPreviewWindow } from "@/app/store/windowtype";
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

const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
    {
        id: "msg-1",
        role: "user",
        content: "Create a widget that shows BTC price",
        timestamp: Date.now() - 120000,
    },
    {
        id: "msg-2",
        role: "assistant",
        content: "Here's a minimal BTC price widget:",
        timestamp: Date.now() - 119000,
        codeBlock: `import * as jotai from "jotai";
import { globalStore } from "@/app/store/jotaiStore";

export class BtcPriceViewModel implements ViewModel {
  viewType = "btcprice";
  viewIcon = jotai.atom("bitcoin");
  viewName = jotai.atom("BTC Price");
  btcPrice = jotai.atom(67450.00);

  get viewComponent() { return BtcPriceWidget; }

  constructor({ blockId }: ViewModelInitType) {
    setInterval(() => {
      const p = globalStore.get(this.btcPrice);
      globalStore.set(this.btcPrice, p * (1 + (Math.random() - 0.5) * 0.002));
    }, 2000);
  }
}`,
    },
    {
        id: "msg-3",
        role: "user",
        content: "Add a sparkline chart to it",
        timestamp: Date.now() - 60000,
    },
    {
        id: "msg-4",
        role: "assistant",
        content: "Updated with a canvas sparkline chart:",
        timestamp: Date.now() - 59000,
        codeBlock: `function Sparkline({ prices }: { prices: number[] }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    const w = c.width, h = c.height;
    const min = Math.min(...prices), max = Math.max(...prices);
    const range = max - min || 1;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    prices.forEach((p, i) => {
      const x = (i / (prices.length - 1)) * w;
      const y = h - ((p - min) / range) * (h - 6) - 3;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [prices]);
  return <canvas ref={ref} width={200} height={50} />;
}`,
    },
];

const INITIAL_STORAGE_ENTRIES: StorageEntry[] = [
    {
        key: "user.preferences",
        value: '{"theme":"dark","language":"en","notifications":true}',
        size: 52,
        createdAt: Date.now() - 7 * 86400000,
        updatedAt: Date.now() - 3600000,
    },
    {
        key: "widget.config",
        value: '{"refreshInterval":5000,"maxItems":100,"showChart":true}',
        size: 56,
        createdAt: Date.now() - 2 * 86400000,
        updatedAt: Date.now() - 1800000,
    },
    {
        key: "cache.btcPrice",
        value: '{"price":67450.25,"ts":1718000000000}',
        size: 38,
        createdAt: Date.now() - 600000,
        updatedAt: Date.now() - 5000,
    },
    {
        key: "api.results.markets",
        value: '[{"symbol":"BTC","apy":0.042},{"symbol":"ETH","apy":0.038}]',
        size: 60,
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 900000,
    },
    {
        key: "session.data",
        value: '{"userId":"u_abc123","startedAt":1718000000000,"pageViews":7}',
        size: 62,
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 120000,
    },
];

const INITIAL_QUERY = `SELECT asset, supply_apy, borrow_apy, utilization
FROM money_markets
ORDER BY utilization DESC
LIMIT 10;`;

const MOCK_QUERY_RESULT: QueryResult = {
    columns: ["asset", "supply_apy", "borrow_apy", "utilization"],
    rows: [
        ["USDC", "4.82%", "6.91%", "92.4%"],
        ["ETH", "2.34%", "3.87%", "78.1%"],
        ["BTC", "1.95%", "3.12%", "71.6%"],
        ["SOL", "3.41%", "5.78%", "65.3%"],
        ["ARB", "5.12%", "8.43%", "58.7%"],
    ],
    executionMs: 23,
};

const INITIAL_REQUEST_HISTORY: RequestHistoryItem[] = [
    {
        id: "req-1",
        method: "GET",
        url: "https://api.hyperliquid.xyz/info",
        status: 200,
        ms: 142,
        timestamp: Date.now() - 3600000,
    },
    {
        id: "req-2",
        method: "POST",
        url: "https://api.hyperliquid.xyz/exchange",
        status: 200,
        ms: 98,
        timestamp: Date.now() - 3000000,
    },
    {
        id: "req-3",
        method: "GET",
        url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin",
        status: 200,
        ms: 211,
        timestamp: Date.now() - 7200000,
    },
    {
        id: "req-4",
        method: "POST",
        url: "https://api.openai.com/v1/chat/completions",
        status: 429,
        ms: 55,
        timestamp: Date.now() - 10800000,
    },
    {
        id: "req-5",
        method: "GET",
        url: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
        status: 200,
        ms: 176,
        timestamp: Date.now() - 14400000,
    },
    {
        id: "req-6",
        method: "DELETE",
        url: "https://my-api.example.com/widgets/42",
        status: 404,
        ms: 34,
        timestamp: Date.now() - 18000000,
    },
];

const MOCK_HTTP_RESPONSE: HttpResponse = {
    status: 200,
    ms: 142,
    body: JSON.stringify(
        {
            markets: [
                { name: "BTC-PERP", price: 67450.25, volume24h: 1204500000, openInterest: 890340000 },
                { name: "ETH-PERP", price: 3521.8, volume24h: 534200000, openInterest: 312400000 },
                { name: "SOL-PERP", price: 182.45, volume24h: 89300000, openInterest: 45600000 },
            ],
            funding: { BTC: 0.00012, ETH: 0.00008, SOL: 0.00021 },
            timestamp: Date.now(),
        },
        null,
        2
    ),
    headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "98",
        "x-response-time": "142ms",
    },
};

function generateMsgId() {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const WIDGET_SYSTEM_PROMPT =
    "You are an expert Wave Terminal widget developer. The user wants to build widgets using React + Jotai atoms + TypeScript following Wave Terminal's ViewModel pattern. Generate clean, typed, production-ready code. Respond with concise explanations followed by code blocks.";

// Inline fallbacks used only in preview mode
const PREVIEW_AI_RESPONSES = [
    "Here's a widget component that implements your request. The code uses React hooks and follows the Wave Terminal pattern:",
    "I've updated the widget with your requested changes. Here's the revised implementation:",
];

const PREVIEW_CODE_SNIPPETS = [
    `export class MyWidgetViewModel implements ViewModel {
  viewType = "mywidget";
  viewIcon = jotai.atom("star");
  viewName = jotai.atom("My Widget");
  data = jotai.atom<string[]>([]);

  get viewComponent() { return MyWidget; }

  constructor({ blockId }: ViewModelInitType) {
    // Initialize widget
  }
}`,
];

export class WidgetBuilderViewModel implements ViewModel {
    viewType = "widgetbuilder";
    blockId: string;

    viewIcon = jotai.atom<string>("wand-magic-sparkles");
    viewName = jotai.atom<string>("Widget Builder");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"aichat" | "storage" | "dbquery" | "http" | "builder">("aichat");
    chatMessages = jotai.atom<ChatMessage[]>(INITIAL_CHAT_MESSAGES);
    selectedAiModel = jotai.atom<string>("GPT-4o");
    isStreaming = jotai.atom<boolean>(false);

    storageEntries = jotai.atom<StorageEntry[]>(INITIAL_STORAGE_ENTRIES);
    selectedNamespace = jotai.atom<string>("widget");

    selectedDbConnection = jotai.atom<string>("wave-postgres (local)");
    sqlQuery = jotai.atom<string>(INITIAL_QUERY);
    queryResults = jotai.atom(null as QueryResult | null);
    queryHistory = jotai.atom<string[]>([INITIAL_QUERY]);
    isRunningQuery = jotai.atom<boolean>(false);

    httpMethod = jotai.atom<string>("GET");
    httpUrl = jotai.atom<string>("https://api.hyperliquid.xyz/info");
    httpResponse = jotai.atom(MOCK_HTTP_RESPONSE as HttpResponse | null);
    requestHistory = jotai.atom<RequestHistoryItem[]>(INITIAL_REQUEST_HISTORY);
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

        if (isPreviewWindow()) {
            // Preview fallback: simulate streaming
            await new Promise((r) => setTimeout(r, 400));
            const responseText = PREVIEW_AI_RESPONSES[Math.floor(Math.random() * PREVIEW_AI_RESPONSES.length)];
            const codeBlock = PREVIEW_CODE_SNIPPETS[0];
            const words = responseText.split(" ");
            for (let i = 0; i < words.length; i++) {
                await new Promise((r) => setTimeout(r, 30));
                const updated = globalStore.get(this.chatMessages).map((m) =>
                    m.id === assistantMsg.id
                        ? { ...m, content: words.slice(0, i + 1).join(" "), codeBlock }
                        : m
                );
                globalStore.set(this.chatMessages, updated);
            }
            globalStore.set(this.isStreaming, false);
            return;
        }

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

        await new Promise((r) => setTimeout(r, 200 + Math.random() * 200));
        const execMs = Math.round(8 + Math.random() * 60);

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
                    if (c.includes("apy") || c.includes("rate")) return `${(2 + Math.random() * 8).toFixed(2)}%`;
                    if (c.includes("utilization") || c.includes("pct")) return `${(40 + Math.random() * 55).toFixed(1)}%`;
                    if (c.includes("price") || c.includes("amount")) return `${(100 + Math.random() * 9900).toFixed(2)}`;
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
            const rowCount = Math.floor(1 + Math.random() * 5);
            result = { columns: ["affected_rows"], rows: [[String(rowCount)]], executionMs: execMs };
        } else if (upperSql.startsWith("DELETE")) {
            const rowCount = Math.floor(0 + Math.random() * 3);
            result = { columns: ["affected_rows"], rows: [[String(rowCount)]], executionMs: execMs };
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

        if (isPreviewWindow()) {
            // Preview fallback: return mock response
            await new Promise((r) => setTimeout(r, 250 + Math.random() * 400));
            resp = {
                status: 200,
                ms: Math.round(80 + Math.random() * 250),
                body: JSON.stringify({ status: "ok", preview: true }, null, 2),
                headers: { "content-type": "application/json" },
            };
        } else {
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
