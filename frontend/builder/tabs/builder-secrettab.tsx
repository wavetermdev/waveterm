// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderAppPanelModel } from "@/builder/store/builder-apppanel-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms } from "@/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { memo, useState } from "react";

type SecretRowProps = {
    secretName: string;
    secretMeta: SecretMeta;
    currentBinding: string;
    onBindingChange: (secretName: string, binding: string) => void;
};

const SecretRow = memo(({ secretName, secretMeta, currentBinding, onBindingChange }: SecretRowProps) => {
    return (
        <div className="flex items-center gap-4 py-2 border-b border-border">
            <div className="flex-1 flex items-center gap-2">
                <span className="font-medium text-primary">{secretName}</span>
                {!secretMeta.optional && (
                    <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-500 rounded">Required</span>
                )}
                {secretMeta.optional && (
                    <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-500 rounded">Optional</span>
                )}
                {secretMeta.desc && <span className="text-sm text-secondary">— {secretMeta.desc}</span>}
            </div>
            <div className="flex-1">
                <input
                    type="text"
                    value={currentBinding}
                    onChange={(e) => onBindingChange(secretName, e.target.value)}
                    placeholder="Wave secret store name"
                    className="w-full px-3 py-2 bg-background border border-border rounded text-primary focus:outline-none focus:border-accent"
                />
            </div>
        </div>
    );
});

SecretRow.displayName = "SecretRow";

const BuilderEnvTab = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const builderStatus = useAtomValue(model.builderStatusAtom);
    const error = useAtomValue(model.errorAtom);

    const [localBindings, setLocalBindings] = useState<{ [key: string]: string }>({});
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const manifest = builderStatus?.manifest;
    const secrets = manifest?.secrets || {};
    const secretBindings = builderStatus?.secretbindings || {};

    if (!localBindings || Object.keys(localBindings).length === 0) {
        if (Object.keys(secretBindings).length > 0) {
            setLocalBindings({ ...secretBindings });
        }
    }

    const sortedSecretEntries = Object.entries(secrets).sort(([nameA, metaA], [nameB, metaB]) => {
        if (!metaA.optional && metaB.optional) return -1;
        if (metaA.optional && !metaB.optional) return 1;
        return nameA.localeCompare(nameB);
    });

    const handleBindingChange = (secretName: string, binding: string) => {
        setLocalBindings((prev) => ({ ...prev, [secretName]: binding }));
        setIsDirty(true);
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const appId = globalStore.get(atoms.builderAppId);
            await RpcApi.WriteAppSecretBindingsCommand(TabRpcClient, {
                appid: appId,
                bindings: localBindings,
            });
            setIsDirty(false);
            globalStore.set(model.errorAtom, "");
        } catch (err) {
            console.error("Failed to save secret bindings:", err);
            globalStore.set(model.errorAtom, `Failed to save secret bindings: ${err.message || "Unknown error"}`);
        } finally {
            setIsSaving(false);
        }
    };

    const allRequiredBound =
        sortedSecretEntries.filter(([_, meta]) => !meta.optional).every(([name]) => localBindings[name]?.trim()) ||
        false;

    return (
        <div className="w-full h-full flex flex-col p-4">
            <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold">Secret Bindings</h2>
                <button
                    className="px-3 py-1 text-sm font-medium rounded bg-accent/80 text-primary hover:bg-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleSave}
                    disabled={!isDirty || isSaving}
                >
                    {isSaving ? "Saving..." : "Save"}
                </button>
            </div>

            <div className="mb-4 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-sm text-secondary">
                Map app secrets to Wave secret store names. Required secrets must be bound before the app can run
                successfully.
            </div>

            {!allRequiredBound && (
                <div className="mb-4 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-sm text-yellow-600">
                    Some required secrets are not bound yet.
                </div>
            )}

            {error && <div className="mb-4 p-2 bg-red-500/20 text-red-500 rounded text-sm">{error}</div>}

            <div className="flex-1 overflow-auto">
                {sortedSecretEntries.length === 0 ? (
                    <div className="text-secondary text-center py-8">
                        No secrets defined in this app manifest.
                    </div>
                ) : (
                    <div className="space-y-1">
                        {sortedSecretEntries.map(([secretName, secretMeta]) => (
                            <SecretRow
                                key={secretName}
                                secretName={secretName}
                                secretMeta={secretMeta}
                                currentBinding={localBindings[secretName] || ""}
                                onBindingChange={handleBindingChange}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

BuilderEnvTab.displayName = "BuilderEnvTab";

export { BuilderEnvTab };
