# SSH Port Forwarding Implementation Spec

## Problem

Wave Terminal parses `~/.ssh/config` for connection settings but ignores `LocalForward`, `RemoteForward`, and `DynamicForward` directives. Users who define port forwarding rules in their SSH config get no forwarding when connecting through Wave.

## Scope

- **In scope**: `LocalForward` and `RemoteForward` parsed from `~/.ssh/config` and `connections.json`
- **Out of scope**: `DynamicForward` (requires SOCKS5 handler not in stdlib), CLI flags on `wsh ssh`, UI status indicators

## Current Architecture

```
~/.ssh/config  ──┐
                  │
connections.json ─┼──→ findSshConfigKeywords() / ConnKeywords struct
                  │
wsh ssh flags    ─┘
                     │
                     ▼
              ConnectToClient() — merges keywords, creates *ssh.Client
                     │
                     ▼
              SSHConn.connectInternal() — stores client, starts monitor/wsh
                     │
                     ▼
              SSHConn.Close() — tears down client, monitor, domain socket
```

The merged `ConnKeywords` are consumed inside `ConnectToClient()` to build `ssh.ClientConfig` and are **never returned** to the caller. `conncontroller` only receives `connFlags` (CLI/frontend flags), not the full merged config.

## Changes

### 1. `pkg/wconfig/settingsconfig.go` — ConnKeywords struct

Add two fields to `ConnKeywords`:

```go
SshLocalForward  []string `json:"ssh:localforward,omitempty"`
SshRemoteForward []string `json:"ssh:remoteforward,omitempty"`
```

Placement: after `SshGlobalKnownHostsFile`, before the closing `}`.

### 2. `pkg/remote/sshclient.go` — Config parsing

#### 2a. `findSshConfigKeywords()` — Parse from `~/.ssh/config`

Add after the `GlobalKnownHostsFile` parsing block (before the `return`):

```go
localForwardRaw := WaveSshConfigUserSettings().GetAll(hostPattern, "LocalForward")
for i := 0; i < len(localForwardRaw); i++ {
    localForwardRaw[i] = trimquotes.TryTrimQuotes(localForwardRaw[i])
}
sshKeywords.SshLocalForward = localForwardRaw

remoteForwardRaw := WaveSshConfigUserSettings().GetAll(hostPattern, "RemoteForward")
for i := 0; i < len(remoteForwardRaw); i++ {
    remoteForwardRaw[i] = trimquotes.TryTrimQuotes(remoteForwardRaw[i])
}
sshKeywords.SshRemoteForward = remoteForwardRaw
```

This follows the exact pattern used for `IdentityFile` (multi-value keyword via `GetAll` + quote trimming).

#### 2b. `findSshDefaults()` — Default values

Add to the defaults function:

```go
sshKeywords.SshLocalForward = []string{}
sshKeywords.SshRemoteForward = []string{}
```

#### 2c. `mergeKeywords()` — Cascade merging

Add to the merge function (follows the `SshProxyJump` pattern):

```go
if newKeywords.SshLocalForward != nil {
    outKeywords.SshLocalForward = newKeywords.SshLocalForward
}
if newKeywords.SshRemoteForward != nil {
    outKeywords.SshRemoteForward = newKeywords.SshRemoteForward
}
```

#### 2d. `ConnectToClient()` — Return merged keywords

Change the signature from:

```go
func ConnectToClient(connCtx context.Context, opts *SSHOpts, currentClient *ssh.Client, jumpNum int32, connFlags *wconfig.ConnKeywords) (*ssh.Client, int32, error)
```

To:

```go
func ConnectToClient(connCtx context.Context, opts *SSHOpts, currentClient *ssh.Client, jumpNum int32, connFlags *wconfig.ConnKeywords) (*ssh.Client, int32, *wconfig.ConnKeywords, error)
```

The `sshKeywords` variable already exists at the point of the final return. Change all return statements:

