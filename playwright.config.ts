import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    timeout: 90000,
    expect: { timeout: 15000 },
    retries: 0,
    reporter: [["list"], ["html", { outputFolder: "playwright-report" }]],
    outputDir: "test-results/playwright",
});
