// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
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

const DEFAULT_CODE = `import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score

# Load and prepare data
X_train = np.random.randn(1000, 10)
y_train = (X_train[:, 0] + X_train[:, 1] > 0).astype(int)
X_test  = np.random.randn(200, 10)
y_test  = (X_test[:, 0] + X_test[:, 1] > 0).astype(int)

# Train GBM model
model = GradientBoostingClassifier(
    n_estimators=200,
    learning_rate=0.05,
    max_depth=4,
    subsample=0.8,
)
model.fit(X_train, y_train)

# Evaluate
preds  = model.predict(X_test)
acc    = accuracy_score(y_test, preds)
print(f"Accuracy: {acc:.4f}")
`;

const DEFAULT_OUTPUT = `[Running] model.py (Python 3.11)
Training GBM... (n_estimators=200)
Accuracy: 0.8850
[Done] exit code 0 — 1.24s — 48MB RAM`;

function generateMockSuggestions(): AiSuggestion[] {
    return [
        {
            id: "sug-1",
            description: "Add cross-validation with StratifiedKFold",
            code: `from sklearn.model_selection import StratifiedKFold, cross_val_score\ncv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)\nscores = cross_val_score(model, X_train, y_train, cv=cv, scoring="accuracy")\nprint(f"CV Accuracy: {scores.mean():.4f} ± {scores.std():.4f}")`,
        },
        {
            id: "sug-2",
            description: "Plot feature importances",
            code: `import matplotlib.pyplot as plt\nimportances = model.feature_importances_\nindices = np.argsort(importances)[::-1]\nplt.bar(range(X_train.shape[1]), importances[indices])\nplt.title("Feature Importances")\nplt.show()`,
        },
        {
            id: "sug-3",
            description: "Hyperparameter grid search",
            code: `from sklearn.model_selection import GridSearchCV\nparam_grid = {"n_estimators": [100, 200], "max_depth": [3, 4, 5]}\ngrid = GridSearchCV(model, param_grid, cv=3, n_jobs=-1)\ngrid.fit(X_train, y_train)\nprint(f"Best params: {grid.best_params_}")`,
        },
        {
            id: "sug-4",
            description: "Save model with joblib",
            code: `import joblib\njoblib.dump(model, "gbm_model.pkl")\nloaded = joblib.load("gbm_model.pkl")\nprint(f"Loaded model accuracy: {accuracy_score(y_test, loaded.predict(X_test)):.4f}")`,
        },
        {
            id: "sug-5",
            description: "Confusion matrix & classification report",
            code: `from sklearn.metrics import confusion_matrix, classification_report\nprint(confusion_matrix(y_test, preds))\nprint(classification_report(y_test, preds))`,
        },
    ];
}

function generateMockFileTree(): FileTreeNode[] {
    return [
        {
            name: "ml_project",
            type: "folder",
            children: [
                { name: "model.py", type: "file", active: true },
                { name: "data_utils.py", type: "file" },
                { name: "config.json", type: "file" },
            ],
        },
        {
            name: "notebooks",
            type: "folder",
            children: [
                { name: "exploration.ipynb", type: "file" },
                { name: "evaluation.ipynb", type: "file" },
            ],
        },
        { name: "requirements.txt", type: "file" },
        { name: "README.md", type: "file" },
    ];
}

function generateRunHistory(): RunRecord[] {
    const now = Date.now();
    return Array.from({ length: 10 }, (_, i) => ({
        id: `run-${i}`,
        timestamp: now - i * 180_000,
        exitCode: i === 2 || i === 7 ? 1 : 0,
        durationMs: 900 + Math.round(Math.random() * 800),
        memoryMb: 38 + Math.round(Math.random() * 24),
        language: "python",
    }));
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
    aiSuggestions = jotai.atom<AiSuggestion[]>(generateMockSuggestions());
    fileTree = jotai.atom<FileTreeNode[]>(generateMockFileTree());
    runHistory = jotai.atom<RunRecord[]>(generateRunHistory());
    executionMetrics = jotai.atom<ExecutionMetrics>({
        lastRunDurationMs: 1240,
        lastRunMemoryMb: 48,
        lastRunCpuPeak: 73,
        totalRuns: 10,
    });

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

    runCode() {
        const lang = globalStore.get(this.selectedLanguage);
        const fname = globalStore.get(this.filename);
        globalStore.set(this.isRunning, true);
        globalStore.set(this.output, `[Running] ${fname} (${lang === "python" ? "Python 3.11" : lang})\n...`);

        this.runTimer = setTimeout(() => {
            const durationMs = 900 + Math.round(Math.random() * 800);
            const memoryMb = 38 + Math.round(Math.random() * 24);
            const cpuPeak = 55 + Math.round(Math.random() * 35);
            const exitCode = Math.random() > 0.9 ? 1 : 0;
            const mockOut =
                exitCode === 0
                    ? `[Running] ${fname} (${lang === "python" ? "Python 3.11" : lang})\nTraining GBM... (n_estimators=200)\nAccuracy: ${(0.82 + Math.random() * 0.08).toFixed(4)}\n[Done] exit code 0 — ${(durationMs / 1000).toFixed(2)}s — ${memoryMb}MB RAM`
                    : `[Running] ${fname} (${lang === "python" ? "Python 3.11" : lang})\nTraceback (most recent call last):\n  File "${fname}", line 7\nModuleNotFoundError: No module named 'sklearn'\n[Error] exit code 1 — ${(durationMs / 1000).toFixed(2)}s`;

            globalStore.set(this.output, mockOut);
            globalStore.set(this.isRunning, false);
            globalStore.set(this.executionMetrics, {
                lastRunDurationMs: durationMs,
                lastRunMemoryMb: memoryMb,
                lastRunCpuPeak: cpuPeak,
                totalRuns: globalStore.get(this.runHistory).length + 1,
            });

            const newRecord: RunRecord = {
                id: `run-${Date.now()}`,
                timestamp: Date.now(),
                exitCode,
                durationMs,
                memoryMb,
                language: lang,
            };
            const prev = globalStore.get(this.runHistory);
            globalStore.set(this.runHistory, [newRecord, ...prev].slice(0, 10));
            this.runTimer = null;
        }, 1500 + Math.random() * 1000);
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
