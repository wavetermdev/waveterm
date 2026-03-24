// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import fs from "fs";
import path from "path";
import { getWaveConfigDir } from "./emain-platform";

/**
 * Get settings directly from the Wave Home directory on launch.
 * Only use this when the app is first starting up. Otherwise, prefer the settings.GetFullConfig function.
 * @returns The initial launch settings for the application.
 */
export function getLaunchSettings(): SettingsType {
    const settingsPath = path.join(getWaveConfigDir(), "settings.json");
    try {
        const settingsContents = fs.readFileSync(settingsPath, "utf8");
        return JSON.parse(settingsContents);
    } catch (_) {
        // fail silently
    }
}
