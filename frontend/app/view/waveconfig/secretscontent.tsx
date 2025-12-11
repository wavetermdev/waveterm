// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SecretNameRegex, type WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useMemo } from "react";

interface ErrorDisplayProps {
    message: string;
    variant?: "error" | "warning";
}

const ErrorDisplay = memo(({ message, variant = "error" }: ErrorDisplayProps) => {
    const icon = variant === "error" ? "fa-circle-exclamation" : "fa-triangle-exclamation";
    const baseClasses = "flex items-center gap-2 p-4 border rounded-lg";
    const variantClasses =
        variant === "error"
            ? "bg-red-500/10 border-red-500/20 text-red-400"
            : "bg-yellow-500/10 border-yellow-500/20 text-yellow-400";

    return (
        <div className={`${baseClasses} ${variantClasses}`}>
            <i className={`fa-sharp fa-solid ${icon}`} />
            <span>{message}</span>
        </div>
    );
});
ErrorDisplay.displayName = "ErrorDisplay";

const LoadingSpinner = memo(({ message }: { message: string }) => {
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
            <i className="fa-sharp fa-solid fa-spinner fa-spin text-2xl text-zinc-400" />
            <span className="text-zinc-400">{message}</span>
        </div>
    );
});
LoadingSpinner.displayName = "LoadingSpinner";

const EmptyState = memo(({ onAddSecret }: { onAddSecret: () => void }) => {
    return (
        <div className="flex flex-col items-center justify-center gap-4 py-12 h-full bg-zinc-800/50 rounded-lg">
            <i className="fa-sharp fa-solid fa-key text-4xl text-zinc-600" />
            <h3 className="text-lg font-semibold text-zinc-400">No Secrets</h3>
            <p className="text-zinc-500">Add a secret to get started</p>
            <button
                className="flex items-center gap-2 px-4 py-2 bg-accent-600 hover:bg-accent-500 rounded cursor-pointer transition-colors"
                onClick={onAddSecret}
            >
                <i className="fa-sharp fa-solid fa-plus" />
                <span className="font-medium">Add New Secret</span>
            </button>
        </div>
    );
});
EmptyState.displayName = "EmptyState";

const CLIInfoBubble = memo(() => {
    return (
        <div className="flex flex-col gap-2 p-4 m-4 bg-zinc-800/50 rounded-lg">
            <div className="flex items-center gap-2">
                <i className="fa-sharp fa-solid fa-terminal text-zinc-400" />
                <div className="text-sm font-medium text-zinc-300">CLI Access</div>
            </div>
            <div className="font-mono text-xs bg-black/20 px-3 py-2 rounded leading-relaxed text-zinc-300">
                wsh secret list
                <br />
                wsh secret get [name]
                <br />
                wsh secret set [name]=[value]
            </div>
        </div>
    );
});
CLIInfoBubble.displayName = "CLIInfoBubble";

interface SecretListViewProps {
    secretNames: string[];
    onSelectSecret: (name: string) => void;
    onAddSecret: () => void;
}

const SecretListView = memo(({ secretNames, onSelectSecret, onAddSecret }: SecretListViewProps) => {
    return (
        <div className="flex flex-col h-full w-full rounded-lg">
            <div className="flex flex-col divide-y divide-zinc-700">
                {secretNames.map((name) => (
                    <div
                        key={name}
                        className={cn(
                            "flex items-center gap-3 p-4 hover:bg-zinc-700/50 cursor-pointer transition-colors"
                        )}
                        onClick={() => onSelectSecret(name)}
                    >
                        <i className="fa-sharp fa-solid fa-key text-accent-500" />
                        <span className="flex-1 font-mono">{name}</span>
                        <i className="fa-sharp fa-solid fa-chevron-right text-zinc-500 text-sm" />
                    </div>
                ))}
                <div
                    className={cn(
                        "flex items-center justify-center gap-2 p-4 hover:bg-zinc-700/50 cursor-pointer transition-colors border-t-2 border-zinc-600"
                    )}
                    onClick={onAddSecret}
                >
                    <i className="fa-sharp fa-solid fa-plus text-accent-500" />
                    <span className="font-medium text-accent-500">Add New Secret</span>
                </div>
            </div>
            <CLIInfoBubble />
        </div>
    );
});
SecretListView.displayName = "SecretListView";

