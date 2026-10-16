// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { memo, useEffect, useState } from "react";
import { localApi } from "./localapi";

type Account = { id: string; email: string; signedIn: boolean; planUsage: boolean };
type Status = { accounts: Account[]; active: string; pending: boolean; message?: string };
type Model = { id: string; model: string; displayName: string };
const inputClass = "border border-border rounded p-2 bg-background text-foreground";
const buttonClass = "border border-border rounded px-3 py-2 hover:bg-secondary/30 disabled:opacity-50";

async function saveMode(model: WaveConfigViewModel, key: string, mode: AIModeConfigType) {
    const content = JSON.parse(globalStore.get(model.fileContentAtom) || "{}");
    if (content[key] && content[key]["ai:provider"] !== mode["ai:provider"]) {
        throw new Error(`Mode ${key} already belongs to another provider; choose a different mode ID.`);
    }
    globalStore.set(
        model.fileContentAtom,
        JSON.stringify({ ...content, [key]: { ...content[key], ...mode } }, null, 4)
    );
    model.markAsEdited();
    await model.saveFile();
    const error = globalStore.get(model.errorMessageAtom) || globalStore.get(model.validationErrorAtom);
    if (error) throw new Error(error);
    await RpcApi.SetConfigCommand(TabRpcClient, { "waveai:defaultmode": key });
}