- `return nil, jumpNum, ConnectionError{...}` → `return nil, jumpNum, nil, ConnectionError{...}`
- `return client, debugInfo.JumpNum, nil` → `return client, debugInfo.JumpNum, sshKeywords, nil`
- `return nil, debugInfo.JumpNum, ConnectionError{...}` → `return nil, debugInfo.JumpNum, nil, ConnectionError{...}`

### 3. `pkg/remote/conncontroller/conncontroller.go` — Runtime forwarding

#### 3a. `SSHConn` struct — Store forwarding state

Add fields:

```go
LocalForwardListeners []net.Listener        // local listeners for LocalForward
RemoteForwardListeners []net.Listener       // remote listeners (from client.Listen) for RemoteForward
```

#### 3b. `copyBoth` helper (unexported)

Add near the `startPortForwarding` method (same file, package-private):

```go
func copyBoth(a net.Conn, b net.Conn) {
    var wg sync.WaitGroup
    wg.Add(2)
    go func() {
        defer wg.Done()
        io.Copy(a, b)
    }()
    go func() {
        defer wg.Done()
        io.Copy(b, a)
    }()
    wg.Wait()
    a.Close()
    b.Close()
}
```

#### 3c. Forwarding setup function

Add a new unexported method:

```go
func (conn *SSHConn) startPortForwarding(ctx context.Context, keywords *wconfig.ConnKeywords) {
    client := conn.GetClient()
    if client == nil {
        return
    }

    // LocalForward: listen locally, dial through SSH to remote
    for _, fwd := range keywords.SshLocalForward {
        parts := strings.Fields(fwd)
        if len(parts) != 2 {
            conn.Infof(ctx, "LocalForward: skipping malformed rule: %q\n", fwd)
            continue
        }
        bindAddr, dest := parts[0], parts[1]
        go func() {
            defer panichandler.PanicHandler("conncontroller:localforward", recover())
            listener, err := net.Listen("tcp", bindAddr)
            if err != nil {
                conn.Infof(ctx, "LocalForward %s: failed to listen: %v\n", fwd, err)
                return
            }
            conn.WithLock(func() {
                conn.LocalForwardListeners = append(conn.LocalForwardListeners, listener)
            })
            conn.Infof(ctx, "LocalForward started: %s -> %s\n", bindAddr, dest)
            for {
                localConn, err := listener.Accept()
                if err != nil {
                    return
                }
                go func(dest string) {
                    defer panichandler.PanicHandler("conncontroller:localforward-tunnel", recover())
                    remoteConn, err := client.Dial("tcp", dest)
                    if err != nil {
                        localConn.Close()
                        return
                    }
                    copyBoth(localConn, remoteConn)
                }(dest)
            }
        }()
    }

    // RemoteForward: listen on remote via SSH, dial locally
    for _, fwd := range keywords.SshRemoteForward {
        parts := strings.Fields(fwd)
        if len(parts) != 2 {
            conn.Infof(ctx, "RemoteForward: skipping malformed rule: %q\n", fwd)
            continue
        }
        bindAddr, dest := parts[0], parts[1]
        go func() {
            defer panichandler.PanicHandler("conncontroller:remoteforward", recover())
            listener, err := client.Listen("tcp", bindAddr)
            if err != nil {
                conn.Infof(ctx, "RemoteForward %s: failed to listen: %v\n", fwd, err)
                return
            }
            conn.WithLock(func() {
                conn.RemoteForwardListeners = append(conn.RemoteForwardListeners, listener)
            })
            conn.Infof(ctx, "RemoteForward started: %s -> %s\n", bindAddr, dest)
            for {
                remoteConn, err := listener.Accept()
                if err != nil {
                    return
                }
                go func(dest string) {
                    defer panichandler.PanicHandler("conncontroller:remoteforward-tunnel", recover())
                    localConn, err := net.Dial("tcp", dest)
                    if err != nil {
                        remoteConn.Close()
                        return
                    }
                    copyBoth(localConn, remoteConn)
                }(dest)
            }
        }()
    }
}
```

