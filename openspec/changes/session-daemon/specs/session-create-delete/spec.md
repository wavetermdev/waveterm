## ADDED Requirements

### Requirement: Create named SessionDaemon

The system SHALL allow a user to create a named SessionDaemon via `wsh session create --name <name> --connection <conn>`.

A named SessionDaemon SHALL:
- Have a globally unique `Name` (conflict appends timestamp suffix like `dev-150623`)
- Have `IsAnonymous=false`
- Have `IdleTimeout=86400` (24h) by default
- Be persisted to DB with status `init`
- Start a remote job immediately via `jobcontroller.StartJob()`
- Transition to `running` when the remote JobManager confirms startup

#### Scenario: Create named daemon successfully
- **WHEN** user runs `wsh session create --name dev --connection ssh:user@host`
- **THEN** a SessionDaemon record is created in DB with status `init`
- **AND** a remote job is started
- **AND** status transitions to `running`
- **AND** the daemon is registered in SessionDaemonManager

#### Scenario: Create daemon with duplicate name
- **WHEN** user runs `wsh session create --name dev --connection ssh:host1`
- **AND** a daemon named `dev` already exists
- **THEN** the system creates with name `dev-<timestamp>` and notifies the user

### Requirement: Create anonymous SessionDaemon

The system SHALL automatically create an anonymous SessionDaemon when a new SSH block is started without a `session:daemonid`.

An anonymous SessionDaemon SHALL:
- Have `Name=""` and `IsAnonymous=true`
- Have `IdleTimeout=3600` (1h) by default
- Be invisible to `wsh session list` by default (unless `--all` flag)
- Be upgradable to named via `wsh session tag <id> --name <name>`

#### Scenario: Auto-create anonymous daemon
- **WHEN** a user opens a new SSH term block
- **AND** the block has no `session:daemonid` meta
- **THEN** an anonymous SessionDaemon is created and attached to the block
- **AND** the process is transparent to the user (no UI indication)

### Requirement: Delete SessionDaemon

The system SHALL allow deleting a SessionDaemon via `wsh session delete <name|id>`.

Deletion SHALL:
- Call `TerminateAndDetachJob` on the associated job
- Detach all currently attached blocks (clear their `session:daemonid`)
- Set daemon status to `done`
- Remove daemon from SessionDaemonManager

#### Scenario: Delete daemon
- **WHEN** user runs `wsh session delete dev`
- **THEN** the remote job is terminated
- **AND** all attached blocks have their `session:daemonid` cleared
- **AND** daemon status is set to `done`
