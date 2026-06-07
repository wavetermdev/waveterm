## ADDED Requirements

### Requirement: Backend writes error state on command failure
The shell controller SHALL write `cmd:lasterror` to block meta when a startup command exits with a non-zero exit code. This SHALL only occur when a command (`cmd`) is configured and `runOnStart` was true.

#### Scenario: Command fails with non-zero exit
- **WHEN** the shell controller's managed process exits with exit code 1
- **AND** the block has `meta["cmd"]` set (non-empty)
- **THEN** the system SHALL write `{"cmd:lasterror": "exit code 1"}` to block meta

#### Scenario: Interactive shell exit does not set error
- **WHEN** the shell controller's managed process exits
- **AND** the block has no `cmd` configured (interactive shell)
- **THEN** the system SHALL NOT write `cmd:lasterror`

#### Scenario: Successful command clears error
- **WHEN** the shell controller's managed process exits with exit code 0
- **AND** the block has `meta["cmd"]` set
- **AND** there is an existing `cmd:lasterror` value
- **THEN** the system SHALL clear `cmd:lasterror` from block meta

### Requirement: Frontend displays error state
The term block header SHALL display a visual error indicator when `meta["cmd:lasterror"]` is set.

#### Scenario: Red header icon
- **WHEN** block meta has `"cmd:lasterror"` set to a non-empty string
- **THEN** the block header icon SHALL be rendered in red/warning color

#### Scenario: Tooltip shows error details
- **WHEN** user hovers over the red error icon on the block header
- **THEN** a tooltip SHALL display the error message (e.g., "Command failed: exit code 1")

#### Scenario: Normal color when no error
- **WHEN** block meta has no `"cmd:lasterror"` key or it is empty
- **THEN** the block header icon SHALL render in its normal color

### Requirement: Error state preserves edit access
A block in error state SHALL still allow the user to open the Configure Command dialog and edit settings.

#### Scenario: Edit from error state
- **WHEN** a block is in error state (red header)
- **AND** user right-clicks the block header
- **THEN** the "Configure Command..." menu item SHALL be visible and enabled

### Requirement: Error state cleared on Save & Restart
The error state (`cmd:lasterror`) SHALL be cleared when the user clicks Save & Restart in the Configure Command dialog.

#### Scenario: Clear error on restart
- **WHEN** block has `meta["cmd:lasterror"] = "exit code 1"`
- **AND** user opens Configure Command dialog
- **AND** clicks Save & Restart
- **THEN** the meta update SHALL clear `cmd:lasterror`
- **AND** after restart, the header SHALL return to normal color