Notes:
- Follows the existing goroutine pattern: `defer panichandler.PanicHandler("...", recover())`
- Listeners are stored on the struct via `conn.WithLock` for cleanup
- Uses `conn.Infof` for debug logging (consistent with existing connection debug output)
- `copyBoth` (unexported helper) for bidirectional tunneling (spawns two `io.Copy` goroutines, waits for both, then closes both connections)

#### 3d. `connectInternal()` — Call forwarding setup

Change the `ConnectToClient` call to capture the merged keywords:

```go
client, _, sshKeywords, err := remote.ConnectToClient(ctx, conn.Opts, nil, 0, connFlags)
```

After the client is stored and the monitor is started, add:

```go
// Start port forwarding with merged SSH config keywords
if sshKeywords != nil {
    conn.startPortForwarding(ctx, sshKeywords)
}
```

Placement: after the `conn.WithLock` block that sets `conn.Client` and `conn.Monitor`, before the `waitForDisconnect` goroutine.

#### 3e. `closeInternal_withlifecyclelock()` — Cleanup

Add forwarding listener capture alongside the existing `oldListener` capture, then close them in the cleanup goroutine:

```go
var oldLocalForwardListeners []net.Listener
var oldRemoteForwardListeners []net.Listener
conn.WithLock(func() {
    // ... existing oldClient, oldListener, oldController, oldMonitor capture ...
    oldLocalForwardListeners = conn.LocalForwardListeners
    conn.LocalForwardListeners = nil
    oldRemoteForwardListeners = conn.RemoteForwardListeners
    conn.RemoteForwardListeners = nil
})

// In the cleanup goroutine (after oldMonitor.Close()):
for _, l := range oldLocalForwardListeners {
    l.Close()
}
for _, l := range oldRemoteForwardListeners {
    l.Close()
}
```

This follows the existing pattern: references are captured and nilled under `conn.WithLock` (protected by the `expectedClient` stale-goroutine guard), then closed in the background goroutine so `lifecycleLock` is freed immediately.

### 4. Call site updates

Every caller of `remote.ConnectToClient` must handle the new 4th return value.

#### `pkg/remote/conncontroller/conncontroller.go`

Already covered in 3c above.

#### `cmd/test-conn/main-test-conn.go`

No direct `ConnectToClient` calls in `cmd/test-conn/` — it uses `conn.Connect()` → `connectInternal()` → `ConnectToClient()` indirectly. No changes needed.

#### Other direct call sites

Run `grep -rn "ConnectToClient" --include="*.go" .` to find any direct callers. As of this spec, only these direct calls exist:
- `pkg/remote/sshclient.go` — the function definition and the recursive ProxyJump call
- `pkg/remote/conncontroller/conncontroller.go` — `connectInternal`

The recursive ProxyJump call (line ~1057) should capture the returned keywords with `_` since proxy connections don't need forwarding.

### 5. Tests

#### `pkg/remote/sshclient_test.go` (new file)

Table-driven tests for config parsing. No network required.

```go
package remote

import "testing"

func TestFindSshConfigKeywords_LocalForward(t *testing.T) {
    t.Parallel()
    // Uses a temp ~/.ssh/config with LocalForward directives
    // Verifies SshLocalForward is populated correctly
}

func TestMergeKeywords_LocalForward(t *testing.T) {
    t.Parallel()
    tests := []struct {
        name     string
        old      *wconfig.ConnKeywords
        new      *wconfig.ConnKeywords
        wantLocal []string
        wantRemote []string
    }{
        {
            name: "new overrides old",
            old:  &wconfig.ConnKeywords{SshLocalForward: []string{"8080 localhost:80"}},
            new:  &wconfig.ConnKeywords{SshLocalForward: []string{"9090 localhost:90"}},
            wantLocal: []string{"9090 localhost:90"},
        },
        {
            name: "nil new preserves old",
            old:  &wconfig.ConnKeywords{SshLocalForward: []string{"8080 localhost:80"}},
            new:  &wconfig.ConnKeywords{},
            wantLocal: []string{"8080 localhost:80"},
        },
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := mergeKeywords(tt.old, tt.new)
            // assert got.SshLocalForward matches tt.wantLocal
        })
    }
}
```

