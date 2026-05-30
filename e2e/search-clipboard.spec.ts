import { ElectronApplication, Page } from "@playwright/test";
import { test, expect } from "@playwright/test";
import { launchApp } from "./helpers/launch";

async function getMainWindow(app: ElectronApplication): Promise<Page> {
    return await app.firstWindow();
}

async function setClipboard(app: ElectronApplication, text: string): Promise<void> {
    await app.evaluate(({ clipboard }, txt) => clipboard.writeText(txt), text);
}

async function readClipboard(app: ElectronApplication): Promise<string> {
    return await app.evaluate(({ clipboard }) => clipboard.readText());
}

test.describe("search + copy-on-select clipboard behavior", () => {
    let app: ElectronApplication;
    let window: Page;

    test.beforeEach(async () => {
        app = await launchApp();
        window = await getMainWindow(app);
    });

    test.afterEach(async () => {
        await app.close();
    });

    test("navigating search results should not overwrite clipboard", async () => {
        await window.waitForTimeout(8000);

        await setClipboard(app, "known-clipboard-content");
        expect(await readClipboard(app)).toBe("known-clipboard-content");

        await window.keyboard.press("Control+f");
        await window.waitForTimeout(1000);

        await window.keyboard.type("test");
        await window.waitForTimeout(1000);

        await window.keyboard.press("Enter");
        await window.waitForTimeout(1000);

        expect(await readClipboard(app)).toBe("known-clipboard-content");
    });
});
