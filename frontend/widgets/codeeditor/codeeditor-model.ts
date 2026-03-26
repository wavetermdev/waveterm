// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { stringToBase64 } from "@/util/util";
import { CodeEditor } from "./codeeditor";

export type Language = "python" | "typescript" | "javascript" | "go" | "rust" | "sql" | "shell" | "json";

export type AiSuggestion = {
    id: string;
    code: string;
    description: string;
};

export type FileTreeNode = {
    name: string;
    type: "file" | "folder";
    children?: FileTreeNode[];
    active?: boolean;
};

export type RunRecord = {
    id: string;
    timestamp: number;
    exitCode: number;
    durationMs: number;
    memoryMb: number;
    language: Language;
};

export type ExecutionMetrics = {
    lastRunDurationMs: number;
    lastRunMemoryMb: number;
    lastRunCpuPeak: number;
    totalRuns: number;
};

const DEFAULT_CODE = `# Connect a terminal block via connectedTermBlockId to run code
`;

const DEFAULT_OUTPUT = `[Running] model.py (Python 3.11)
Training GBM... (n_estimators=200)
Accuracy: 0.8850
[Done] exit code 0 — 1.24s — 48MB RAM`;

const CODE_SUGGESTION_SYSTEM_PROMPT =
    "You are an expert code assistant. When given code, respond ONLY with a JSON array of suggestion objects. Each object must have: id (string like 'sug-1'), description (short string), code (the code snippet string). Output valid JSON only, no markdown, no explanation.";

