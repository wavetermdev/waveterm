## ADDED Requirements

### Requirement: Search + copy-on-select clipboard test

The system SHALL have an E2E test that verifies the fix for copy-on-select not overwriting clipboard when search is open.

#### Scenario: Clipboard not overwritten during search navigation
- **GIVEN** `term:copyonselect` is enabled
- **WHEN** user opens search (Ctrl+F) and types text
- **WHEN** user navigates through search results
- **THEN** the clipboard SHALL NOT contain the terminal selection text

#### Scenario: Copy-on-select works when search is closed
- **GIVEN** `term:copyonselect` is enabled
- **WHEN** search is closed
- **WHEN** user selects text in the terminal
- **THEN** the clipboard SHALL contain the selected text