#### `pkg/remote/conncontroller/conncontroller_test.go` (new file)

Integration-style test using `net.Listener` (no real SSH):

```go
package conncontroller

func TestLocalForwardStartsAndStops(t *testing.T) {
    // Create a mock SSHConn with a real net.Listener as the "remote"
    // Verify LocalForward listener is created on startPortForwarding
    // Verify it's closed on closeInternal_withlifecyclelock
}
```

This follows the `sshagent_unix_test.go` pattern: real sockets, no SSH daemon.

### 6. Documentation

#### `docs/docs/connections.mdx`

**SSH Config Parsing table** — Add rows:

| Keyword | Description |
|---------|-------------|
| LocalForward | Can be specified multiple times. Format: `bind_address destination` (e.g., `8080 localhost:80` or `127.0.0.1:8080 localhost:80`). Listens on the local machine and forwards connections through the SSH tunnel to the remote destination. |
| RemoteForward | Can be specified multiple times. Format: `bind_address destination` (e.g., `9090 localhost:3000`). Listens on the remote machine and forwards connections back to the local destination. Requires `AllowTcpForwarding` on the remote sshd. |

**Internal SSH Configuration table** — Add rows:

| Keyword | Description |
|---------|-------------|
| ssh:localforward | A list of strings for local port forwarding rules. Format: `"8080 localhost:80"`. Can be used to override or supplement `~/.ssh/config` values. |
| ssh:remoteforward | A list of strings for remote port forwarding rules. Format: `"9090 localhost:3000"`. Can be used to override or supplement `~/.ssh/config` values. |

**New example section** after "Example SSH Config Host":

```markdown
### Port Forwarding

Port forwarding rules from `~/.ssh/config` are automatically applied when you connect through Wave:

```
Host myserver
   User username
   HostName 203.0.113.254
   LocalForward 8080 localhost:80
   RemoteForward 9090 localhost:3000
```

Connecting to `myserver` will listen on local port 8080 (forwarded to the remote's localhost:80) and listen on the remote's port 9090 (forwarded to your local localhost:3000).

Port forwarding can also be defined entirely in `connections.json`:

```json
{
    "myusername@myhost": {
        "ssh:localforward": ["8080 localhost:80"],
        "ssh:remoteforward": ["9090 localhost:3000"]
    }
}
```
```

#### `docs/docs/releasenotes.mdx`

Add entry under the current development version.

## Error Handling

- Malformed forwarding rules (wrong number of fields) are logged via `conn.Infof` and skipped — they never break the connection
- Listener bind failures (port already in use) are logged — the connection proceeds without that specific forward
- Tunnel dial failures log and close the individual connection — other tunnels and the SSH session continue
- All forwarding goroutines use `panichandler.PanicHandler` to prevent crashes from propagating

## Lifecycle

| Event | Action |
|-------|--------|
| Connect starts | `ConnectToClient` returns merged keywords including forwarding rules |
| Client established | `startPortForwarding` spawns goroutines, stores listeners on `SSHConn` |
| Connection active | Tunnels run via `copyBoth`; SSH transport activity keeps connection alive |
| Disconnect starts | `closeInternal_withlifecyclelock` closes all forwarding listeners under `lifecycleLock` |
| Client closes | `client.Close()` tears down remote listeners and all in-flight tunnels |

## Out of Scope (Future)

- **`DynamicForward`** — Requires a SOCKS5 proxy handler. The `golang.org/x/crypto/ssh` library has no built-in one. Would need a third-party package or custom ~200-line SOCKS5 implementation.
- **`wsh ssh -L` / `-R` CLI flags** — Can be added to `wshcmd-ssh.go` later, following the existing `-i`/`-l`/`-p` flag pattern.
- **UI status indicator** — A block header icon showing active port forwards (similar to the wsh icon).
- **`GatewayPorts`** support — The `ssh` keyword for binding remote forwards to all interfaces.
