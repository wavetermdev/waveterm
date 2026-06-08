## ADDED Requirements

### Requirement: wsh session create

The system SHALL provide a `wsh session create` command.

```
wsh session create --name <name> --connection <conn> [--idle-timeout <seconds>]
```

This command SHALL:
- Create a new named SessionDaemon and persist to DB
- Start a remote job immediately
- Return the daemon OID

### Requirement: wsh session delete

The system SHALL provide a `wsh session delete` command.

```
wsh session delete <name|id>
```

This command SHALL:
- Terminate the associated remote job
- Detach all attached blocks
- Set daemon status to `done`

### Requirement: wsh session list

The system SHALL provide a `wsh session list` command.

```
wsh session list [--all]
```

Without `--all`, only named daemons (IsAnonymous=false) are shown.
With `--all`, anonymous daemons are also shown.

### Requirement: wsh session attach

The system SHALL provide a `wsh session attach` command.

```
wsh session attach <name|id> --block <block-id>
```

### Requirement: wsh session detach

The system SHALL provide a `wsh session detach` command.

```
wsh session detach --block <block-id>
```

### Requirement: wsh session info

The system SHALL provide a `wsh session info` command.

```
wsh session info <name|id>
```

This command SHALL display:
- Name, Status, Connection, CreatedAt
- JobId
- List of currently attached block IDs
- Time remaining before idle timeout (if no blocks attached)

### Requirement: wsh session tag

The system SHALL provide a `wsh session tag` command to convert an anonymous daemon to a named one.

```
wsh session tag <id> --name <name>
```

After tagging, the daemon SHALL:
- Have `Name` set to the provided name
- Have `IsAnonymous=false`
- Have `IdleTimeout` updated to 24h
- Appear in `wsh session list` output

#### Scenario: Tag anonymous daemon
- **WHEN** user runs `wsh session tag sd-abc --name dev`
- **THEN** the daemon's Name is set to `dev`
- **AND** IsAnonymous is set to `false`
- **AND** IdleTimeout is updated to 24h
