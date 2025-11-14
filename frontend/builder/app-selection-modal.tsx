// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FlexiModal } from "@/app/modals/modal";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, globalStore } from "@/store/global";
import * as WOS from "@/store/wos";
import { formatRelativeTime } from "@/util/util";
import { useEffect, useState } from "react";

const MaxAppNameLength = 50;
const AppNameRegex = /^[a-zA-Z0-9_-]+$/;

function CreateNewWaveApp({ onCreateApp }: { onCreateApp: (appName: string) => Promise<void> }) {
    const [newAppName, setNewAppName] = useState("");
    const [inputError, setInputError] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    const validateAppName = (name: string) => {
        if (!name.trim()) {
            setInputError("");
            return false;
        }
        if (name.length > MaxAppNameLength) {
            setInputError(`Name must be ${MaxAppNameLength} characters or less`);
            return false;
        }
        if (!AppNameRegex.test(name)) {
            setInputError("Only letters, numbers, hyphens, and underscores allowed");
            return false;
        }
        setInputError("");
        return true;
    };

    const handleCreate = async () => {
        const trimmedName = newAppName.trim();
        if (!validateAppName(trimmedName)) {
            return;
        }

        setIsCreating(true);
        try {
            await onCreateApp(trimmedName);
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="min-h-[80px]">
            <h3 className="text-base font-medium mb-1 text-muted-foreground">Create New WaveApp</h3>
            <div className="relative">
                <div className="flex w-full">
                    <input
                        type="text"
                        value={newAppName}
                        onChange={(e) => {
                            const value = e.target.value;
                            setNewAppName(value);
                            validateAppName(value);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.nativeEvent.isComposing && newAppName.trim() && !inputError) {
                                handleCreate();
                            }
                        }}
                        placeholder="my-app"
                        maxLength={MaxAppNameLength}
                        className={`flex-1 px-3 py-2 bg-panel border rounded-l focus:outline-none transition-colors ${
                            inputError ? "border-error" : "border-border focus:border-accent"
                        }`}
                        autoFocus
                        disabled={isCreating}
                    />
                    <button
                        onClick={handleCreate}
                        disabled={!newAppName.trim() || !!inputError || isCreating}
                        className={`px-4 py-2 rounded-r transition-colors font-medium whitespace-nowrap ${
                            !newAppName.trim() || inputError || isCreating
                                ? "bg-panel border border-l-0 border-border text-muted cursor-not-allowed"
                                : "bg-accent text-black hover:bg-accent-hover cursor-pointer"
                        }`}
                    >
                        Create
                    </button>
                </div>
                {inputError && (
                    <div className="absolute left-0 top-full mt-1 text-xs text-error flex items-center gap-1.5 whitespace-nowrap">
                        <i className="fa-solid fa-circle-exclamation"></i>
                        <span>{inputError}</span>
                    </div>
                )}
            </div>
        </div>
    );
}

export function AppSelectionModal() {
    const [apps, setApps] = useState<AppInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        loadApps();
    }, []);

    const loadApps = async () => {
        try {
            const appList = await RpcApi.ListAllEditableAppsCommand(TabRpcClient);
            const sortedApps = (appList || []).sort((a, b) => b.modtime - a.modtime);
            setApps(sortedApps);
        } catch (err) {
            console.error("Failed to load apps:", err);
            setError("Failed to load apps");
        } finally {
            setLoading(false);
        }
    };

    const handleSelectApp = async (appId: string) => {
        let appIdToUse = appId;

        // If selecting a local app, convert it to a draft first
        if (appId.startsWith("local/")) {
            try {
                const result = await RpcApi.MakeDraftFromLocalCommand(TabRpcClient, { localappid: appId });
                appIdToUse = result.draftappid;
            } catch (err) {
                console.error("Failed to create draft from local app:", err);
                setError(`Failed to create draft from ${appId}: ${err.message || String(err)}`);
                return;
            }
        }

        const builderId = globalStore.get(atoms.builderId);
        const oref = WOS.makeORef("builder", builderId);
        await RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref,
            data: { "builder:appid": appIdToUse },
        });
        globalStore.set(atoms.builderAppId, appIdToUse);
        document.title = `WaveApp Builder (${appIdToUse})`;
    };

    const handleCreateNew = async (appName: string) => {
        const draftAppId = `draft/${appName}`;
        const builderId = globalStore.get(atoms.builderId);
        const oref = WOS.makeORef("builder", builderId);
        await RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref,
            data: { "builder:appid": draftAppId },
        });
        globalStore.set(atoms.builderAppId, draftAppId);
        document.title = `WaveApp Builder (${draftAppId})`;
    };

    const isDraftApp = (appId: string) => {
        return appId.startsWith("draft/");
    };

    const getAppDisplayName = (appId: string) => {
        const parts = appId.split("/");
        if (parts.length === 2) {
            const isDraft = parts[0] === "draft";
            return isDraft ? `${parts[1]} (draft)` : parts[1];
        }
        return appId;
    };

    if (loading) {
        return (
            <FlexiModal className="min-w-[600px] w-[600px]">
                <div className="text-center py-8">Loading apps...</div>
            </FlexiModal>
        );
    }

    return (
        <FlexiModal className="min-w-[600px] w-[600px] max-h-[90vh] overflow-y-auto">
            <div className="w-full px-2 pt-0 pb-4">
                <h2 className="text-2xl mb-2">Select a WaveApp to Edit</h2>

                {error && (
                    <div className="mb-6 px-4 py-3 bg-panel rounded">
                        <div className="flex items-center gap-3">
                            <i className="fa-solid fa-circle-exclamation text-warning"></i>
                            <span>{error}</span>
                        </div>
                    </div>
                )}

                {apps.length > 0 && (
                    <div className="mb-2">
                        <h3 className="text-base font-medium mb-1 text-muted-foreground">Existing WaveApps</h3>
                        <div className="space-y-2 max-h-[220px] overflow-y-auto">
                            {apps.map((appInfo) => (
                                <button
                                    key={appInfo.appid}
                                    onClick={() => handleSelectApp(appInfo.appid)}
                                    className="w-full text-left px-4 py-1.5 bg-panel hover:bg-hover border border-border rounded transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center gap-3">
                                        <i className="fa-solid fa-cube self-center"></i>
                                        <div className="flex flex-col">
                                            <span>{getAppDisplayName(appInfo.appid)}</span>
                                            <span className="text-[11px] text-muted mt-0.5">
                                                Last updated: {formatRelativeTime(appInfo.modtime)}
                                            </span>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {apps.length > 0 && (
                    <div className="flex items-center gap-4 my-2">
                        <div className="flex-1 border-t border-border"></div>
                        <span className="text-muted-foreground text-sm">or</span>
                        <div className="flex-1 border-t border-border"></div>
                    </div>
                )}

                <CreateNewWaveApp onCreateApp={handleCreateNew} />
            </div>
        </FlexiModal>
    );
}