interface AddSecretFormProps {
    newSecretName: string;
    newSecretValue: string;
    isLoading: boolean;
    onNameChange: (name: string) => void;
    onValueChange: (value: string) => void;
    onCancel: () => void;
    onSubmit: () => void;
}

const AddSecretForm = memo(
    ({
        newSecretName,
        newSecretValue,
        isLoading,
        onNameChange,
        onValueChange,
        onCancel,
        onSubmit,
    }: AddSecretFormProps) => {
        const isNameInvalid = newSecretName !== "" && !SecretNameRegex.test(newSecretName);

        return (
            <div className="flex flex-col gap-4 min-h-full p-6 bg-zinc-800/50 rounded-lg">
                <h3 className="text-lg font-semibold">Add New Secret</h3>
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Secret Name</label>
                    <input
                        type="text"
                        className={cn(
                            "px-3 py-2 bg-zinc-800 border rounded focus:outline-none",
                            isNameInvalid
                                ? "border-red-500 focus:border-red-500"
                                : "border-zinc-600 focus:border-accent-500"
                        )}
                        value={newSecretName}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="MY_SECRET_NAME"
                        disabled={isLoading}
                    />
                    <div className="text-xs text-zinc-400">
                        Must start with a letter and contain only letters, numbers, and underscores
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Secret Value</label>
                    <textarea
                        className="px-3 py-2 bg-zinc-800 border border-zinc-600 rounded focus:outline-none focus:border-accent-500 font-mono text-sm"
                        value={newSecretValue}
                        onChange={(e) => onValueChange(e.target.value)}
                        placeholder="Enter secret value..."
                        disabled={isLoading}
                        rows={4}
                    />
                </div>
                <div className="flex gap-2 justify-end">
                    <button
                        className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={onCancel}
                        disabled={isLoading}
                    >
                        Cancel
                    </button>
                    <button
                        className="px-4 py-2 bg-accent-600 hover:bg-accent-500 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        onClick={onSubmit}
                        disabled={isLoading || isNameInvalid || newSecretName.trim() === ""}
                    >
                        {isLoading ? (
                            <>
                                <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                                Adding...
                            </>
                        ) : (
                            "Add Secret"
                        )}
                    </button>
                </div>
            </div>
        );
    }
);
AddSecretForm.displayName = "AddSecretForm";

interface SecretDetailViewProps {
    model: WaveConfigViewModel;
}