export const WaveAIVisualContent = memo(({ model }: { model: WaveConfigViewModel }) => {
    const [status, setStatus] = useState<Status>();
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [models, setModels] = useState<Model[]>([]);
    const [selectedModel, setSelectedModel] = useState("");
    const [provider, setProvider] = useState("openai");
    const [modeID, setModeID] = useState("my-openai");
    const [apiModel, setApiModel] = useState("gpt-5.4");
    const [secretName, setSecretName] = useState("OPENAI_KEY");
    const [key, setKey] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        const refresh = () =>
            localApi<Status>("chatgpt", undefined, controller.signal)
                .then(setStatus)
                .catch((e) => {
                    if (!controller.signal.aborted) setError(e.message);
                });
        void refresh();
        const timer = setInterval(refresh, 2500);
        return () => {
            clearInterval(timer);
            controller.abort();
        };
    }, []);
    const action = async (fn: () => Promise<void>) => {
        setBusy(true);
        setError("");
        setNotice("");
        try {
            await fn();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };
    const auth = (operation: string, account = "") =>
        action(async () => {
            await localApi("chatgpt", { action: operation, account });
            setStatus(await localApi<Status>("chatgpt"));
            setModels([]);
            setSelectedModel("");
        });
    const active = status?.accounts.find((a) => a.id === status.active);
    return (
        <div className="flex flex-col gap-6 p-6 overflow-y-auto h-full">
            <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">ChatGPT / Codex (Subscription)</h2>
                <p>
                    Use eligible ChatGPT plan usage directly in Wave AI. No API key is required. API billing is never
                    enabled automatically.
                </p>
                <p role="status">{status?.message || "Connect your ChatGPT account to get started."}</p>
                <div className="flex gap-2 flex-wrap">
                    <button className={buttonClass} disabled={busy || status?.pending} onClick={() => auth("signin")}>
                        Continue with ChatGPT
                    </button>
                    {status?.pending && (
                        <button className={buttonClass} disabled={busy} onClick={() => auth("cancel")}>
                            Cancel sign-in
                        </button>
                    )}
                    <a
                        className={buttonClass}
                        href="https://chatgpt.com/#settings/Usage"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        ChatGPT usage management
                    </a>
                </div>
                {status?.accounts.map((account) => (
                    <div
                        key={account.id}
                        className="border border-border rounded p-3 flex flex-wrap gap-2 items-center"
                    >
                        <span>
                            {account.email || "ChatGPT account"} · {account.id.slice(0, 8)}{" "}
                            {account.id === status.active ? "(active)" : ""}
                        </span>
                        <span>
                            {account.signedIn
                                ? account.planUsage
                                    ? "Plan usage authorized"
                                    : "Plan usage permission missing"
                                : "Signed out"}
                        </span>
                        {account.signedIn && account.id !== status.active && (
                            <button disabled={busy} className={buttonClass} onClick={() => auth("select", account.id)}>
                                Use account
                            </button>
                        )}
                        <button
                            disabled={busy || status.pending}
                            className={buttonClass}
                            onClick={() => auth("signin", account.id)}
                        >
                            Reconnect
                        </button>
                        {account.signedIn && (
                            <button disabled={busy} className={buttonClass} onClick={() => auth("signout", account.id)}>
                                Sign out
                            </button>
                        )}
                    </div>
                ))}
                <div className="flex flex-wrap gap-2">
                    <button
                        disabled={busy || !active?.planUsage || !active?.signedIn}
                        className={buttonClass}
                        onClick={() =>
                            action(async () => {
                                const catalog = await localApi<Model[]>("chatgpt?models=true");
                                setModels(catalog);
                                setSelectedModel(catalog[0]?.model || "");
                            })
                        }
                    >
                        Load models
                    </button>
                    <select
                        aria-label="ChatGPT model"
                        className={inputClass}
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                    >
                        <option value="">Choose a model</option>
                        {models.map((m) => (
                            <option key={m.id} value={m.model}>
                                {m.displayName || m.model}
                            </option>
                        ))}
                    </select>
                    <button
                        disabled={busy || !selectedModel || !active?.planUsage}
                        className={buttonClass}
                        onClick={() =>
                            action(async () => {
                                await saveMode(model, "codex-subscription", {
                                    "display:name": "ChatGPT / Codex (Subscription)",
                                    "ai:provider": "chatgpt-plan",
                                    "ai:apitype": "codex-app-server",
                                    "ai:model": selectedModel,
                                });
                                setNotice(
                                    "Subscription mode selected. Start a new chat in Wave AI when changing providers or accounts."
                                );
                            })
                        }
                    >
                        Use in Wave AI
                    </button>
                </div>
                <p className="text-secondary text-sm">
                    The catalog lists models; a completed response verifies access. Requires the official Codex CLI and
                    an unlocked OS keyring. Text, images, and approved Wave widget tools are supported.
                </p>
            </section>
            <section className="flex flex-col gap-3 border-t border-border pt-4">
                <h2 className="text-lg font-semibold">Bring your own API key</h2>
                <p>
                    API-key modes use your provider’s API billing, separately from a ChatGPT subscription. Keys are
                    saved in Wave’s encrypted Secrets store.
                </p>
                <label>
                    Provider{" "}
                    <select
                        className={inputClass}
                        value={provider}
                        onChange={(e) => {
                            const value = e.target.value;
                            setProvider(value);
                            setModeID(`my-${value}`);
                            setSecretName(
                                {
                                    openai: "OPENAI_KEY",
                                    google: "GOOGLE_AI_KEY",
                                    openrouter: "OPENROUTER_KEY",
                                    groq: "GROQ_KEY",
                                }[value]
                            );
                            setApiModel(
                                {
                                    openai: "gpt-5.4",
                                    google: "gemini-2.5-flash",
                                    openrouter: "openai/gpt-5.4",
                                    groq: "llama-3.3-70b-versatile",
                                }[value]
                            );
                        }}
                    >
                        <option value="openai">OpenAI API</option>
                        <option value="google">Google Gemini</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="groq">Groq</option>
                    </select>
                </label>
                <label>
                    Mode ID <input className={inputClass} value={modeID} onChange={(e) => setModeID(e.target.value)} />
                </label>
                <label>
                    Model{" "}
                    <input className={inputClass} value={apiModel} onChange={(e) => setApiModel(e.target.value)} />
                </label>
                <label>
                    Secret name{" "}
                    <input className={inputClass} value={secretName} onChange={(e) => setSecretName(e.target.value)} />
                </label>
                <label>
                    API key (leave blank to reuse the saved secret){" "}
                    <input
                        autoComplete="off"
                        type="password"
                        className={inputClass}
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                    />
                </label>
                <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() =>
                        action(async () => {
                            if (
                                !/^[a-zA-Z0-9_-]+$/.test(modeID) ||
                                !apiModel.trim() ||
                                !/^[A-Za-z][A-Za-z0-9_]*$/.test(secretName)
                            )
                                throw new Error("Enter a mode ID, model, and valid secret name.");
                            if (key) {
                                await model.env.rpc.SetSecretsCommand(TabRpcClient, { [secretName]: key });
                                setKey("");
                            }
                            await saveMode(model, modeID, {
                                "display:name": apiModel,
                                "ai:provider": provider,
                                "ai:model": apiModel.trim(),
                                "ai:apitokensecretname": secretName,
                            });
                            setNotice("API-key mode saved and selected for Wave AI.");
                        })
                    }
                >
                    Save API-key mode
                </button>
                <p className="text-secondary text-sm">
                    Use the JSON tab for Ollama, Azure, and other compatible providers. Existing modes and keys are
                    preserved.
                </p>
            </section>
            {error && (
                <p role="alert" className="text-red-400">
                    {error}
                </p>
            )}
            {notice && <p role="status">{notice}</p>}
        </div>
    );
});
WaveAIVisualContent.displayName = "WaveAIVisualContent";
