## Why

WaveTerm currently has no UI automated testing. The only E2E test uses TestDriver.ai (CI-only, single onboarding scenario). Manual testing is required for every UI bug fix. Introducing Playwright enables fast, reliable, locally-runnable UI tests for the terminal and core UI components.

## What Changes

- Add `@playwright/test` as dev dependency
- Create Playwright configuration for Electron app testing
- Write E2E test for the recently fixed search + copy-on-select clipboard bug
- Set up a test helper for launching the Electron app (both dev mode and packaged)
- Add npm scripts for running Playwright tests
- Add CI workflow for running Playwright tests on PRs

## Capabilities

### New Capabilities

- `playwright-electron-setup`: Playwright config targeting WaveTerm's Electron app, with launch helpers for dev/packaged modes
- `e2e-search-clipboard`: E2E test coverage for the copy-on-select clipboard behavior when search is open

### Modified Capabilities

- `<existing-name>`: no spec-level requirement changes

## Impact

- `package.json` — new devDependency `@playwright/test`, new scripts
- `playwright.config.ts` — new Playwright configuration file (project root)
- `e2e/` — new directory with test specs and helpers
- `.github/workflows/playwright.yml` — new CI workflow (optional)
