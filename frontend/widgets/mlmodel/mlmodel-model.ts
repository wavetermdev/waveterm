// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";
import { MLModelWidget } from "./mlmodel";

export type MLModelStatus = "trained" | "training" | "failed";

export type MLModelType = "GBM" | "LR" | "NN-Adam" | "TreeClassifier" | "RF" | "NumpyLogistics";

export type DataSourceType = "CSV" | "JSON" | "DB" | "PDF" | "Safetensor" | "Dataset" | "XML";

export type MLModel = {
    id: string;
    name: string;
    type: MLModelType;
    accuracy: number;
    f1: number;
    trainedDate: string;
    status: MLModelStatus;
};

export type ExportRecord = {
    timestamp: string;
    format: "ONNX" | "Joblib";
    size: string;
    path: string;
};

export type Hyperparams = {
    // GBM
    gbm_n_estimators: number;
    gbm_learning_rate: number;
    gbm_max_depth: number;
    gbm_subsample: number;
    // LR
    lr_C: number;
    lr_max_iter: number;
    lr_solver: "lbfgs" | "saga" | "liblinear";
    // NN-Adam
    nn_hidden_layers: number;
    nn_hidden_size: number;
    nn_learning_rate: number;
    nn_epochs: number;
    nn_dropout: number;
    // TreeClassifier
    tree_max_depth: number;
    tree_min_samples_split: number;
    tree_criterion: "gini" | "entropy";
    // RF
    rf_n_estimators: number;
    rf_max_depth: number;
    rf_max_features: "sqrt" | "log2" | "auto";
    // NumpyLogistics
    np_learning_rate: number;
    np_iterations: number;
    np_regularization: number;
};

const INITIAL_MODELS: MLModel[] = [
    { id: "m1", name: "GBM_v2", type: "GBM", accuracy: 88.5, f1: 0.882, trainedDate: "2024-01-15", status: "trained" },
    { id: "m2", name: "LogReg_baseline", type: "LR", accuracy: 81.2, f1: 0.809, trainedDate: "2024-01-14", status: "trained" },
    { id: "m3", name: "NeuralNet_adam", type: "NN-Adam", accuracy: 91.3, f1: 0.911, trainedDate: "2024-01-16", status: "trained" },
    { id: "m4", name: "RandomForest_v1", type: "RF", accuracy: 86.7, f1: 0.863, trainedDate: "2024-01-13", status: "trained" },
    { id: "m5", name: "NumpyLogistic_v1", type: "NumpyLogistics", accuracy: 79.4, f1: 0.788, trainedDate: "2024-01-12", status: "trained" },
];

const DEFAULT_HYPERPARAMS: Hyperparams = {
    gbm_n_estimators: 200,
    gbm_learning_rate: 0.1,
    gbm_max_depth: 5,
    gbm_subsample: 0.8,
    lr_C: 1.0,
    lr_max_iter: 500,
    lr_solver: "lbfgs",
    nn_hidden_layers: 2,
    nn_hidden_size: 128,
    nn_learning_rate: 0.001,
    nn_epochs: 100,
    nn_dropout: 0.2,
    tree_max_depth: 8,
    tree_min_samples_split: 5,
    tree_criterion: "gini",
    rf_n_estimators: 150,
    rf_max_depth: 10,
    rf_max_features: "sqrt",
    np_learning_rate: 0.01,
    np_iterations: 1000,
    np_regularization: 0.1,
};

const MOCK_EXPORT_HISTORY: ExportRecord[] = [
    { timestamp: "2024-01-16 14:32", format: "ONNX", size: "2.4 MB", path: "/exports/NeuralNet_adam.onnx" },
    { timestamp: "2024-01-16 11:15", format: "Joblib", size: "1.1 MB", path: "/exports/GBM_v2.joblib" },
    { timestamp: "2024-01-15 09:44", format: "ONNX", size: "0.8 MB", path: "/exports/GBM_v2.onnx" },
    { timestamp: "2024-01-14 17:22", format: "Joblib", size: "0.6 MB", path: "/exports/LogReg_baseline.joblib" },
    { timestamp: "2024-01-13 13:08", format: "ONNX", size: "1.7 MB", path: "/exports/RandomForest_v1.onnx" },
];

