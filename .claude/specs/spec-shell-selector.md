# Shell Selector Feature Specification

## Problem Statement

The current architecture conflates two fundamentally different concepts:

1. **Connections**: Remote hosts you SSH into (actual network connections)
2. **Shell Profiles**: Local shell binaries that get spawned (not connections)

This creates UX confusion:
- "Sebastian@Workstation" appears alongside "wsl://Ubuntu" and "pwsh-7.5" in the same dropdown
- WSL, cmd, pwsh, git-bash are treated as "connections" when they're just shells
- The connection status icon (connected/disconnected) makes no sense for local shells
- Users don't "connect" to PowerShell - they just run it

## Key Insight

**Shells are NOT connections:**

| Concept | What it is | Examples | Has network state? |
|---------|------------|----------|-------------------|
| **Shell** | A local process that runs a shell binary | cmd, pwsh, bash, git-bash, wsl | No |
| **Connection** | A remote host accessed over network | SSH remotes | Yes |

Even WSL is just a spawned process - it's not a "connection" in the traditional sense. You don't connect/disconnect from WSL, you just run it.

## Proposed Architecture

### Data Model

```typescript
// NEW: Shell profiles are their own concept
interface ShellProfile {
    id: string;                    // "pwsh-7.5", "cmd", "wsl:Ubuntu"
    displayName: string;           // "PowerShell 7.5", "CMD", "Ubuntu"
    icon: string;                  // "terminal", "brands@linux", "brands@windows"
    shellPath: string;             // "C:\Program Files\PowerShell\7\pwsh.exe"
    shellOpts?: string[];          // ["-NoLogo"]
    isWsl?: boolean;               // true for WSL distros
    wslDistro?: string;            // "Ubuntu" for WSL
    isDefault?: boolean;           // true if this is the default shell
}

// EXISTING: Connections are only for remote hosts
interface Connection {
    name: string;                  // "myserver.example.com"
    // SSH settings...
}
```

### UI Changes

#### 1. Terminal Block Header

**Current:**
```
[laptop icon] [dropdown: Sebastian@Workstation | wsl://Ubuntu | pwsh-7.5 | cmd | ...]
```

**Proposed:**
```
[shell icon] PowerShell 7.5   [gear icon for settings]
```

- Show the **current shell name** directly (no dropdown needed for display)
- Click to open shell selector (not connection selector)
- No connection status indicator for local shells

#### 2. Shell Selector Modal

A NEW modal specifically for selecting shells (not connections):

```
┌─────────────────────────────────────────────────┐
│  Select Shell                              [×]  │
├─────────────────────────────────────────────────┤
│  ★ PowerShell 7.5           (default)           │
│    Windows PowerShell                           │
│    CMD                                          │
│    Git Bash                                     │
│  ─────────────────                              │
│  WSL Distributions                              │
│    Ubuntu                                       │
│    Debian                                       │
│  ─────────────────                              │
│  [+ Add Shell Profile]                          │
└─────────────────────────────────────────────────┘
```

Features:
- Groups: Windows Shells, WSL Distributions
- Default shell indicator (★)
- Icons for each shell type
- No connection status (these are all local)
- WSL distros shown without "wsl://" prefix

#### 3. Connection Selector (Existing, Simplified)

The connection dropdown becomes ONLY for remote hosts:

```
┌─────────────────────────────────────────────────┐
│  Connect to Remote                         [×]  │
├─────────────────────────────────────────────────┤
│  Recent                                         │
│    server1.example.com          [connected]     │
│    server2.example.com          [disconnected]  │
│  ─────────────────                              │
│  [+ Add Connection]                             │
└─────────────────────────────────────────────────┘
```

### Settings Changes

#### New Settings

```json
{
    "shell:default": "pwsh-7.5",           // Default shell profile ID
    "shell:profiles": {                     // Custom shell profiles
        "pwsh-7.5": {
            "display:name": "PowerShell 7.5",
            "shell:path": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
            "shell:opts": ["-NoLogo"]
        }
    }
}
```

#### Deprecated Settings (migrate)

- `term:localshellpath` → `shell:default` + `shell:profiles`
- `conn:local` connections → `shell:profiles`

### Block Metadata Changes

```typescript
// Terminal block metadata
interface TerminalBlockMeta {
    // NEW: Shell profile for this terminal
    "shell:profile"?: string;      // "pwsh-7.5", "cmd", "wsl:Ubuntu"

    // EXISTING: Connection (only for SSH remotes)
    "connection"?: string;         // "user@server.example.com"
}
```

When `shell:profile` is set, use that shell.
When `connection` is set, SSH to that remote.
When neither is set, use default shell.

### Migration Path

1. **Phase 1**: Add new shell selector UI alongside existing connection dropdown
2. **Phase 2**: Migrate existing `conn:local` and `conn:shellpath` settings to new `shell:profiles`
3. **Phase 3**: Remove shell profiles from connection dropdown
4. **Phase 4**: Clean up deprecated settings

### File Changes

| File | Change |
|------|--------|
| `pkg/wconfig/settingsconfig.go` | Add `ShellDefault`, `ShellProfiles` |
| `pkg/wconfig/metaconsts.go` | Add shell setting keys |
| `schema/settings.json` | Add shell settings schema |
| `frontend/types/gotypes.d.ts` | Generate new types |
| `frontend/app/store/settings-registry.ts` | Add shell settings |
| `frontend/app/block/blockutil.tsx` | New ShellButton component |
| `frontend/app/modals/shellselector.tsx` | NEW: Shell selector modal |
| `frontend/app/modals/conntypeahead.tsx` | Remove local shells |
| `pkg/blockcontroller/shellcontroller.go` | Use shell:profile metadata |

## Acceptance Criteria

- [ ] Shell profiles are a separate concept from connections
- [ ] Terminal header shows current shell name (not connection)
- [ ] Shell selector modal shows grouped shells (Windows, WSL)
- [ ] WSL distros display without "wsl://" prefix
- [ ] No connection status indicators for local shells
- [ ] Default shell can be configured
- [ ] Existing settings migrate gracefully
- [ ] Connection dropdown only shows SSH remotes
- [ ] File browser connection dropdown unaffected (still needs filesystem distinction)

## Out of Scope

- This spec does NOT change how the file browser connection selector works
  (it still needs to distinguish filesystems: Windows vs WSL vs SSH)
- Remote SSH terminal functionality unchanged
- S3/cloud storage connections unchanged

## Design Questions

1. Should WSL distros be auto-detected or manually configured?
2. Should we support custom shell profile icons?
3. How to handle "reconnect" for WSL if it crashes?
