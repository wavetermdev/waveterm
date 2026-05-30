## ADDED Requirements

### Requirement: Prevent clipboard overwrite when search is open

When search is active and `term:copyonselect` is enabled, navigating search results MUST NOT trigger clipboard writes.

#### Scenario: Search navigation does not overwrite clipboard
- **WHEN** search bar is open with results
- **WHEN** user navigates through search results (Enter/Prev/Next)
- **THEN** `navigator.clipboard.writeText()` MUST NOT be called for the programmatic selection change

#### Scenario: Manual terminal selection still copies on select
- **WHEN** search bar is open
- **WHEN** user manually selects text in the terminal (via mouse drag)
- **THEN** copy-on-select SHOULD still copy the selected text to clipboard
