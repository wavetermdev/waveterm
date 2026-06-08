## ADDED Requirements

### Requirement: Attach block to daemon

The system SHALL allow attaching a term block to an existing SessionDaemon via `wsh session attach <name|id> --block <block-id>`.

On attach:
- `Block.Meta["session:daemonid"]` is set to the daemon OID
- `SessionDaemonManager.AttachBlock()` is called
- The block's ControllerResync creates a `SessionDaemonController`
- Frontend `TermWrap.attachToDaemon(jobId)` switches zoneId from `block:{blockId}` to `job:{jobId}`
- The block displays the daemon's terminal output in real time
- The block can send input, which goes through the daemon's InputSessionId

#### Scenario: Attach block to named daemon
- **WHEN** user runs `wsh session attach dev --block block-A`
- **THEN** block-A's `session:daemonid` is set to the daemon's OID
- **AND** the block's controller becomes `SessionDaemonController`
- **AND** the frontend shows the daemon's terminal output

#### Scenario: Attach same block to multiple daemons
- **WHEN** user runs `wsh session attach dev --block block-A`
- **AND** block-A is already attached to daemon `dev`
- **THEN** the system returns an error (block can only attach to one daemon at a time)

### Requirement: Detach block from daemon

The system SHALL allow detaching a block from its SessionDaemon via `wsh session detach --block <block-id>`.

On detach:
- `Block.Meta["session:daemonid"]` is cleared
- `SessionDaemonManager.DetachBlock()` is called
- ControllerResync creates a `ShellController` for local/WSL or a new anonymous daemon for SSH
- Frontend `TermWrap.detachFromDaemon()` switches zoneId back to `block:{blockId}`
- The daemon continues running (unless idle timeout triggers)

#### Scenario: Detach block from daemon
- **WHEN** user runs `wsh session detach --block block-A`
- **AND** block-A is attached to daemon `dev`
- **THEN** block-A's `session:daemonid` is cleared
- **AND** the block reverts to its default controller
- **AND** daemon `dev` continues running (no attached blocks)
