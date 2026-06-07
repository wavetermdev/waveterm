## ADDED Requirements

### Requirement: Command Config Dialog opens from context menu
The system SHALL provide a "Configure Command..." menu item in the context menu Advanced submenu that opens a modal dialog for editing term block startup command settings.

#### Scenario: Open Configure Command dialog
- **WHEN** user right-clicks on a term block header
- **AND** navigates to Advanced submenu
- **AND** clicks "Configure Command..."
- **THEN** a modal dialog titled "Configure Command" SHALL open

#### Scenario: All blocks show the menu item
- **WHEN** user right-clicks on any term block (running, stopped, or errored)
- **THEN** the "Configure Command..." menu item SHALL be visible and enabled

### Requirement: Dialog contains edit fields
The dialogue SHALL contain a textarea for "Command", a checkbox for "Run on startup", a checkbox for "Clear output on start", and a textarea for "Environment variables".

#### Scenario: Dialog layout
- **WHEN** the "Configure Command" dialog opens
- **THEN** it SHALL display four fields:
  - "Command": a multi-line textarea (monospace font, 8 rows height)
  - "Run on startup": a checkbox (default checked)
  - "Clear output on start": a checkbox (default unchecked)
  - "Environment Variables": a multi-line textarea (monospace font, 4 rows height, `KEY=VALUE` per line)

### Requirement: Dialog initial values from block meta
The dialog SHALL populate its fields from the block's current meta keys (`cmd`, `cmd:runonstart`, `cmd:clearonstart`, `cmd:env`).

#### Scenario: Populate from meta
- **WHEN** the dialog opens
- **AND** the block has `meta["cmd"] = "ls -la"`, `meta["cmd:runonstart"] = true`, `meta["cmd:clearonstart"] = false`, `meta["cmd:env"] = {"MY_VAR": "hello"}`
- **THEN** the Command field SHALL show "ls -la"
- **AND** "Run on startup" SHALL be checked
- **AND** "Clear output on start" SHALL be unchecked
- **AND** "Environment Variables" SHALL show "MY_VAR=hello"

#### Scenario: Defaults when meta is absent
- **WHEN** the dialog opens
- **AND** the block has no `cmd:*` meta keys set
- **THEN** the Command field SHALL be empty
- **AND** "Run on startup" SHALL be checked (default)
- **AND** "Clear output on start" SHALL be unchecked (default)
- **AND** the Environment Variables field SHALL be empty

### Requirement: Environment variables format validation
The dialog SHALL parse environment variables as `KEY=VALUE` per line, ignoring blank lines and `#` comment lines.

#### Scenario: Valid env format
- **WHEN** user types in Environment Variables:
  ```
  FOO=bar
  # this is a comment

  BAZ=qux
  ```
- **THEN** the dialog SHALL accept these and prepare meta `{"FOO": "bar", "BAZ": "qux"}`

#### Scenario: Invalid env format
- **WHEN** user types in Environment Variables: `invalid_line_without_equals`
- **THEN** the dialog SHALL show an inline validation error "Invalid format: use KEY=VALUE per line"

### Requirement: Cancel button closes dialog without changes
The dialog SHALL have a Cancel button that closes the dialog without modifying any state.

#### Scenario: Cancel
- **WHEN** the dialog is open
- **AND** user has modified fields
- **AND** user clicks Cancel
- **THEN** the dialog SHALL close
- **AND** no meta changes SHALL be written
- **AND** no controller restart SHALL occur
