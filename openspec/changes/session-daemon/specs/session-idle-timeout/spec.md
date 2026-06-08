## ADDED Requirements

### Requirement: Idle timeout for anonymous daemons

An anonymous SessionDaemon (`IsAnonymous=true`) SHALL have a default `IdleTimeout` of 3600 seconds (1 hour).

When the last block is detached:
- A countdown timer starts for `IdleTimeout`
- If a block re-attaches before timeout, the timer is cancelled
- If the timer expires, `TerminateAndDetachJob` is called on the associated job
- Daemon status is set to `done`
- The daemon is removed from SessionDaemonManager

#### Scenario: Anonymous daemon auto-reclaim
- **WHEN** the last block is detached from an anonymous daemon
- **AND** no block re-attaches within 1 hour
- **THEN** the daemon is terminated and status set to `done`

#### Scenario: Re-attach cancels timer
- **WHEN** the last block is detached from an anonymous daemon
- **AND** a block re-attaches within 1 hour
- **THEN** the idle timer is cancelled
- **AND** the daemon continues running

### Requirement: Idle timeout for named daemons

A named SessionDaemon (`IsAnonymous=false`) SHALL have a default `IdleTimeout` of 86400 seconds (24 hours).

The same timer mechanism applies. Named daemons have a longer timeout because they are intentionally created by the user.

#### Scenario: Named daemon idle timeout
- **WHEN** all blocks are detached from a named daemon
- **AND** no block re-attaches within 24 hours
- **THEN** the daemon is terminated and status set to `done`

### Requirement: Configurable idle timeout

The system SHALL allow overriding `IdleTimeout` on daemon creation via `--idle-timeout <seconds>` flag.

#### Scenario: Custom idle timeout
- **WHEN** user runs `wsh session create --name dev --connection ssh:host --idle-timeout 7200`
- **THEN** the daemon's IdleTimeout is set to 7200 seconds (2 hours)
