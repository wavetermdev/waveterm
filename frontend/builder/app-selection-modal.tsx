// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FlexiModal } from "@/app/modals/modal";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, globalStore } from "@/store/global";
import * as WOS from "@/store/wos";
import { useEffect, useState } from "react";

const MaxAppNameLength = 50;
const AppNameRegex = /^[a-zA-Z0-9_-]+$/;

export function AppSelectionModal() {
    const [apps, setApps] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [newAppName, setNewAppName] = useState("");
    const [error, setError] = useState("");
    const [inputError, setInputError] = useState("");

    useEffect(() => {
        loadApps();
    }, []);

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

    const loadApps = async () => {
        try {
            const appList = await RpcApi.ListAllEditableAppsCommand(TabRpcClient);
            setApps(appList || []);
        } catch (err) {
            console.error("Failed to load apps:", err);
            setError("Failed to load apps");
        } finally {
            setLoading(false);
        }
    };

    const handleSelectApp = async (appId: string) => {
        const builderId = globalStore.get(atoms.builderId);
        const oref = WOS.makeORef("builder", builderId);
        await RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref,
            data: { "builder:appid": appId },
        });
        globalStore.set(atoms.builderAppId, appId);
    };

    const handleCreateNew = async () => {
        const trimmedName = newAppName.trim();

        if (!trimmedName) {
            setError("WaveApp name cannot be empty");
            return;
        }

        if (trimmedName.length > MaxAppNameLength) {
            setError(`WaveApp name must be ${MaxAppNameLength} characters or less`);
            return;
        }

        if (!AppNameRegex.test(trimmedName)) {
            setError("WaveApp name can only contain letters, numbers, hyphens, and underscores");
            return;
        }

        const draftAppId = `draft/${trimmedName}`;
        const builderId = globalStore.get(atoms.builderId);
        const oref = WOS.makeORef("builder", builderId);
        await RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref,
            data: { "builder:appid": draftAppId },
        });
        globalStore.set(atoms.builderAppId, draftAppId);
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
        <FlexiModal className="min-w-[600px] w-[600px] max-h-[80vh] overflow-y-auto">
            <div className="w-full px-2 pt-0 pb-4">
                <h2 className="text-2xl mb-6">Select a WaveApp to Edit</h2>

                {error && (
                    <div className="mb-6 px-4 py-3 bg-panel rounded">
                        <div className="flex items-center gap-3">
                            <i className="fa-solid fa-circle-exclamation text-warning"></i>
                            <span>{error}</span>
                        </div>
                    </div>
                )}

                {apps.length > 0 && (
                    <div className="mb-6">
                        <h3 className="text-base font-medium mb-3 text-muted-foreground">Existing WaveApps</h3>
                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                            {apps.map((appId) => (
                                <button
                                    key={appId}
                                    onClick={() => handleSelectApp(appId)}
                                    className="w-full text-left px-4 py-3 bg-panel hover:bg-hover border border-border rounded transition-colors cursor-pointer"
                                >
                                    <div className="flex items-center gap-3">
                                        <i className="fa-solid fa-cube"></i>
                                        <span>{getAppDisplayName(appId)}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {apps.length > 0 && (
                    <div className="flex items-center gap-4 my-6">
                        <div className="flex-1 border-t border-border"></div>
                        <span className="text-muted-foreground text-sm">or</span>
                        <div className="flex-1 border-t border-border"></div>
                    </div>
                )}

                <div className="min-h-[80px]">
                    <h3 className="text-base font-medium mb-4 text-muted-foreground">Create New WaveApp</h3>
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
                                    if (
                                        e.key === "Enter" &&
                                        !e.nativeEvent.isComposing &&
                                        newAppName.trim() &&
                                        !inputError
                                    ) {
                                        handleCreateNew();
                                    }
                                }}
                                placeholder="my-app"
                                maxLength={MaxAppNameLength}
                                className={`flex-1 px-3 py-2 bg-panel border rounded-l focus:outline-none transition-colors ${
                                    inputError ? "border-error" : "border-border focus:border-accent"
                                }`}
                                autoFocus
                            />
                            <button
                                onClick={handleCreateNew}
                                disabled={!newAppName.trim() || !!inputError}
                                className={`px-4 py-2 rounded-r transition-colors font-medium whitespace-nowrap ${
                                    !newAppName.trim() || inputError
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
            </div>
        </FlexiModal>
    );
}