const SecretDetailView = memo(({ model }: SecretDetailViewProps) => {
    const secretName = useAtomValue(model.selectedSecretAtom);
    const secretValue = useAtomValue(model.secretValueAtom);
    const secretShown = useAtomValue(model.secretShownAtom);
    const isLoading = useAtomValue(model.isLoadingAtom);
    const setSecretValue = useSetAtom(model.secretValueAtom);

    if (!secretName) {
        return null;
    }

    return (
        <div className="flex flex-col gap-4 min-h-full p-6 bg-zinc-800/50 rounded-lg">
            <div className="flex items-center gap-2">
                <i className="fa-sharp fa-solid fa-key text-accent-500" />
                <h3 className="text-lg font-semibold">{secretName}</h3>
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Secret Value</label>
                <textarea
                    ref={(ref) => {
                        model.secretValueRef = ref;
                        if (ref) {
                            ref.focus();
                        }
                    }}
                    className="px-3 py-2 bg-zinc-800 border border-zinc-600 rounded focus:outline-none focus:border-accent-500 font-mono text-sm"
                    value={secretValue}
                    onChange={(e) => setSecretValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            model.closeSecretView();
                        }
                    }}
                    disabled={isLoading}
                    rows={6}
                    placeholder={!secretShown ? "Enter new secret value..." : ""}
                />
                {!secretShown && (
                    <div className="text-sm text-zinc-400">
                        The current secret value is not shown by default for security purposes.{" "}
                        {isLoading ? (
                            <span className="text-zinc-500">
                                <i className="fa-sharp fa-solid fa-spinner fa-spin" /> Loading...
                            </span>
                        ) : (
                            <button
                                className="text-accent-500 underline hover:text-accent-400 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => model.showSecret()}
                                disabled={isLoading}
                            >
                                Show Secret
                            </button>
                        )}
                    </div>
                )}
            </div>
            <div className="flex gap-2 justify-between">
                <button
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    onClick={() => model.deleteSecret()}
                    disabled={isLoading}
                    title="Delete this secret"
                >
                    {isLoading ? (
                        <>
                            <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                            Deleting...
                        </>
                    ) : (
                        <>
                            <i className="fa-sharp fa-solid fa-trash" />
                            Delete
                        </>
                    )}
                </button>
                <div className="flex gap-2">
                    <button
                        className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => model.closeSecretView()}
                        disabled={isLoading}
                    >
                        Cancel
                    </button>
                    <button
                        className="px-4 py-2 bg-accent-600 hover:bg-accent-500 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        onClick={() => model.saveSecret()}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <>
                                <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                                Saving...
                            </>
                        ) : (
                            "Save"
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
});
SecretDetailView.displayName = "SecretDetailView";

interface SecretsContentProps {
    model: WaveConfigViewModel;
}

export const SecretsContent = memo(({ model }: SecretsContentProps) => {
    const secretNames = useAtomValue(model.secretNamesAtom);
    const selectedSecret = useAtomValue(model.selectedSecretAtom);
    const isLoading = useAtomValue(model.isLoadingAtom);
    const errorMessage = useAtomValue(model.errorMessageAtom);
    const storageBackendError = useAtomValue(model.storageBackendErrorAtom);
    const isAddingNew = useAtomValue(model.isAddingNewAtom);
    const newSecretName = useAtomValue(model.newSecretNameAtom);
    const newSecretValue = useAtomValue(model.newSecretValueAtom);

    const setNewSecretName = useSetAtom(model.newSecretNameAtom);
    const setNewSecretValue = useSetAtom(model.newSecretValueAtom);

    const sortedSecretNames = useMemo(() => {
        return [...secretNames].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }, [secretNames]);

    if (storageBackendError) {
        return (
            <div className="w-full h-full">
                <div className="p-4">
                    <ErrorDisplay message={storageBackendError} variant="warning" />
                </div>
            </div>
        );
    }

    if (isLoading && secretNames.length === 0 && !selectedSecret) {
        return (
            <div className="w-full h-full">
                <div>
                    <LoadingSpinner message="Loading secrets..." />
                </div>
            </div>
        );
    }

    const renderContent = () => {
        if (isAddingNew) {
            return (
                <AddSecretForm
                    newSecretName={newSecretName}
                    newSecretValue={newSecretValue}
                    isLoading={isLoading}
                    onNameChange={setNewSecretName}
                    onValueChange={setNewSecretValue}
                    onCancel={() => model.cancelAddingSecret()}
                    onSubmit={() => model.addNewSecret()}
                />
            );
        }

        if (selectedSecret) {
            return <SecretDetailView model={model} />;
        }

        if (secretNames.length === 0) {
            return <EmptyState onAddSecret={() => model.startAddingSecret()} />;
        }

        return (
            <SecretListView
                secretNames={sortedSecretNames}
                onSelectSecret={(name) => model.viewSecret(name)}
                onAddSecret={() => model.startAddingSecret()}
            />
        );
    };

    return (
        <div className="w-full h-full">
            {errorMessage && (
                <div className="p-4">
                    <ErrorDisplay message={errorMessage} />
                </div>
            )}
            {renderContent()}
        </div>
    );
});

SecretsContent.displayName = "SecretsContent";
