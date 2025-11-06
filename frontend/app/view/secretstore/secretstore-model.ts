// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS, globalStore } from "@/store/global";
import * as jotai from "jotai";
import { SecretStoreView } from "./secretstore";

const SECRET_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

export class SecretStoreViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    blockAtom: jotai.Atom<Block>;
    nodeModel: BlockNodeModel;

    viewIcon = jotai.atom<string>("key");
    viewName = jotai.atom<string>("Secret Store");
    
    secretNames: jotai.PrimitiveAtom<string[]>;
    selectedSecret: jotai.PrimitiveAtom<string | null>;
    secretValue: jotai.PrimitiveAtom<string>;
    isLoading: jotai.PrimitiveAtom<boolean>;
    errorMessage: jotai.PrimitiveAtom<string | null>;
    storageBackendError: jotai.PrimitiveAtom<string | null>;
    isEditing: jotai.PrimitiveAtom<boolean>;
    isAddingNew: jotai.PrimitiveAtom<boolean>;
    newSecretName: jotai.PrimitiveAtom<string>;
    newSecretValue: jotai.PrimitiveAtom<string>;
    
    endIconButtons!: jotai.Atom<IconButtonDecl[]>;

    constructor(blockId: string, nodeModel: BlockNodeModel) {
        this.viewType = "secretstore";
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        
        this.secretNames = jotai.atom<string[]>([]);
        this.selectedSecret = jotai.atom<string | null>(null) as jotai.PrimitiveAtom<string | null>;
        this.secretValue = jotai.atom<string>("");
        this.isLoading = jotai.atom<boolean>(false);
        this.errorMessage = jotai.atom<string | null>(null) as jotai.PrimitiveAtom<string | null>;
        this.storageBackendError = jotai.atom<string | null>(null) as jotai.PrimitiveAtom<string | null>;
        this.isEditing = jotai.atom<boolean>(false);
        this.isAddingNew = jotai.atom<boolean>(false);
        this.newSecretName = jotai.atom<string>("");
        this.newSecretValue = jotai.atom<string>("");
        
        this.endIconButtons = jotai.atom((get) => {
            const buttons: IconButtonDecl[] = [];
            
            buttons.push({
                elemtype: "iconbutton",
                icon: "rotate-right",
                title: "Refresh",
                click: () => this.refreshSecrets(),
            });
            
            return buttons;
        });
        
        this.checkStorageBackend();
        this.refreshSecrets();
    }

    get viewComponent() {
        return SecretStoreView;
    }

    async checkStorageBackend() {
        try {
            const backend = await RpcApi.GetSecretsLinuxStorageBackendCommand(TabRpcClient);
            if (backend === "basic_text" || backend === "unknown") {
                globalStore.set(
                    this.storageBackendError,
                    "No appropriate secret manager found. Cannot manage secrets securely."
                );
            } else {
                globalStore.set(this.storageBackendError, null);
            }
        } catch (error) {
            globalStore.set(
                this.storageBackendError,
                `Error checking storage backend: ${error.message}`
            );
        }
    }

    async refreshSecrets() {
        globalStore.set(this.isLoading, true);
        globalStore.set(this.errorMessage, null);
        
        try {
            const names = await RpcApi.GetSecretsNamesCommand(TabRpcClient);
            globalStore.set(this.secretNames, names || []);
        } catch (error) {
            globalStore.set(this.errorMessage, `Failed to load secrets: ${error.message}`);
        } finally {
            globalStore.set(this.isLoading, false);
        }
    }

    async viewSecret(name: string) {
        globalStore.set(this.isLoading, true);
        globalStore.set(this.errorMessage, null);
        globalStore.set(this.selectedSecret, name);
        globalStore.set(this.isEditing, false);
        
        try {
            const secrets = await RpcApi.GetSecretsCommand(TabRpcClient, [name]);
            const value = secrets[name];
            if (value !== undefined) {
                globalStore.set(this.secretValue, value);
            } else {
                globalStore.set(this.errorMessage, `Secret not found: ${name}`);
                globalStore.set(this.secretValue, "");
            }
        } catch (error) {
            globalStore.set(this.errorMessage, `Failed to load secret: ${error.message}`);
            globalStore.set(this.secretValue, "");
        } finally {
            globalStore.set(this.isLoading, false);
        }
    }

    closeSecretView() {
        globalStore.set(this.selectedSecret, null);
        globalStore.set(this.secretValue, "");
        globalStore.set(this.isEditing, false);
        globalStore.set(this.errorMessage, null);
    }

    startEditingSecret() {
        globalStore.set(this.isEditing, true);
    }

    cancelEditingSecret() {
        globalStore.set(this.isEditing, false);
        const selectedSecret = globalStore.get(this.selectedSecret);
        if (selectedSecret) {
            this.viewSecret(selectedSecret);
        }
    }

    async saveSecret() {
        const selectedSecret = globalStore.get(this.selectedSecret);
        const secretValue = globalStore.get(this.secretValue);
        
        if (!selectedSecret) {
            return;
        }
        
        globalStore.set(this.isLoading, true);
        globalStore.set(this.errorMessage, null);
        
        try {
            await RpcApi.SetSecretsCommand(TabRpcClient, { [selectedSecret]: secretValue });
            globalStore.set(this.isEditing, false);
        } catch (error) {
            globalStore.set(this.errorMessage, `Failed to save secret: ${error.message}`);
        } finally {
            globalStore.set(this.isLoading, false);
        }
    }

    startAddingSecret() {
        globalStore.set(this.isAddingNew, true);
        globalStore.set(this.newSecretName, "");
        globalStore.set(this.newSecretValue, "");
        globalStore.set(this.errorMessage, null);
    }

    cancelAddingSecret() {
        globalStore.set(this.isAddingNew, false);
        globalStore.set(this.newSecretName, "");
        globalStore.set(this.newSecretValue, "");
        globalStore.set(this.errorMessage, null);
    }

    async addNewSecret() {
        const name = globalStore.get(this.newSecretName).trim();
        const value = globalStore.get(this.newSecretValue);
        
        if (!name) {
            globalStore.set(this.errorMessage, "Secret name cannot be empty");
            return;
        }
        
        if (!SECRET_NAME_REGEX.test(name)) {
            globalStore.set(
                this.errorMessage,
                "Invalid secret name: must start with a letter and contain only letters, numbers, and underscores"
            );
            return;
        }
        
        const existingNames = globalStore.get(this.secretNames);
        if (existingNames.includes(name)) {
            globalStore.set(this.errorMessage, `Secret "${name}" already exists`);
            return;
        }
        
        globalStore.set(this.isLoading, true);
        globalStore.set(this.errorMessage, null);
        
        try {
            await RpcApi.SetSecretsCommand(TabRpcClient, { [name]: value });
            globalStore.set(this.isAddingNew, false);
            globalStore.set(this.newSecretName, "");
            globalStore.set(this.newSecretValue, "");
            await this.refreshSecrets();
        } catch (error) {
            globalStore.set(this.errorMessage, `Failed to add secret: ${error.message}`);
        } finally {
            globalStore.set(this.isLoading, false);
        }
    }

    giveFocus(): boolean {
        return true;
    }

    dispose() {
    }
}