const TRAIN_LOG_SNIPPETS: Record<MLModelType, string[]> = {
    GBM: [
        "[INFO] Loading dataset...",
        "[INFO] Train split: 80%, Test split: 20%",
        "[INFO] Fitting GradientBoostingClassifier...",
        "[INFO] Iteration 50/200 — loss: 0.4821",
        "[INFO] Iteration 100/200 — loss: 0.3104",
        "[INFO] Iteration 150/200 — loss: 0.2567",
        "[INFO] Iteration 200/200 — loss: 0.2211",
        "[INFO] Evaluating on test set...",
        "[OK]   Accuracy: 88.5%  F1: 0.882",
        "[OK]   Model saved.",
    ],
    LR: [
        "[INFO] Loading dataset...",
        "[INFO] Normalizing features...",
        "[INFO] Fitting LogisticRegression (solver=lbfgs)...",
        "[INFO] Converged after 312 iterations.",
        "[INFO] Evaluating on test set...",
        "[OK]   Accuracy: 81.2%  F1: 0.809",
        "[OK]   Model saved.",
    ],
    "NN-Adam": [
        "[INFO] Loading dataset...",
        "[INFO] Building neural network: 2 hidden layers, size 128...",
        "[INFO] Epoch  10/100 — train_loss: 0.6831  val_loss: 0.7012",
        "[INFO] Epoch  30/100 — train_loss: 0.4215  val_loss: 0.4588",
        "[INFO] Epoch  60/100 — train_loss: 0.2874  val_loss: 0.3102",
        "[INFO] Epoch  80/100 — train_loss: 0.2111  val_loss: 0.2443",
        "[INFO] Epoch 100/100 — train_loss: 0.1782  val_loss: 0.2140",
        "[INFO] Evaluating on test set...",
        "[OK]   Accuracy: 91.3%  F1: 0.911",
        "[OK]   Model saved.",
    ],
    TreeClassifier: [
        "[INFO] Loading dataset...",
        "[INFO] Fitting DecisionTreeClassifier (criterion=gini)...",
        "[INFO] Tree depth: 8, leaves: 47",
        "[INFO] Evaluating on test set...",
        "[OK]   Accuracy: 84.1%  F1: 0.837",
        "[OK]   Model saved.",
    ],
    RF: [
        "[INFO] Loading dataset...",
        "[INFO] Fitting RandomForestClassifier (150 trees)...",
        "[INFO] Tree 50/150 done...",
        "[INFO] Tree 100/150 done...",
        "[INFO] Tree 150/150 done...",
        "[INFO] Evaluating on test set...",
        "[OK]   Accuracy: 86.7%  F1: 0.863",
        "[OK]   Model saved.",
    ],
    NumpyLogistics: [
        "[INFO] Loading dataset...",
        "[INFO] Initializing weights...",
        "[INFO] Step  200/1000 — cost: 0.5912",
        "[INFO] Step  500/1000 — cost: 0.4331",
        "[INFO] Step  800/1000 — cost: 0.3724",
        "[INFO] Step 1000/1000 — cost: 0.3512",
        "[INFO] Evaluating on test set...",
        "[OK]   Accuracy: 79.4%  F1: 0.788",
        "[OK]   Model saved.",
    ],
};

export class MLModelViewModel implements ViewModel {
    viewType = "mlmodel";
    blockId: string;

    viewIcon = jotai.atom<string>("brain");
    viewName = jotai.atom<string>("ML Model Training");
    noPadding = jotai.atom<boolean>(true);

    activeTab = jotai.atom<"models" | "train" | "evaluate" | "data" | "export">("models");
    models = jotai.atom<MLModel[]>(INITIAL_MODELS);
    selectedModelId = jotai.atom<string | null>("m3");
    selectedModelType = jotai.atom<MLModelType>("GBM");
    selectedDataSource = jotai.atom<DataSourceType>("CSV");
    hyperparams = jotai.atom<Hyperparams>({ ...DEFAULT_HYPERPARAMS });
    isTraining = jotai.atom<boolean>(false);
    trainingProgress = jotai.atom<number>(0);
    trainLog = jotai.atom<string[]>([]);
    exportHistory = jotai.atom<ExportRecord[]>([...MOCK_EXPORT_HISTORY]);
    targetColumn = jotai.atom<string>("label");
    featureColumns = jotai.atom<string>("feature1, feature2, feature3, feature4");
    trainTestSplit = jotai.atom<number>(80);
    dataSourceTab = jotai.atom<DataSourceType>("CSV");
    dataSource = jotai.atom<"live" | "demo">("demo");
    dataPreview = jotai.atom<string>("");
    selectedDataPath = jotai.atom<string>("");
    exportDir = jotai.atom<string>("/exports/wave-ml-models");

    viewText: jotai.Atom<HeaderElem[]>;

