## ADDED Requirements

### Requirement: Save & Restart button writes meta and restarts controller
The dialog SHALL have a "Save & Restart" button. When clicked, it SHALL write the form data to block meta via `SetMetaCommand`, then destroy and recreate the block controller.

#### Scenario: Save and restart flow
- **WHEN** user clicks "Save & Restart"
- **THEN** system SHALL call `SetMetaCommand` with the form field values as meta keys `cmd`, `cmd:runonstart`, `cmd:clearonstart`, `cmd:env`
- **AND** system SHALL call `ControllerDestroyCommand` to kill the current shell process
- **AND** system SHALL call `ControllerResyncCommand({forcerestart: true})` to recreate the controller
- **AND** the dialog SHALL close

#### Scenario: Env vars written as string map
- **WHEN** user has entered environment variables `FOO=bar`
- **AND** clicks Save & Restart
- **THEN** the meta update SHALL include `{"cmd:env": {"FOO": "bar"}}`

#### Scenario: Empty command clears cmd meta
- **WHEN** user clears the Command field
- **AND** clicks Save & Restart
- **THEN** the meta update SHALL include `{"cmd": null}` or equivalent to clear the command
- **AND** the block SHALL restart as an interactive shell (default behavior)

### Requirement: Save & Restart clears error state
When saving, if the block has `cmd:lasterror` set, the meta update SHALL include clearing it.

#### Scenario: Clear error on save
- **WHEN** the block has `meta["cmd:lasterror"] = "exit code 1"`
- **AND** user clicks Save & Restart
- **THEN** the meta update SHALL include `{"cmd:lasterror": null}` or equivalent
- **AND** the block header SHALL return to normal color after restart

### Requirement: Save button disabled during restart
The Save & Restart button SHALL be disabled while the restart is in progress to prevent double-clicks.

#### Scenario: Button disabled during restart
- **WHEN** user clicks Save & Restart
- **THEN** the button SHALL be disabled immediately
- **AND** SHALL remain disabled until the controller finishes restarting (success or failure)
