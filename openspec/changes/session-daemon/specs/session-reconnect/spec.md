## ADDED Requirements

### Requirement: Reconnect daemon after network recovery

When the network reconnects after a disconnection, the system SHALL automatically attempt to reconnect all SessionDaemons whose status is `running` or `disconnected`.

On reconnection:
- `onConnectionUp` finds all daemons with this connection name
- Calls `daemon.Reconnect()` → `jobcontroller.ReconnectJob()`
- If the remote jobmanager process is still alive, streaming resumes
- If the remote jobmanager is gone (`JobManagerGone: true`), daemon status set to `done`
- All attached blocks resume displaying output from the stream

#### Scenario: Reconnect daemon after transient SSH drop
- **WHEN** the SSH connection drops and re-establishes
- **AND** the daemon status is `disconnected`
- **AND** the remote jobmanager is still alive
- **THEN** the daemon reconnects and streaming resumes
- **AND** attached blocks display the continued output

### Requirement: TerminateOnReconnect for closed blocks

When a block is closed while the network is down, the system SHALL set `TerminateOnReconnect=true` on the associated Job. On reconnection, the remote jobmanager SHALL be terminated instead of reconnected.

This ensures that a user closing a block while offline does not leave a stale remote process.

#### Scenario: Block closed offline, remote cleaned on reconnect
- **WHEN** a user closes a block while the SSH connection is down
- **THEN** `TerminateOnReconnect=true` is persisted in the DB
- **WHEN** the network reconnects
- **THEN** the jobmanager is terminated via SIGTERM
- **AND** no orphaned processes remain on the remote side

### Requirement: Restart recovery

When WaveTerm restarts, `SessionDaemonManager.InitFromDB()` SHALL:
1. Load all daemons with status `running` or `disconnected` from DB
2. For each, call `jobcontroller.ReconnectJob()` to reconnect
3. Blocks with `session:daemonid` pointing to a daemon that no longer exists SHALL have their `session:daemonid` cleared and trigger a new ControllerResync

#### Scenario: Restart with active daemon
- **WHEN** WaveTerm restarts
- **AND** a daemon has status `running` in DB
- **THEN** InitFromDB() loads the daemon and reconnects
- **AND** attached blocks display the resumed output

#### Scenario: Restart with stale daemonid
- **WHEN** WaveTerm restarts
- **AND** a block has `session:daemonid` pointing to a non-existent daemon
- **THEN** the daemonid is cleared
- **AND** the block falls back to its default controller
