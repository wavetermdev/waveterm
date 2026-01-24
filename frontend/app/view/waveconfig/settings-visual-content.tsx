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
        let unsubscribe: (() => void) | null = null;
        let mounted = true;

        settingsService
            .initialize()
            .then(() => {
                // Only subscribe if component is still mounted
                if (mounted) {
                    unsubscribe = settingsService.subscribe(() => {
                        // When settings change, mark the model as edited if there are pending changes
                        if (settingsService.hasUnsavedChanges()) {
                            model.markAsEdited();
                        }
                    });
                }
            })
            .catch(console.error);

        return () => {
            mounted = false;
            unsubscribe?.();
        };
    }, [model]);

    return <SettingsVisual />;
});

SettingsVisualContent.displayName = "SettingsVisualContent";
