import { _electron as electron, ElectronApplication, Page } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const APP_PATH = path.resolve(__dirname, "../../make/win-unpacked/Wave.exe");

export async function launchApp(): Promise<ElectronApplication> {
    const app = await electron.launch({
        executablePath: APP_PATH,
        args: [],
        env: {
            ...process.env,
            WAVETERM_NOCONFIRMQUIT: "1",
        },
    });
    return app;
}

export async function getMainWindow(app: ElectronApplication): Promise<Page> {
    return await app.firstWindow();
}
