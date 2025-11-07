// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import { memo } from "react";
import { SecretStoreViewModel } from "./secretstore-model";

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
            <i className="fa-sharp fa-solid fa-spinner fa-spin text-2xl text-gray-400" />
            <span className="text-gray-400">{message}</span>
        </div>
    );
});
LoadingSpinner.displayName = "LoadingSpinner";

const EmptyState = memo(() => {
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
            <i className="fa-sharp fa-solid fa-key text-4xl text-gray-600" />
            <h3 className="text-lg font-semibold text-gray-400">No Secrets</h3>
            <p className="text-gray-500">Add a secret to get started</p>
        </div>
    );
});
EmptyState.displayName = "EmptyState";

const CLIInfoBubble = memo(() => {
    return (
        <div className="flex flex-col gap-2 p-4 m-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <div className="flex items-center gap-2">
                <i className="fa-sharp fa-solid fa-terminal text-blue-400" />
                <div className="text-sm font-medium text-blue-400">CLI Access</div>
            </div>
            <div className="font-mono text-xs bg-black/30 px-3 py-2 rounded leading-relaxed text-gray-300">
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
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
                <h3 className="text-lg font-semibold">Secrets</h3>
                <span className="px-2 py-1 bg-gray-700 rounded text-sm">{secretNames.length}</span>
            </div>
            <div className="flex flex-col divide-y divide-gray-700">
                {secretNames.map((name) => (
                    <div
                        key={name}
                        className={cn("flex items-center gap-3 p-4 hover:bg-gray-800 cursor-pointer transition-colors")}
                        onClick={() => onSelectSecret(name)}
                    >
                        <i className="fa-sharp fa-solid fa-key text-accent-500" />
                        <span className="flex-1 font-mono">{name}</span>
                        <i className="fa-sharp fa-solid fa-chevron-right text-gray-500 text-sm" />
                    </div>
                ))}
                <div
                    className={cn(
                        "flex items-center justify-center gap-2 p-4 hover:bg-gray-800 cursor-pointer transition-colors border-t-2 border-gray-600"
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
        const secretNameRegex = /^[A-Za-z][A-Za-z0-9_]*$/;
        const isNameInvalid = newSecretName !== "" && !secretNameRegex.test(newSecretName);

        return (
            <div className="flex flex-col gap-4 max-w-2xl mx-auto p-4">
                <h3 className="text-lg font-semibold">Add New Secret</h3>
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Secret Name</label>
                    <input
                        type="text"
                        className={cn(
                            "px-3 py-2 bg-gray-800 border rounded focus:outline-none",
                            isNameInvalid
                                ? "border-red-500 focus:border-red-500"
                                : "border-gray-600 focus:border-accent-500"
                        )}
                        value={newSecretName}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="MY_SECRET_NAME"
                        disabled={isLoading}
                    />
                    <div className="text-xs text-gray-400">
                        Must start with a letter and contain only letters, numbers, and underscores
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Secret Value</label>
                    <textarea
                        className="px-3 py-2 bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-accent-500 font-mono text-sm"
                        value={newSecretValue}
                        onChange={(e) => onValueChange(e.target.value)}
                        placeholder="Enter secret value..."
                        disabled={isLoading}
                        rows={4}
                    />
                </div>
                <div className="flex gap-2 justify-end">
                    <button
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={onCancel}
                        disabled={isLoading}
                    >
                        Cancel
                    </button>
                    <button
                        className="px-4 py-2 bg-accent-600 hover:bg-accent-500 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        onClick={onSubmit}
                        disabled={isLoading}
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
    model: SecretStoreViewModel;
}

const SecretDetailView = memo(({ model }: SecretDetailViewProps) => {
    const secretName = useAtomValue(model.selectedSecret);
    const secretValue = useAtomValue(model.secretValue);
    const secretShown = useAtomValue(model.secretShown);
    const isLoading = useAtomValue(model.isLoading);
    const setSecretValue = useSetAtom(model.secretValue);

    if (!secretName) {
        return null;
    }

    return (
        <div className="flex flex-col gap-4 max-w-2xl mx-auto p-4">
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
                    className="px-3 py-2 bg-gray-800 border border-gray-600 rounded focus:outline-none focus:border-accent-500 font-mono text-sm"
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
                    <div className="text-sm text-gray-400">
                        The current secret value is not shown by default for security purposes.{" "}
                        {isLoading ? (
                            <span className="text-gray-500">
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
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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

export const SecretStoreView = memo(({ model }: { blockId: string; model: SecretStoreViewModel }) => {
    const secretNames = useAtomValue(model.secretNames);
    const selectedSecret = useAtomValue(model.selectedSecret);
    const isLoading = useAtomValue(model.isLoading);
    const errorMessage = useAtomValue(model.errorMessage);
    const storageBackendError = useAtomValue(model.storageBackendError);
    const isAddingNew = useAtomValue(model.isAddingNew);
    const newSecretName = useAtomValue(model.newSecretName);
    const newSecretValue = useAtomValue(model.newSecretValue);

    const setNewSecretName = useSetAtom(model.newSecretName);
    const setNewSecretValue = useSetAtom(model.newSecretValue);

    if (storageBackendError) {
        return (
            <div className="secretstore-view">
                <ErrorDisplay message={storageBackendError} variant="warning" />
            </div>
        );
    }

    if (isLoading && secretNames.length === 0 && !selectedSecret) {
        return (
            <div className="secretstore-view">
                <LoadingSpinner message="Loading secrets..." />
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
            return <EmptyState />;
        }

        return (
            <SecretListView
                secretNames={secretNames}
                onSelectSecret={(name) => model.viewSecret(name)}
                onAddSecret={() => model.startAddingSecret()}
            />
        );
    };

    return (
        <div className="secretstore-view w-full h-full">
            {errorMessage && (
                <div className="mb-4">
                    <ErrorDisplay message={errorMessage} />
                </div>
            )}
            {renderContent()}
        </div>
    );
});

SecretStoreView.displayName = "SecretStoreView";