    private trainingInterval: ReturnType<typeof setInterval> | null = null;
    private trainingLogIdx = 0;
    private trainingModelType: MLModelType = "GBM";

    constructor({ blockId }: ViewModelInitType) {
        this.blockId = blockId;
        this.viewText = jotai.atom((get) => {
            const models = get(this.models);
            const selId = get(this.selectedModelId);
            const selModel = models.find((m) => m.id === selId);
            const elems: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: `${models.length} model${models.length !== 1 ? "s" : ""}`,
                    noGrow: true,
                },
            ];
            if (selModel) {
                elems.push({
                    elemtype: "text",
                    text: selModel.name,
                    className: "mlmodel-selected-name",
                    noGrow: true,
                });
            }
            return elems;
        });
    }

    get viewComponent(): ViewComponent {
        return MLModelWidget as ViewComponent;
    }

    validateHyperparams(): string[] {
        const hp = globalStore.get(this.hyperparams);
        const modelType = globalStore.get(this.selectedModelType);
        const errors: string[] = [];
        if (modelType === "GBM") {
            if (hp.gbm_n_estimators < 10) errors.push("n_estimators must be ≥ 10");
            if (hp.gbm_learning_rate <= 0 || hp.gbm_learning_rate > 1) errors.push("learning_rate must be in (0, 1]");
            if (hp.gbm_max_depth < 1 || hp.gbm_max_depth > 20) errors.push("max_depth must be between 1 and 20");
            if (hp.gbm_subsample <= 0 || hp.gbm_subsample > 1) errors.push("subsample must be in (0, 1]");
        } else if (modelType === "LR") {
            if (hp.lr_C <= 0) errors.push("C (regularization) must be > 0");
            if (hp.lr_max_iter < 100) errors.push("max_iter must be ≥ 100");
        } else if (modelType === "NN-Adam") {
            if (hp.nn_learning_rate <= 0) errors.push("learning_rate must be > 0");
            if (hp.nn_epochs < 1) errors.push("epochs must be ≥ 1");
            if (hp.nn_hidden_layers < 1 || hp.nn_hidden_layers > 10) errors.push("hidden_layers must be between 1 and 10");
            if (hp.nn_hidden_size < 8) errors.push("hidden_size must be ≥ 8");
            if (hp.nn_dropout < 0 || hp.nn_dropout >= 1) errors.push("dropout must be in [0, 1)");
        } else if (modelType === "RF") {
            if (hp.rf_n_estimators < 10) errors.push("n_estimators must be ≥ 10");
            if (hp.rf_max_depth < 1) errors.push("max_depth must be ≥ 1");
        } else if (modelType === "NumpyLogistics") {
            if (hp.np_learning_rate <= 0) errors.push("learning_rate must be > 0");
            if (hp.np_iterations < 100) errors.push("iterations must be ≥ 100");
            if (hp.np_regularization < 0) errors.push("regularization must be ≥ 0");
        }
        return errors;
    }

    loadDataFile() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".csv,.json,.xml";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                globalStore.set(this.selectedDataPath, file.name);
                globalStore.set(this.dataSource, "live");
                this.parseDataSource(text, file.name);
            } catch (err) {
                globalStore.set(this.dataPreview, `Error reading file: ${(err as Error).message}`);
            }
        };
        input.click();
    }

    parseDataSource(content: string, filename: string) {
        const ext = filename.split(".").pop()?.toLowerCase() ?? "";
        try {
            if (ext === "json") {
                const parsed = JSON.parse(content);
                const preview = JSON.stringify(parsed, null, 2).slice(0, 2000);
                globalStore.set(this.dataPreview, preview);
                // Try to infer columns from first object
                if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
                    const cols = Object.keys(parsed[0]);
                    globalStore.set(this.featureColumns, cols.slice(0, -1).join(", "));
                    globalStore.set(this.targetColumn, cols[cols.length - 1]);
                }
            } else if (ext === "csv") {
                const lines = content.split("\n").filter(Boolean);
                const preview = lines.slice(0, 20).join("\n");
                globalStore.set(this.dataPreview, preview);
                if (lines.length > 0) {
                    const cols = lines[0].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
                    globalStore.set(this.featureColumns, cols.slice(0, -1).join(", "));
                    globalStore.set(this.targetColumn, cols[cols.length - 1]);
                }
            } else {
                globalStore.set(this.dataPreview, content.slice(0, 2000));
            }
        } catch (err) {
            globalStore.set(this.dataPreview, `Parse error: ${(err as Error).message}\n\n${content.slice(0, 500)}`);
        }
    }

    startTraining() {
        const already = globalStore.get(this.isTraining);
        if (already) return;

        const validationErrors = this.validateHyperparams();
        if (validationErrors.length > 0) {
            globalStore.set(this.trainLog, [
                "[ERROR] Hyperparameter validation failed:",
                ...validationErrors.map((e) => `  • ${e}`),
            ]);
            return;
        }

        const modelType = globalStore.get(this.selectedModelType);
        this.trainingModelType = modelType;
        this.trainingLogIdx = 0;

        globalStore.set(this.isTraining, true);
        globalStore.set(this.trainingProgress, 0);
        globalStore.set(this.trainLog, ["[INFO] Starting training pipeline..."]);

        const logLines = TRAIN_LOG_SNIPPETS[modelType];
        const totalSteps = 100;

        // Different epoch counts / step speeds per model type
        const stepMsMap: Record<MLModelType, number> = {
            GBM: 120,
            LR: 60,
            "NN-Adam": 150,
            TreeClassifier: 50,
            RF: 100,
            NumpyLogistics: 80,
        };
        const stepMs = stepMsMap[modelType] ?? 120;

        this.trainingInterval = setInterval(() => {
            const current = globalStore.get(this.trainingProgress);
            const next = Math.min(current + 1, totalSteps);
            globalStore.set(this.trainingProgress, next);

            // Feed log lines proportionally
            const logTarget = Math.floor((next / totalSteps) * logLines.length);
            if (this.trainingLogIdx < logTarget) {
                const prevLog = globalStore.get(this.trainLog);
                const newLines = logLines.slice(this.trainingLogIdx, logTarget);
                globalStore.set(this.trainLog, [...prevLog, ...newLines]);
                this.trainingLogIdx = logTarget;
            }

            if (next >= totalSteps) {
                clearInterval(this.trainingInterval!);
                this.trainingInterval = null;
                globalStore.set(this.isTraining, false);

                // Add new model to list
                const existing = globalStore.get(this.models);
                const newModel: MLModel = {
                    id: `m${Date.now()}`,
                    name: `${modelType}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
                    type: modelType,
                    accuracy: 75 + Math.random() * 20,
                    f1: 0.74 + Math.random() * 0.2,
                    trainedDate: new Date().toISOString().slice(0, 10),
                    status: "trained",
                };
                globalStore.set(this.models, [...existing, newModel]);
                globalStore.set(this.selectedModelId, newModel.id);

                const prevLog = globalStore.get(this.trainLog);
                globalStore.set(this.trainLog, [...prevLog, "[DONE] Training complete."]);
            }
        }, stepMs);
    }

    exportModel(format: "ONNX" | "Joblib") {
        const models = globalStore.get(this.models);
        const selId = globalStore.get(this.selectedModelId);
        const model = models.find((m) => m.id === selId);
        if (!model) return;

        const ext = format === "ONNX" ? "onnx" : "joblib";
        const size = `${(0.4 + Math.random() * 3).toFixed(1)} MB`;
        const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
        const exportDir = globalStore.get(this.exportDir);
        const path = `${exportDir}/${model.name}.${ext}`;
        const record: ExportRecord = {
            timestamp: ts,
            format,
            size,
            path,
        };
        const prev = globalStore.get(this.exportHistory);
        globalStore.set(this.exportHistory, [record, ...prev].slice(0, 10));
    }

    retrain(modelId: string) {
        const models = globalStore.get(this.models);
        const updated = models.map((m) =>
            m.id === modelId ? { ...m, status: "training" as MLModelStatus } : m
        );
        globalStore.set(this.models, updated);
        globalStore.set(this.selectedModelId, modelId);
        globalStore.set(this.activeTab, "train");

        // Set model type to match the existing model
        const target = models.find((m) => m.id === modelId);
        if (target) globalStore.set(this.selectedModelType, target.type);

        setTimeout(() => this.startTraining(), 300);
    }

    deleteModel(modelId: string) {
        const models = globalStore.get(this.models);
        const updated = models.filter((m) => m.id !== modelId);
        globalStore.set(this.models, updated);
        const selId = globalStore.get(this.selectedModelId);
        if (selId === modelId) {
            globalStore.set(this.selectedModelId, updated.length > 0 ? updated[0].id : null);
        }
    }

    dispose() {
        if (this.trainingInterval != null) {
            clearInterval(this.trainingInterval);
            this.trainingInterval = null;
        }
    }

    giveFocus(): boolean {
        return true;
    }
}
