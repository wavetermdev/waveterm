// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Visual Content
 *
 * Wrapper component that integrates the SettingsVisual component
 * with the WaveConfigViewModel for the General settings config file.
 */

import { memo, useEffect } from "react";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { SettingsVisual } from "@/app/view/waveconfig/settings-visual";
import { settingsService } from "@/app/store/settings-service";

interface SettingsVisualContentProps {
    model: WaveConfigViewModel;
}

export const SettingsVisualContent = memo(({ model }: SettingsVisualContentProps) => {
    // Initialize settings service when component mounts
    useEffect(() => {
        settingsService.initialize().catch(console.error);

        // Subscribe to settings changes to sync with model
        const unsubscribe = settingsService.subscribe(() => {
            // When settings change, mark the model as edited if there are pending changes
            if (settingsService.hasUnsavedChanges()) {
                model.markAsEdited();
            }
        });

        return unsubscribe;
    }, [model]);

    return <SettingsVisual />;
});

SettingsVisualContent.displayName = "SettingsVisualContent";
