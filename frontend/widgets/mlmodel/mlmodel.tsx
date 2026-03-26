// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtom, useAtomValue } from "jotai";
import * as React from "react";
import type { DataSourceType, Hyperparams, MLModel, MLModelType } from "./mlmodel-model";
import "./mlmodel.scss";

// ─── helpers ────────────────────────────────────────────────────────────────

function statusBadge(status: MLModel["status"]) {
    const cls = `ml-status-badge ml-status-${status}`;
    const labels: Record<MLModel["status"], string> = { trained: "Trained", training: "Training…", failed: "Failed" };
    return <span className={cls}>{labels[status]}</span>;
}

// ─── Loss Curve Canvas ───────────────────────────────────────────────────────

function LossCurveCanvas() {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const epochs = 50;
        const trainLoss: number[] = [];
        const valLoss: number[] = [];
        for (let i = 0; i < epochs; i++) {
            const t = i / (epochs - 1);
            // Deterministic small noise using sine at a high frequency (no Math.random)
            const noise1 = 0.005 * Math.sin(i * 2.371 + 0.7);
            const noise2 = 0.007 * Math.sin(i * 3.149 + 1.3);
            trainLoss.push(0.72 * Math.exp(-2.8 * t) + 0.04 + noise1);
            valLoss.push(0.75 * Math.exp(-2.5 * t) + 0.07 + noise2);
        }

        const allVals = [...trainLoss, ...valLoss];
        const minV = Math.min(...allVals);
        const maxV = Math.max(...allVals);
        const range = maxV - minV || 0.1;
        const pad = { t: 8, b: 16, l: 8, r: 8 };
        const plotW = w - pad.l - pad.r;
        const plotH = h - pad.t - pad.b;

        const toX = (i: number) => pad.l + (i / (epochs - 1)) * plotW;
        const toY = (v: number) => pad.t + plotH - ((v - minV) / range) * plotH;

        function drawLine(data: number[], color: string, dash: number[]) {
            ctx!.beginPath();
            ctx!.strokeStyle = color;
            ctx!.lineWidth = 1.5;
            ctx!.setLineDash(dash);
            data.forEach((v, i) => {
                if (i === 0) ctx!.moveTo(toX(i), toY(v));
                else ctx!.lineTo(toX(i), toY(v));
            });
            ctx!.stroke();
            ctx!.setLineDash([]);
        }

        // grid lines
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        for (let g = 0; g <= 4; g++) {
            const y = pad.t + (g / 4) * plotH;
            ctx.beginPath();
            ctx.moveTo(pad.l, y);
            ctx.lineTo(w - pad.r, y);
            ctx.stroke();
        }

        drawLine(trainLoss, "#a855f7", []);
        drawLine(valLoss, "#64748b", [4, 3]);

        // x-axis labels
        ctx.fillStyle = "rgba(148,163,184,0.5)";
        ctx.font = "9px sans-serif";
        ctx.fillText("0", pad.l, h - 2);
        ctx.fillText(`${epochs}`, w - pad.r - 10, h - 2);
        ctx.fillText("epoch", w / 2 - 12, h - 2);
    }, []);

    return <canvas ref={canvasRef} className="ml-loss-canvas" width={340} height={100} />;
}

// ─── Feature Importance Bars ─────────────────────────────────────────────────

const FEATURE_IMPORTANCE = [
    { name: "rsi_14", value: 0.22 },
    { name: "macd_signal", value: 0.18 },
    { name: "volume_ratio", value: 0.15 },
    { name: "bollinger_pct", value: 0.13 },
    { name: "ema_cross", value: 0.11 },
    { name: "obv_slope", value: 0.09 },
    { name: "atr_14", value: 0.07 },
    { name: "close_lag1", value: 0.05 },
];

