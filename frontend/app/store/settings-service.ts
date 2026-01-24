// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Service
 *
 * Handles reading and writing settings with debounced saves,
 * optimistic updates, and proper error handling.
 */

import { atoms } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getDefaultValue, getSettingMetadata, settingsRegistry } from "@/app/store/settings-registry";
import { debounce } from "throttle-debounce";
import {
    allSettingsAtom,
    isSavingAtom,
    pendingSettingsAtom,
    savedSettingsAtom,
    saveErrorAtom,
} from "./settings-atoms";

type SettingsSubscriber = (settings: Record<string, unknown>) => void;

class SettingsService {
    private initialized = false;
    private subscribers: Set<SettingsSubscriber> = new Set();
    private pendingChanges: Record<string, unknown> = {};
    private debouncedSave: ReturnType<typeof debounce>;

    constructor() {
        this.debouncedSave = debounce(500, () => this.flushPendingChanges());
    }

    /**
     * Initialize the settings service by loading current settings.
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.loadSettings();
            this.initialized = true;
        } catch (error) {
            console.error("Failed to initialize settings service:", error);
            throw error;
        }
    }

    /**
     * Load settings from fullConfigAtom (which is populated via WPS events).
     */
    private async loadSettings(): Promise<void> {
        try {
            // Get settings from fullConfigAtom which is already populated
            const fullConfig = globalStore.get(atoms.fullConfigAtom);
            const settings = fullConfig?.settings ?? {};

            globalStore.set(savedSettingsAtom, settings as Record<string, unknown>);
            globalStore.set(pendingSettingsAtom, {});
            globalStore.set(saveErrorAtom, null);
            this.notifySubscribers(settings as Record<string, unknown>);
        } catch (error) {
            console.error("Failed to load settings:", error);
            globalStore.set(saveErrorAtom, `Failed to load settings: ${error}`);
        }
    }

    /**
     * Sync saved settings when fullConfigAtom changes externally.
     * Called when WPS config event updates fullConfigAtom.
     */
    syncFromFullConfig(): void {
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const settings = fullConfig?.settings ?? {};
        globalStore.set(savedSettingsAtom, settings as Record<string, unknown>);
        this.notifySubscribers(globalStore.get(allSettingsAtom));
    }

    /**
     * Reload settings from disk.
     */
    async reload(): Promise<void> {
        await this.loadSettings();
    }

    /**
     * Get the current value of a setting.
     */
    getSetting<T>(key: string): T | undefined {
        const allSettings = globalStore.get(allSettingsAtom);
        return allSettings[key] as T | undefined;
    }

    /**
     * Get all current settings (merged saved + pending).
     */
    getAllSettings(): Record<string, unknown> {
        return globalStore.get(allSettingsAtom);
    }

    /**
     * Set a single setting value with debounced save.
     */
    setSetting(key: string, value: unknown): void {
        // Validate that the key is a known setting
        const metadata = getSettingMetadata(key);
        if (!metadata) {
            console.warn(`Unknown setting key: ${key}`);
        }

        // Update pending changes
        this.pendingChanges[key] = value;
        const currentPending = globalStore.get(pendingSettingsAtom);
        globalStore.set(pendingSettingsAtom, { ...currentPending, [key]: value });

        // Notify subscribers immediately (optimistic update)
        this.notifySubscribers(globalStore.get(allSettingsAtom));

        // Trigger debounced save
        this.debouncedSave();
    }

    /**
     * Set multiple settings at once.
     */
    setSettings(settings: Record<string, unknown>): void {
        for (const [key, value] of Object.entries(settings)) {
            this.pendingChanges[key] = value;
        }

        const currentPending = globalStore.get(pendingSettingsAtom);
        globalStore.set(pendingSettingsAtom, { ...currentPending, ...settings });

        this.notifySubscribers(globalStore.get(allSettingsAtom));
        this.debouncedSave();
    }

