// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderAppPanelModel } from "@/builder/store/builder-apppanel-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms } from "@/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { memo, useState, useEffect } from "react";
import { Check, AlertTriangle } from "lucide-react";
import { Tooltip } from "@/app/element/tooltip";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";

type SecretRowProps = {
    secretName: string;
    secretMeta: SecretMeta;
    currentBinding: string;
    availableSecrets: string[];
    onMapDefault: (secretName: string) => void;
    onSetAndMapDefault: (secretName: string) => void;
};

const SecretRow = memo(({ secretName, secretMeta, currentBinding, availableSecrets, onMapDefault, onSetAndMapDefault }: SecretRowProps) => {
    const isMapped = currentBinding.trim().length > 0;
    const isValid = isMapped && availableSecrets.includes(currentBinding);
    const isInvalid = isMapped && !isValid;
    const hasMatchingSecret = availableSecrets.includes(secretName);

    return (
        <div className="flex items-center gap-4 py-2 border-b border-border">
            <Tooltip content={!isMapped ? "Secret is Not Mapped" : isValid ? "Secret Has a Valid Mapping" : "Secret Binding is Invalid"}>
                <div className="flex items-center">
                    {!isMapped && <AlertTriangle className="w-5 h-5 text-yellow-500" />}
                    {isInvalid && <AlertTriangle className="w-5 h-5 text-red-500" />}
                    {isValid && <Check className="w-5 h-5 text-green-500" />}
                </div>
            </Tooltip>
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
            <div className="flex items-center gap-2">
                {!isMapped && hasMatchingSecret && (
                    <button
                        onClick={() => onMapDefault(secretName)}
                        className="px-3 py-1 text-sm font-medium rounded bg-accent/80 text-primary hover:bg-accent transition-colors cursor-pointer whitespace-nowrap"
                    >
                        Map Default
                    </button>
                )}
                {!isMapped && !hasMatchingSecret && (
                    <button
                        onClick={() => onSetAndMapDefault(secretName)}
                        className="px-3 py-1 text-sm font-medium rounded bg-accent/80 text-primary hover:bg-accent transition-colors cursor-pointer whitespace-nowrap"
                    >
                        Set and Map Default
                    </button>
                )}
            </div>
        </div>
    );
});

SecretRow.displayName = "SecretRow";

type SetSecretDialogProps = {
    secretName: string;
    onSetAndMap: (secretName: string, secretValue: string) => Promise<void>;
};

const SetSecretDialog = memo(({ secretName, onSetAndMap }: SetSecretDialogProps) => {
    const [secretValue, setSecretValue] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async () => {
        if (!secretValue.trim()) return;
        setIsSubmitting(true);
        setError("");
        try {
            await onSetAndMap(secretName, secretValue);
            modalsModel.popModal();
        } catch (err) {
            console.error("Failed to set secret:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        modalsModel.popModal();
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                handleClose();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, []);

    if (error) {
        return (
            <Modal className="p-4 min-w-[500px]" onOk={handleClose} onClose={handleClose} okLabel="OK">
                <div className="flex flex-col gap-4 mb-4">
                    <h2 className="text-xl font-semibold">Error Setting Secret</h2>
                    <div className="text-sm text-error">{error}</div>
                </div>
            </Modal>
        );
    }

    return (
        <Modal
            className="p-4 min-w-[500px]"
            onOk={handleSubmit}
            onCancel={handleClose}
            onClose={handleClose}
            okLabel="Set and Map"
            cancelLabel="Cancel"
            okDisabled={!secretValue.trim() || isSubmitting}
        >
            <div className="flex flex-col gap-4 mb-4">
                <h2 className="text-xl font-semibold">Set and Map Secret</h2>
                <div className="flex flex-col gap-2">
                    <div className="text-sm font-medium mb-1">
                        Secret Name: <span className="text-accent">{secretName}</span>
                    </div>
                    <textarea
                        value={secretValue}
                        onChange={(e) => setSecretValue(e.target.value)}
                        placeholder="Paste secret value here..."
                        className="w-full px-3 py-2 bg-panel border border-border rounded focus:outline-none focus:border-accent resize-none"
                        rows={4}
                        autoFocus
                        disabled={isSubmitting}
                    />
                    <div className="text-xs text-secondary">
                        Secrets are stored securely in Wave's secret store
                    </div>
                </div>
            </div>
        </Modal>
    );
});

SetSecretDialog.displayName = "SetSecretDialog";

const BuilderEnvTab = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const builderStatus = useAtomValue(model.builderStatusAtom);
    const error = useAtomValue(model.errorAtom);

    const [localBindings, setLocalBindings] = useState<{ [key: string]: string }>({});
    const [availableSecrets, setAvailableSecrets] = useState<string[]>([]);

    const manifest = builderStatus?.manifest;
    const secrets = manifest?.secrets || {};
    const secretBindings = builderStatus?.secretbindings || {};

    useEffect(() => {
        const fetchSecrets = async () => {
            try {
                const secrets = await RpcApi.GetSecretsNamesCommand(TabRpcClient);
                setAvailableSecrets(secrets || []);
            } catch (err) {
                console.error("Failed to fetch secrets:", err);
            }
        };
        fetchSecrets();
    }, []);

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

    const handleMapDefault = async (secretName: string) => {
        const newBindings = { ...localBindings, [secretName]: secretName };
        setLocalBindings(newBindings);
        
        try {
            const appId = globalStore.get(atoms.builderAppId);
            await RpcApi.WriteAppSecretBindingsCommand(TabRpcClient, {
                appid: appId,
                bindings: newBindings,
            });
            globalStore.set(model.errorAtom, "");
            model.restartBuilder();
        } catch (err) {
            console.error("Failed to save secret bindings:", err);
            globalStore.set(model.errorAtom, `Failed to save secret bindings: ${err.message || "Unknown error"}`);
        }
    };

    const handleSetAndMapDefault = (secretName: string) => {
        modalsModel.pushModal("SetSecretDialog", { secretName, onSetAndMap: handleSetAndMap });
    };

    const handleSetAndMap = async (secretName: string, secretValue: string) => {
        await RpcApi.SetSecretsCommand(TabRpcClient, { [secretName]: secretValue });
        setAvailableSecrets((prev) => [...prev, secretName]);
        
        const newBindings = { ...localBindings, [secretName]: secretName };
        setLocalBindings(newBindings);
        
        try {
            const appId = globalStore.get(atoms.builderAppId);
            await RpcApi.WriteAppSecretBindingsCommand(TabRpcClient, {
                appid: appId,
                bindings: newBindings,
            });
            globalStore.set(model.errorAtom, "");
            model.restartBuilder();
        } catch (err) {
            console.error("Failed to save secret bindings:", err);
            globalStore.set(model.errorAtom, `Failed to save secret bindings: ${err.message || "Unknown error"}`);
        }
    };

    const allRequiredBound =
        sortedSecretEntries.filter(([_, meta]) => !meta.optional).every(([name]) => localBindings[name]?.trim()) ||
        false;

    return (
        <div className="w-full h-full flex flex-col p-4">
            <h2 className="text-lg font-semibold mb-2">Secret Bindings</h2>

            <div className="mb-4 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-sm text-secondary">
                Map app secrets to Wave secret store names. Required secrets must be bound before the app can run
                successfully. Changes are saved automatically.
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
                                availableSecrets={availableSecrets}
                                onMapDefault={handleMapDefault}
                                onSetAndMapDefault={handleSetAndMapDefault}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

BuilderEnvTab.displayName = "BuilderEnvTab";

export { BuilderEnvTab, SetSecretDialog };