function FeatureImportance() {
    return (
        <div className="ml-feat-importance">
            {FEATURE_IMPORTANCE.map((f) => (
                <div key={f.name} className="ml-feat-row">
                    <span className="ml-feat-name">{f.name}</span>
                    <div className="ml-feat-bar-bg">
                        <div
                            className="ml-feat-bar-fill"
                            style={{ width: `${f.value * 100 / 0.22}%` }}
                        />
                    </div>
                    <span className="ml-feat-val">{(f.value * 100).toFixed(1)}%</span>
                </div>
            ))}
        </div>
    );
}

// ─── Confusion Matrix ────────────────────────────────────────────────────────

const CONFUSION_MATRIX = [
    [142, 18],
    [23, 137],
];
const CM_LABELS = ["Neg", "Pos"];

function ConfusionMatrix() {
    const max = Math.max(...CONFUSION_MATRIX.flat());
    return (
        <div className="ml-cm-wrap">
            <div className="ml-cm-grid">
                <div className="ml-cm-corner" />
                {CM_LABELS.map((l) => (
                    <div key={l} className="ml-cm-head">{l}</div>
                ))}
                {CONFUSION_MATRIX.map((row, ri) => (
                    <React.Fragment key={ri}>
                        <div className="ml-cm-head">{CM_LABELS[ri]}</div>
                        {row.map((val, ci) => (
                            <div
                                key={ci}
                                className={`ml-cm-cell ${ri === ci ? "ml-cm-diag" : ""}`}
                                style={{ opacity: 0.3 + 0.7 * (val / max) }}
                            >
                                {val}
                            </div>
                        ))}
                    </React.Fragment>
                ))}
            </div>
            <div className="ml-cm-legend">
                <span className="ml-cm-legend-item diag">■ Correct</span>
                <span className="ml-cm-legend-item off">■ Error</span>
            </div>
        </div>
    );
}

// ─── Hyperparameter Controls ─────────────────────────────────────────────────

function HyperparamControls({
    modelType,
    hyperparams,
    setHyperparams,
}: {
    modelType: MLModelType;
    hyperparams: Hyperparams;
    setHyperparams: (h: Hyperparams) => void;
}) {
    function set<K extends keyof Hyperparams>(key: K, value: Hyperparams[K]) {
        setHyperparams({ ...hyperparams, [key]: value });
    }

    function numSlider(label: string, key: keyof Hyperparams, min: number, max: number, step: number) {
        const val = hyperparams[key] as number;
        return (
            <div className="ml-hyperparam-row" key={key}>
                <label className="ml-hyperparam-label">
                    {label}
                    <span className="ml-hyperparam-val">{val}</span>
                </label>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    className="ml-slider"
                    onChange={(e) => set(key, parseFloat(e.target.value) as Hyperparams[typeof key])}
                />
            </div>
        );
    }

    function selectField<K extends keyof Hyperparams>(
        label: string,
        key: K,
        options: string[]
    ) {
        return (
            <div className="ml-hyperparam-row" key={key}>
                <label className="ml-hyperparam-label">{label}</label>
                <select
                    className="ml-select"
                    value={hyperparams[key] as string}
                    onChange={(e) => set(key, e.target.value as Hyperparams[K])}
                >
                    {options.map((o) => (
                        <option key={o} value={o}>
                            {o}
                        </option>
                    ))}
                </select>
            </div>
        );
    }

    switch (modelType) {
        case "GBM":
            return (
                <div className="ml-hyperparams">
                    {numSlider("n_estimators", "gbm_n_estimators", 50, 500, 10)}
                    {numSlider("learning_rate", "gbm_learning_rate", 0.01, 0.5, 0.01)}
                    {numSlider("max_depth", "gbm_max_depth", 2, 10, 1)}
                    {numSlider("subsample", "gbm_subsample", 0.5, 1.0, 0.05)}
                </div>
            );
        case "LR":
            return (
                <div className="ml-hyperparams">
                    {numSlider("C (regularization)", "lr_C", 0.001, 100, 0.001)}
                    {numSlider("max_iter", "lr_max_iter", 100, 2000, 100)}
                    {selectField("solver", "lr_solver", ["lbfgs", "saga", "liblinear"])}
                </div>
            );
        case "NN-Adam":
            return (
                <div className="ml-hyperparams">
                    {numSlider("hidden_layers", "nn_hidden_layers", 1, 5, 1)}
                    {numSlider("hidden_size", "nn_hidden_size", 16, 512, 16)}
                    {numSlider("learning_rate", "nn_learning_rate", 0.0001, 0.01, 0.0001)}
                    {numSlider("epochs", "nn_epochs", 10, 500, 10)}
                    {numSlider("dropout", "nn_dropout", 0, 0.5, 0.05)}
                </div>
            );
        case "TreeClassifier":
            return (
                <div className="ml-hyperparams">
                    {numSlider("max_depth", "tree_max_depth", 1, 20, 1)}
                    {numSlider("min_samples_split", "tree_min_samples_split", 2, 20, 1)}
                    {selectField("criterion", "tree_criterion", ["gini", "entropy"])}
                </div>
            );
        case "RF":
            return (
                <div className="ml-hyperparams">
                    {numSlider("n_estimators", "rf_n_estimators", 10, 500, 10)}
                    {numSlider("max_depth", "rf_max_depth", 1, 20, 1)}
                    {selectField("max_features", "rf_max_features", ["sqrt", "log2", "auto"])}
                </div>
            );
        case "NumpyLogistics":
            return (
                <div className="ml-hyperparams">
                    {numSlider("learning_rate", "np_learning_rate", 0.001, 1.0, 0.001)}
                    {numSlider("iterations", "np_iterations", 100, 5000, 100)}
                    {numSlider("regularization", "np_regularization", 0.0, 1.0, 0.01)}
                </div>
            );
        default:
            return null;
    }
}

