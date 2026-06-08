## ADDED Requirements

### Requirement: Auto-create daemon on SSH block start

When a term block is created with an SSH connection and has no `session:daemonid` meta, the system SHALL automatically create an anonymous SessionDaemon.

The flow:
1. `ControllerResync` detects SSH connection, no `session:daemonid`
2. Creates anonymous `SessionDaemon` (IsAnonymous=true, IdleTimeout=1h)
3. Writes `session:daemonid` to block meta
4. Triggers `ControllerResync` again
5. Second round detects `session:daemonid` → creates `SessionDaemonController`
6. `SessionDaemonController.Start()` → `daemon.EnsureStarted()` → `jobcontroller.StartJob()`

#### Scenario: New SSH block creates anonymous daemon
- **WHEN** a user opens a new term block with an SSH connection
- **AND** the block has no `session:daemonid`
- **THEN** an anonymous SessionDaemon is created
- **AND** the block's controller becomes SessionDaemonController
- **AND** a remote job is started
- **AND** the user sees the terminal normally

#### Scenario: Existing daemonid skips creation
- **WHEN** a user opens a term block
- **AND** `block.Meta["session:daemonid"]` is already set
- **THEN** the system uses the existing daemon directly (no auto-creation)

#### Scenario: Local/WSL block does not create daemon
- **WHEN** a user opens a term block with a local or WSL connection
- **THEN** the system uses ShellController directly
- **AND** no SessionDaemon is created
