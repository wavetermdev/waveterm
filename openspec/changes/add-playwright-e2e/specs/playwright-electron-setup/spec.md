## ADDED Requirements

### Requirement: Playwright configuration for Electron

The system SHALL provide a Playwright configuration that can launch the WaveTerm Electron app for testing.

#### Scenario: Dev mode launch
- **WHEN** running `npx playwright test` in dev mode
- **THEN** the test framework SHALL launch WaveTerm via `electron-vite dev`
- **AND** wait for the app window to be ready before running tests

#### Scenario: Packaged app launch
- **WHEN** running Playwright against a packaged build
- **THEN** the test framework SHALL launch the Wave.exe binary directly
- **AND** wait for the window to be ready

### Requirement: Test organization

E2E tests SHALL be organized in an `e2e/` directory at the project root, with shared helpers in `e2e/helpers/`.

#### Scenario: Directory structure
- **WHEN** viewing the `e2e/` directory
- **THEN** it SHALL contain spec files and a `helpers/` subdirectory with launch utilities