// ─── Tab: Models ─────────────────────────────────────────────────────────────

function ModelsTab({ model }: { model: import("./mlmodel-model").MLModelViewModel }) {
    const [models, setModels] = useAtom(model.models);
    const [selectedId, setSelectedId] = useAtom(model.selectedModelId);
    const [, setActiveTab] = useAtom(model.activeTab);
    const [, setModelType] = useAtom(model.selectedModelType);

    function handleNewModel() {
        setActiveTab("train");
    }

    function handleRetrain(m: MLModel) {
        model.retrain(m.id);
    }

    function handleDelete(id: string) {
        model.deleteModel(id);
    }

    function handleExportOnnx(m: MLModel) {
        setSelectedId(m.id);
        model.exportModel("ONNX");
        setActiveTab("export");
    }

    function handleExportJoblib(m: MLModel) {
        setSelectedId(m.id);
        model.exportModel("Joblib");
        setActiveTab("export");
    }

    return (
        <div className="ml-tab-content">
            <div className="ml-section">
                <div className="ml-section-header">
                    <span>Trained Models ({models.length})</span>
                    <button className="ml-btn ml-btn-primary" onClick={handleNewModel}>
                        + New Model
                    </button>
                </div>
                <div className="ml-models-table">
                    <div className="ml-table-header">
                        <span>Name</span>
                        <span>Type</span>
                        <span>Accuracy</span>
                        <span>F1</span>
                        <span>Trained</span>
                        <span>Status</span>
                        <span>Actions</span>
                    </div>
                    {models.map((m) => (
                        <div
                            key={m.id}
                            className={`ml-table-row ${selectedId === m.id ? "ml-row-selected" : ""}`}
                            onClick={() => setSelectedId(m.id)}
                        >
                            <span className="ml-model-name">{m.name}</span>
                            <span className="ml-type-badge">{m.type}</span>
                            <span className="ml-accuracy">{m.accuracy.toFixed(1)}%</span>
                            <span className="ml-f1">{m.f1.toFixed(3)}</span>
                            <span className="ml-date">{m.trainedDate}</span>
                            <span>{statusBadge(m.status)}</span>
                            <span className="ml-actions" onClick={(e) => e.stopPropagation()}>
                                <button
                                    className="ml-btn ml-btn-xs ml-btn-onnx"
                                    onClick={() => handleExportOnnx(m)}
                                    title="Export ONNX"
                                >
                                    ONNX
                                </button>
                                <button
                                    className="ml-btn ml-btn-xs ml-btn-joblib"
                                    onClick={() => handleExportJoblib(m)}
                                    title="Export Joblib"
                                >
                                    Joblib
                                </button>
                                <button
                                    className="ml-btn ml-btn-xs ml-btn-retrain"
                                    onClick={() => handleRetrain(m)}
                                    title="Retrain"
                                >
                                    ↺
                                </button>
                                <button
                                    className="ml-btn ml-btn-xs ml-btn-delete"
                                    onClick={() => handleDelete(m.id)}
                                    title="Delete"
                                >
                                    ✕
                                </button>
                            </span>
                        </div>
                    ))}
                    {models.length === 0 && (
                        <div className="ml-empty">No models yet. Click "New Model" to start training.</div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Tab: Train ───────────────────────────────────────────────────────────────

function TrainTab({ model }: { model: import("./mlmodel-model").MLModelViewModel }) {
    const [modelType, setModelType] = useAtom(model.selectedModelType);
    const [dataSource, setDataSource] = useAtom(model.selectedDataSource);
    const [targetCol, setTargetCol] = useAtom(model.targetColumn);
    const [featureCols, setFeatureCols] = useAtom(model.featureColumns);
    const [split, setSplit] = useAtom(model.trainTestSplit);
    const [hyperparams, setHyperparams] = useAtom(model.hyperparams);
    const isTraining = useAtomValue(model.isTraining);
    const progress = useAtomValue(model.trainingProgress);
    const log = useAtomValue(model.trainLog);

    const logRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [log]);

    const MODEL_TYPES: MLModelType[] = ["GBM", "LR", "NN-Adam", "TreeClassifier", "RF", "NumpyLogistics"];
    const DATA_SOURCES: DataSourceType[] = ["CSV", "JSON", "DB", "PDF", "Safetensor", "Dataset", "XML"];

    return (
        <div className="ml-tab-content">
            <div className="ml-train-grid">
                <div className="ml-section">
                    <div className="ml-section-header">Model Configuration</div>
                    <div className="ml-config-fields">
                        <div className="ml-field-row">
                            <label>Model Type</label>
                            <div className="ml-pill-row">
                                {MODEL_TYPES.map((t) => (
                                    <button
                                        key={t}
                                        className={`ml-pill ${modelType === t ? "ml-pill-active" : ""}`}
                                        onClick={() => setModelType(t)}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="ml-field-row">
                            <label>Data Source</label>
                            <div className="ml-pill-row">
                                {DATA_SOURCES.map((s) => (
                                    <button
                                        key={s}
                                        className={`ml-pill ${dataSource === s ? "ml-pill-active" : ""}`}
                                        onClick={() => setDataSource(s)}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="ml-field-row">
                            <label>Target Column</label>
                            <input
                                className="ml-input"
                                value={targetCol}
                                onChange={(e) => setTargetCol(e.target.value)}
                                placeholder="e.g. label"
                            />
                        </div>
                        <div className="ml-field-row">
                            <label>Feature Columns</label>
                            <input
                                className="ml-input"
                                value={featureCols}
                                onChange={(e) => setFeatureCols(e.target.value)}
                                placeholder="comma-separated"
                            />
                        </div>
                        <div className="ml-field-row">
                            <label>
                                Train/Test Split
                                <span className="ml-split-label">{split}% / {100 - split}%</span>
                            </label>
                            <input
                                type="range"
                                min={50}
                                max={95}
                                step={5}
                                value={split}
                                className="ml-slider"
                                onChange={(e) => setSplit(parseInt(e.target.value))}
                            />
                        </div>
                    </div>
                </div>

                <div className="ml-section">
                    <div className="ml-section-header">Hyperparameters — {modelType}</div>
                    <HyperparamControls
                        modelType={modelType}
                        hyperparams={hyperparams}
                        setHyperparams={setHyperparams}
                    />
                </div>
            </div>

            <div className="ml-section">
                <div className="ml-section-header">
                    <span>Training</span>
                    <button
                        className={`ml-btn ml-btn-primary ${isTraining ? "ml-btn-disabled" : ""}`}
                        onClick={() => model.startTraining()}
                        disabled={isTraining}
                    >
                        {isTraining ? "Training…" : "▶ Start Training"}
                    </button>
                </div>
                <div className={`ml-progress-wrap ${isTraining ? "ml-training-active" : ""}`}>
                    <div className="ml-progress-bar-bg">
                        <div
                            className={`ml-progress-bar-fill ${isTraining ? "ml-pulsing" : ""}`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <span className="ml-progress-pct">{progress}%</span>
                </div>
                {log.length > 0 && (
                    <div className="ml-train-log" ref={logRef}>
                        {log.map((line, i) => (
                            <div key={i} className={`ml-log-line ${line.startsWith("[OK]") ? "ml-log-ok" : line.startsWith("[DONE]") ? "ml-log-done" : ""}`}>
                                {line}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Tab: Evaluate ────────────────────────────────────────────────────────────

function EvaluateTab({ model }: { model: import("./mlmodel-model").MLModelViewModel }) {
    const models = useAtomValue(model.models);
    const [selectedId, setSelectedId] = useAtom(model.selectedModelId);

    const selected = models.find((m) => m.id === selectedId) ?? models[0];

    const metrics = selected
        ? [
              { label: "Accuracy", value: `${selected.accuracy.toFixed(1)}%` },
              { label: "F1 Score", value: selected.f1.toFixed(3) },
              { label: "Precision", value: (selected.f1 * 1.02).toFixed(3) },
              { label: "Recall", value: (selected.f1 * 0.98).toFixed(3) },
              { label: "AUC-ROC", value: (0.82 + (selected.accuracy - 79) * 0.003).toFixed(3) },
          ]
        : [];

    return (
        <div className="ml-tab-content">
            <div className="ml-eval-header">
                <label>Evaluate Model:</label>
                <select
                    className="ml-select ml-select-model"
                    value={selectedId ?? ""}
                    onChange={(e) => setSelectedId(e.target.value || null)}
                >
                    {models.map((m) => (
                        <option key={m.id} value={m.id}>
                            {m.name} ({m.type})
                        </option>
                    ))}
                </select>
            </div>

            <div className="ml-eval-grid">
                <div className="ml-section">
                    <div className="ml-section-header">Confusion Matrix</div>
                    <ConfusionMatrix />
                </div>
                <div className="ml-section">
                    <div className="ml-section-header">Metrics Summary</div>
                    <div className="ml-metrics-list">
                        {metrics.map((m) => (
                            <div key={m.label} className="ml-metric-row">
                                <span className="ml-metric-label">{m.label}</span>
                                <span className="ml-metric-val">{m.value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="ml-section">
                <div className="ml-section-header">Feature Importance (Top 8)</div>
                <FeatureImportance />
            </div>

            <div className="ml-section">
                <div className="ml-section-header">
                    Loss Curve
                    <span className="ml-chart-legend">
                        <span className="ml-legend-train">— train</span>
                        <span className="ml-legend-val">– – val</span>
                    </span>
                </div>
                <LossCurveCanvas />
            </div>
        </div>
    );
}

// ─── Tab: Data ────────────────────────────────────────────────────────────────

function DataTab({ model }: { model: import("./mlmodel-model").MLModelViewModel }) {
    const [dsTab, setDsTab] = useAtom(model.dataSourceTab);
    const [pasteVal, setPasteVal] = React.useState("");
    const [normalize, setNormalize] = React.useState(true);
    const [fillNull, setFillNull] = React.useState<"mean" | "median" | "zero">("mean");
    const [encodeCat, setEncodeCat] = React.useState(true);

    const DATA_SOURCES: DataSourceType[] = ["CSV", "JSON", "DB", "PDF", "Safetensor", "Dataset", "XML"];

    return (
        <div className="ml-tab-content">
            <div className="ml-ds-tabs">
                {DATA_SOURCES.map((s) => (
                    <button
                        key={s}
                        className={`ml-ds-tab ${dsTab === s ? "ml-ds-tab-active" : ""}`}
                        onClick={() => setDsTab(s)}
                    >
                        {s}
                    </button>
                ))}
            </div>

            <div className="ml-data-grid">
                <div className="ml-section">
                    <div className="ml-section-header">
                        Data Preview ({dsTab})
                        <button className="ml-btn ml-btn-xs ml-btn-secondary">⬆ Upload</button>
                    </div>
                    <div className="ml-preview-table">
                        <div className="ml-table-header ml-preview-header">
                            <span>feature1</span>
                            <span>feature2</span>
                            <span>feature3</span>
                            <span>feature4</span>
                            <span>label</span>
                        </div>
                        <div className="ml-table-row ml-empty-state">Upload or paste data to preview</div>
                    </div>
                    <textarea
                        className="ml-paste-area"
                        placeholder="Paste CSV / JSON data here…"
                        value={pasteVal}
                        onChange={(e) => setPasteVal(e.target.value)}
                        rows={3}
                    />
                </div>

                <div className="ml-section">
                    <div className="ml-section-header">Schema Inspector</div>
                    <div className="ml-schema-table">
                        <div className="ml-table-header">
                            <span>Column</span>
                            <span>Type</span>
                            <span>Nulls</span>
                            <span>Unique</span>
                        </div>
                        <div className="ml-table-row ml-empty-state">No schema loaded</div>
                    </div>

                    <div className="ml-section-header" style={{ marginTop: 10 }}>Preprocessing</div>
                    <div className="ml-preprocess-options">
                        <label className="ml-checkbox-row">
                            <input
                                type="checkbox"
                                checked={normalize}
                                onChange={(e) => setNormalize(e.target.checked)}
                            />
                            Normalize features
                        </label>
                        <label className="ml-checkbox-row">
                            <input
                                type="checkbox"
                                checked={encodeCat}
                                onChange={(e) => setEncodeCat(e.target.checked)}
                            />
                            Encode categoricals
                        </label>
                        <div className="ml-field-row">
                            <label>Fill nulls</label>
                            <select
                                className="ml-select"
                                value={fillNull}
                                onChange={(e) => setFillNull(e.target.value as typeof fillNull)}
                            >
                                <option value="mean">Mean</option>
                                <option value="median">Median</option>
                                <option value="zero">Zero</option>
                            </select>
                        </div>
                        <div className="ml-field-row">
                            <label>Drop columns</label>
                            <input className="ml-input" placeholder="col1, col2…" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Tab: Export ──────────────────────────────────────────────────────────────

function ExportTab({ model }: { model: import("./mlmodel-model").MLModelViewModel }) {
    const models = useAtomValue(model.models);
    const [selectedId, setSelectedId] = useAtom(model.selectedModelId);
    const exportHistory = useAtomValue(model.exportHistory);
    const [joblibCompression, setJoblibCompression] = React.useState(3);
    const [copied, setCopied] = React.useState(false);

    const selected = models.find((m) => m.id === selectedId) ?? models[0];

    function handleCopy() {
        const cmd = selected
            ? `wave ml export --model ${selected.name} --format onnx --opset 17`
            : "";
        navigator.clipboard?.writeText(cmd).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    return (
        <div className="ml-tab-content">
            <div className="ml-section">
                <div className="ml-section-header">
                    Export Model
                    <select
                        className="ml-select ml-select-model"
                        value={selectedId ?? ""}
                        onChange={(e) => setSelectedId(e.target.value || null)}
                    >
                        {models.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </div>

                {selected && (
                    <div className="ml-export-info">
                        <span className="ml-export-info-row">
                            <span className="ml-info-key">Model</span>
                            <span className="ml-info-val">{selected.name}</span>
                        </span>
                        <span className="ml-export-info-row">
                            <span className="ml-info-key">Type</span>
                            <span className="ml-info-val">{selected.type}</span>
                        </span>
                        <span className="ml-export-info-row">
                            <span className="ml-info-key">Accuracy</span>
                            <span className="ml-info-val">{selected.accuracy.toFixed(1)}%</span>
                        </span>
                    </div>
                )}

                <div className="ml-export-cards">
                    <div className="ml-export-card ml-export-onnx">
                        <div className="ml-export-card-title">ONNX Export</div>
                        <div className="ml-export-meta">
                            <span>Opset: 17</span>
                            <span>Input: [batch, 4] float32</span>
                            <span>Output: [batch, 2] float32</span>
                        </div>
                        <button
                            className="ml-btn ml-btn-primary ml-btn-export"
                            onClick={() => model.exportModel("ONNX")}
                        >
                            Export .onnx
                        </button>
                    </div>
                    <div className="ml-export-card ml-export-joblib">
                        <div className="ml-export-card-title">Joblib Export</div>
                        <div className="ml-export-meta">
                            <label>
                                Compression: {joblibCompression}
                                <input
                                    type="range"
                                    min={0}
                                    max={9}
                                    step={1}
                                    value={joblibCompression}
                                    className="ml-slider"
                                    onChange={(e) => setJoblibCompression(parseInt(e.target.value))}
                                />
                            </label>
                        </div>
                        <button
                            className="ml-btn ml-btn-secondary ml-btn-export"
                            onClick={() => model.exportModel("Joblib")}
                        >
                            Export .joblib
                        </button>
                    </div>
                </div>

                <div className="ml-cli-cmd">
                    <code className="ml-cmd-text">
                        {selected
                            ? `wave ml export --model ${selected.name} --format onnx --opset 17`
                            : "No model selected"}
                    </code>
                    <button className="ml-btn ml-btn-xs ml-btn-secondary ml-copy-btn" onClick={handleCopy}>
                        {copied ? "✓ Copied" : "Copy"}
                    </button>
                </div>
            </div>

            <div className="ml-section">
                <div className="ml-section-header">Export History (last {exportHistory.length})</div>
                <div className="ml-export-history">
                    <div className="ml-table-header ml-export-hist-header">
                        <span>Timestamp</span>
                        <span>Format</span>
                        <span>Size</span>
                        <span>Path</span>
                    </div>
                    {exportHistory.map((e, i) => (
                        <div key={i} className="ml-table-row ml-export-hist-row">
                            <span className="ml-hist-ts">{e.timestamp}</span>
                            <span className={`ml-hist-fmt ml-hist-fmt-${e.format.toLowerCase()}`}>{e.format}</span>
                            <span className="ml-hist-size">{e.size}</span>
                            <span className="ml-hist-path">{e.path}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ─── Root Component ───────────────────────────────────────────────────────────

export const MLModelWidget: React.FC<ViewComponentProps<import("./mlmodel-model").MLModelViewModel>> = ({ model }) => {
    const [activeTab, setActiveTab] = useAtom(model.activeTab);

    type TabId = "models" | "train" | "evaluate" | "data" | "export";
    const tabs: Array<{ id: TabId; label: string }> = [
        { id: "models", label: "Models" },
        { id: "train", label: "Train" },
        { id: "evaluate", label: "Evaluate" },
        { id: "data", label: "Data" },
        { id: "export", label: "Export" },
    ];

    return (
        <div className="mlmodel-widget">
            <div className="mlmodel-widget__header-bar">
                <div className="mlmodel-widget__title">
                    <span className="mlmodel-widget__icon">🧠</span>
                    <span>ML Model Training &amp; Evaluation</span>
                    <span className="mlmodel-widget__subtitle">scikit-learn · ONNX · Joblib</span>
                </div>
            </div>
            <div className="mlmodel-widget__tabs">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        className={`mlmodel-widget__tab ${activeTab === tab.id ? "mlmodel-widget__tab--active" : ""}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="mlmodel-widget__body">
                {activeTab === "models" && <ModelsTab model={model} />}
                {activeTab === "train" && <TrainTab model={model} />}
                {activeTab === "evaluate" && <EvaluateTab model={model} />}
                {activeTab === "data" && <DataTab model={model} />}
                {activeTab === "export" && <ExportTab model={model} />}
            </div>
        </div>
    );
};
