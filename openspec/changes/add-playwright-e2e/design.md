## Context

WaveTerm's UI testing is limited to a single TestDriver.ai onboarding scenario that runs only in CI. For the copy-on-select fix and future UI changes, we need fast, local, reliable E2E tests. Playwright with Electron support is the standard choice.

## Goals / Non-Goals

**Goals:**
- Add Playwright with Electron support as dev dependency
- Create a config that works with both dev mode (`electron-vite dev`) and packaged app
- Write a test verifying the search + copy-on-select clipboard fix
- Ensure tests can run locally without CI dependencies

**Non-Goals:**
- Full UI coverage of all features (future work)
- Replacing existing TestDriver.ai tests
- Testing backend/Go code

## Decisions

**Decision: Launch Electron app via direct binary for testing**

Use Playwright's `_electron.launch()` with the packaged app executable. This avoids the complexity of hooking into `electron-vite dev` hot-reload.

For local development, users can run `task package -- --win --x64 --config.win.target=zip` to produce a portable build, then run tests against it.

- Alternative considered: Launching via `electron-vite dev` — harder to detect ready state, slower
- Alternative considered: Using `electron-vite preview` — still requires a build step

**Decision: No global test fixtures for now**

Keep tests self-contained with a shared launch helper. Avoid complex fixture setup until more tests exist.

**Decision: Tests in `e2e/` at project root**

Follow Playwright conventions. Place in `e2e/` not `frontend/e2e/` since tests cover the full Electron app.

## Risks / Trade-offs

- **Build needed**: Tests require a packaged build first (can be automated in CI)
- **Windows focus**: Initial setup targets Windows (current platform); other platforms can be added later
- **No hot reload**: Unlike TestDriver.ai, Playwright tests launch the full app binary
