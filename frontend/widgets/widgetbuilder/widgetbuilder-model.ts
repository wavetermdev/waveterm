// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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

const MOCK_AI_RESPONSES = [
    "Here's a widget component that implements your request. The code uses React hooks and follows the Wave Terminal pattern:",
    "I've updated the widget with your requested changes. Here's the revised implementation:",
    "Great idea! Here's an optimized version with the feature you described:",
    "I can help with that. Here's a clean implementation using Wave Terminal's ViewModel pattern:",
];

const MOCK_CODE_SNIPPETS = [
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
    `function MyWidget({ model }: ViewComponentProps<MyWidgetViewModel>) {
  const data = useAtomValue(model.data);
  return (
    <div className="my-widget">
      {data.map((item, i) => (
        <div key={i} className="my-widget__item">{item}</div>
      ))}
    </div>
  );
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

        // Simulate network delay then stream response word-by-word
        await new Promise((r) => setTimeout(r, 400));

        const responseText = MOCK_AI_RESPONSES[Math.floor(Math.random() * MOCK_AI_RESPONSES.length)];
        const codeBlock = MOCK_CODE_SNIPPETS[Math.floor(Math.random() * MOCK_CODE_SNIPPETS.length)];

        const assistantMsg: ChatMessage = {
            id: generateMsgId(),
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            codeBlock,
        };
        const withAssistant = [...globalStore.get(this.chatMessages), assistantMsg];
        globalStore.set(this.chatMessages, withAssistant);

        const words = responseText.split(" ");
        for (let i = 0; i < words.length; i++) {
            await new Promise((r) => setTimeout(r, 30));
            const updated = globalStore.get(this.chatMessages).map((m) =>
                m.id === assistantMsg.id
                    ? { ...m, content: words.slice(0, i + 1).join(" ") }
                    : m
            );
            globalStore.set(this.chatMessages, updated);
        }

        globalStore.set(this.isStreaming, false);
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

        await new Promise((r) => setTimeout(r, 350 + Math.random() * 300));

        const execMs = Math.round(15 + Math.random() * 50);
        globalStore.set(this.queryResults, { ...MOCK_QUERY_RESULT, executionMs: execMs });

        // Add to history (keep last 5)
        const hist = globalStore.get(this.queryHistory);
        const next = [sql, ...hist.filter((q) => q !== sql)].slice(0, 5);
        globalStore.set(this.queryHistory, next);
        globalStore.set(this.isRunningQuery, false);
    }

    async sendHttpRequest() {
        globalStore.set(this.isSendingRequest, true);
        globalStore.set(this.httpResponse, null);

        await new Promise((r) => setTimeout(r, 250 + Math.random() * 400));

        const ms = Math.round(80 + Math.random() * 250);
        const method = globalStore.get(this.httpMethod);
        const url = globalStore.get(this.httpUrl);

        const resp: HttpResponse = { ...MOCK_HTTP_RESPONSE, ms };
        globalStore.set(this.httpResponse, resp);

        const hist = globalStore.get(this.requestHistory);
        const newItem: RequestHistoryItem = {
            id: `req-${Date.now()}`,
            method,
            url,
            status: 200,
            ms,
            timestamp: Date.now(),
        };
        globalStore.set(this.requestHistory, [newItem, ...hist].slice(0, 6));
        globalStore.set(this.isSendingRequest, false);
    }

    giveFocus(): boolean {
        return true;
    }
}