    /**
     * Reset a setting to its default value.
     */
    resetSetting(key: string): void {
        const defaultValue = getDefaultValue(key);
        // Setting to undefined will remove it from the saved file
        this.setSetting(key, defaultValue);
    }

    /**
     * Reset all settings to defaults.
     */
    async resetAllSettings(): Promise<void> {
        globalStore.set(pendingSettingsAtom, {});
        globalStore.set(savedSettingsAtom, {});
        this.pendingChanges = {};

        await this.saveToFile({});
        this.notifySubscribers({});
    }

    /**
     * Check if a setting is modified from its default value.
     */
    isModified(key: string): boolean {
        const currentValue = this.getSetting(key);
        const defaultValue = getDefaultValue(key);

        // If current value is undefined/null and default is also undefined/null, not modified
        if (currentValue == null && defaultValue == null) {
            return false;
        }

        // Handle empty string as equivalent to undefined for optional settings
        if (currentValue === "" && defaultValue === "") {
            return false;
        }

        // Compare arrays
        if (Array.isArray(currentValue) && Array.isArray(defaultValue)) {
            if (currentValue.length !== defaultValue.length) return true;
            return currentValue.some((v, i) => v !== defaultValue[i]);
        }

        return currentValue !== defaultValue;
    }

    /**
     * Get all settings that are modified from their defaults.
     */
    getModifiedSettings(): string[] {
        const modified: string[] = [];

        // Check all registered settings, not just ones with values set
        for (const key of settingsRegistry.keys()) {
            if (this.isModified(key)) {
                modified.push(key);
            }
        }

        return modified;
    }

    /**
     * Flush pending changes and save to file.
     */
    private async flushPendingChanges(): Promise<void> {
        if (Object.keys(this.pendingChanges).length === 0) return;

        const saved = globalStore.get(savedSettingsAtom);
        const pending = globalStore.get(pendingSettingsAtom);

        // Merge pending into saved
        const newSettings: Record<string, unknown> = { ...saved };
        for (const [key, value] of Object.entries(pending)) {
            if (value === null || value === undefined) {
                // Remove key if value is null/undefined
                delete newSettings[key];
            } else {
                newSettings[key] = value;
            }
        }

        globalStore.set(isSavingAtom, true);

        try {
            await this.saveToFile(newSettings);

            // Clear pending and update saved
            // Note: savedSettingsAtom will be updated via WPS event when fullConfigAtom changes
            this.pendingChanges = {};
            globalStore.set(pendingSettingsAtom, {});
            globalStore.set(saveErrorAtom, null);
        } catch (error) {
            console.error("Failed to save settings:", error);
            globalStore.set(saveErrorAtom, `Failed to save: ${error}`);
        } finally {
            globalStore.set(isSavingAtom, false);
        }
    }

    /**
     * Save settings via RPC SetConfigCommand.
     * This integrates with the backend's config system properly.
     */
    private async saveToFile(settings: Record<string, unknown>): Promise<void> {
        // Use SetConfigCommand which saves to settings.json and triggers WPS events
        await RpcApi.SetConfigCommand(TabRpcClient, settings as SettingsType);
    }

    /**
     * Force save all pending changes immediately.
     */
    async forceSave(): Promise<void> {
        this.debouncedSave.cancel();
        await this.flushPendingChanges();
    }

    /**
     * Subscribe to settings changes.
     */
    subscribe(callback: SettingsSubscriber): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    /**
     * Notify all subscribers of settings change.
     */
    private notifySubscribers(settings: Record<string, unknown>): void {
        for (const subscriber of this.subscribers) {
            try {
                subscriber(settings);
            } catch (error) {
                console.error("Settings subscriber error:", error);
            }
        }
    }

    /**
     * Check if there are unsaved changes.
     */
    hasUnsavedChanges(): boolean {
        const pending = globalStore.get(pendingSettingsAtom);
        return Object.keys(pending).length > 0;
    }
}

// Singleton instance
export const settingsService = new SettingsService();
