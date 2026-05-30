## 1. Setup

- [x] 1.1 Install Playwright and Electron support: `npm install -D @playwright/test` and install Electron support
- [x] 1.2 Create `playwright.config.ts` with Electron launch configuration
- [x] 1.3 Create `e2e/helpers/launch.ts` — shared helper for launching WaveTerm app

## 2. Test Implementation

- [x] 2.1 Write `e2e/search-clipboard.spec.ts` — search + copy-on-select clipboard test
- [x] 2.2 Verify test passes against a packaged build

## 3. Integration

- [x] 3.1 Add npm scripts: `npm run test:e2e` and `npm run test:e2e:build`
- [x] 3.2 Create `.github/workflows/playwright.yml` CI workflow