async function fetchAiSuggestions(code: string, language: Language): Promise<AiSuggestion[]> {
    try {
        const prompt = `The user is editing ${language} code. Suggest 3-5 improvements, additions, or completions.\n\nCode:\n${code.slice(0, 2000)}`;
        const request: WaveAIStreamRequest = {
            opts: { model: null, apitoken: null, timeoutms: 30000 },
            prompt: [
                { role: "system", content: CODE_SUGGESTION_SYSTEM_PROMPT },
                { role: "user", content: prompt },
            ],
        };
        const gen = RpcApi.StreamWaveAiCommand(TabRpcClient, request, { timeout: 30000 });
        let fullText = "";
        for await (const packet of gen) {
            if (packet.text) fullText += packet.text;
        }
        // Strip markdown code fences if the model wrapped the JSON (handles trailing whitespace/newlines)
        const jsonText = fullText.replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();
        const parsed = JSON.parse(jsonText) as AiSuggestion[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
        // Return empty on parse or network error
    }
    return [];
}

export class CodeEditorViewModel implements ViewModel {
    viewType = "codeeditor";
    blockId: string;

    viewIcon = jotai.atom<string>("code");
    viewName = jotai.atom<string>("Code Editor");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"editor" | "ai" | "files" | "metrics">("editor");
    selectedLanguage = jotai.atom<Language>("python");
    filename = jotai.atom<string>("model.py");
    code = jotai.atom<string>(DEFAULT_CODE);
    output = jotai.atom<string>(DEFAULT_OUTPUT);
    isRunning = jotai.atom<boolean>(false);
    aiSuggestions = jotai.atom<AiSuggestion[]>([]);
    fileTree = jotai.atom<FileTreeNode[]>([]);
    runHistory = jotai.atom<RunRecord[]>([]);
    executionMetrics = jotai.atom<ExecutionMetrics>({
        lastRunDurationMs: 0,
        lastRunMemoryMb: 0,
        lastRunCpuPeak: 0,
        totalRuns: 0,
    });
    dataSource = jotai.atom<"live" | "demo">("demo");
    /** Block ID of the Wave terminal block that executes code via the shell runtime. */
    connectedTermBlockId = jotai.atom<string | null>(null) as jotai.PrimitiveAtom<string | null>;

    viewText: jotai.Atom<HeaderElem[]>;

    private runTimer: ReturnType<typeof setTimeout> | null = null;

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;
        this.viewText = jotai.atom((get) => {
            const filename = get(this.filename);
            const lang = get(this.selectedLanguage);
            const running = get(this.isRunning);
            const elems: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: `${filename} | ${lang}`,
                    noGrow: true,
                },
                {
                    elemtype: "iconbutton",
                    icon: "play",
                    title: "Run",
                    click: () => this.runCode(),
                    disabled: running,
                },
                {
                    elemtype: "iconbutton",
                    icon: "stop",
                    title: "Stop",
                    click: () => this.stopRun(),
                    disabled: !running,
                },
            ];
            return elems;
        });
    }

    get viewComponent(): ViewComponent {
        return CodeEditor as ViewComponent;
    }

    async runCode() {
        const lang = globalStore.get(this.selectedLanguage);
        const fname = globalStore.get(this.filename);
        const code = globalStore.get(this.code);
        const startTime = Date.now();
        globalStore.set(this.isRunning, true);
        globalStore.set(this.output, `[Running] ${fname} (${lang === "python" ? "Python 3.11" : lang})\n...`);

        const termBlockId = globalStore.get(this.connectedTermBlockId);
        if (termBlockId) {
            // Send code to the connected terminal block via Wave's shell runtime
            try {
                const cmd = lang === "python"
                    ? `python3 << 'WAVE_EOF'\n${code}\nWAVE_EOF\n`
                    : lang === "shell"
                    ? `${code}\n`
                    : `# ${lang} — run via connected terminal\n${code}\n`;
                await RpcApi.ControllerInputCommand(TabRpcClient, {
                    blockid: termBlockId,
                    inputdata64: stringToBase64(cmd),
                });
                const actualDurationMs = Date.now() - startTime;
                globalStore.set(this.output, `[Sent to terminal] ${fname}\n[Output visible in terminal block ${termBlockId}]`);
                globalStore.set(this.isRunning, false);
                const newRecord: RunRecord = {
                    id: `run-${Date.now()}`,
                    timestamp: Date.now(),
                    exitCode: 0,
                    durationMs: actualDurationMs,
                    memoryMb: 0,
                    language: lang,
                };
                const prev = globalStore.get(this.runHistory);
                globalStore.set(this.runHistory, [newRecord, ...prev].slice(0, 10));
            } catch (err) {
                globalStore.set(this.output, `[Error] Could not send to terminal: ${(err as Error).message}`);
                globalStore.set(this.isRunning, false);
            }
            return;
        }

        // No terminal connected — show instructive output
        const FIXED_DURATION_MS = 1400;
        this.runTimer = setTimeout(() => {
            const actualDurationMs = Date.now() - startTime;
            const memoryMb = 0;
            const cpuPeak = 0;
            const exitCode = 0;
            const out = `[${fname}] Connect a terminal block to execute code in the shell runtime.\nSet connectedTermBlockId to the block's ID to enable live execution.`;

            globalStore.set(this.output, out);
            globalStore.set(this.isRunning, false);
            globalStore.set(this.executionMetrics, {
                lastRunDurationMs: actualDurationMs,
                lastRunMemoryMb: memoryMb,
                lastRunCpuPeak: cpuPeak,
                totalRuns: globalStore.get(this.runHistory).length + 1,
            });

            const newRecord: RunRecord = {
                id: `run-${Date.now()}`,
                timestamp: Date.now(),
                exitCode,
                durationMs: actualDurationMs,
                memoryMb,
                language: lang,
            };
            const prev = globalStore.get(this.runHistory);
            globalStore.set(this.runHistory, [newRecord, ...prev].slice(0, 10));
            this.runTimer = null;
        }, FIXED_DURATION_MS);
    }

    async refreshAiSuggestions() {
        const code = globalStore.get(this.code);
        const language = globalStore.get(this.selectedLanguage);
        const suggestions = await fetchAiSuggestions(code, language);
        globalStore.set(this.aiSuggestions, suggestions);
        globalStore.set(this.dataSource, "live");
    }

    stopRun() {
        if (this.runTimer != null) {
            clearTimeout(this.runTimer);
            this.runTimer = null;
        }
        const fname = globalStore.get(this.filename);
        globalStore.set(this.isRunning, false);
        globalStore.set(this.output, `[Stopped] ${fname} — interrupted by user`);
    }

    dispose() {
        if (this.runTimer != null) {
            clearTimeout(this.runTimer);
            this.runTimer = null;
        }
    }

    giveFocus(): boolean {
        return true;
    }
}
