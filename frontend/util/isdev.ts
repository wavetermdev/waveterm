import { getEnv } from "./getenv";
import { lazy } from "./util";

export const WaveDevVarName = "WAVETERM_DEV";
export const WaveDevViteVarName = "WAVETERM_DEV_VITE";

/**
 * Determines whether the current app instance is a development build.
 * @returns True if the current app instance is a development build.
 */
export const isDev = lazy(() => !!getEnv(WaveDevVarName));

/**
 * Determines whether the current app instance is running via the Vite dev server.
 * @returns True if the app is running via the Vite dev server.
 */
export const isDevVite = lazy(() => !!getEnv(WaveDevViteVarName));
