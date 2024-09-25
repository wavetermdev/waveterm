import fs from "fs";
import path from "path";
import { getWaveHomeDir } from "./platform";

/**
 * Get settings directly from the Wave Home directory on launch.
 * Only use this when the app is first starting up. Otherwise, prefer the settings.GetFullConfig function.
 * @returns The initial launch settings for the application.
 */
export function getLaunchSettings(): SettingsType {
    const settingsPath = path.join(getWaveHomeDir(), "config", "settings.json");
    try {
        const settingsContents = fs.readFileSync(settingsPath, "utf8");
        return JSON.parse(settingsContents);
    } catch (e) {
        console.error("Unable to load settings.json to get initial launch settings", e);
    }
}
