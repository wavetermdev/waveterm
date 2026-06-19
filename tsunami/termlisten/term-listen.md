# OSC Terminal Listen Protocol

## Problem

Wave's tsunami feature (and general port forwarding) currently requires either a Wave-managed SSH connection or `AllowTcpForwarding yes` on the remote host. Both can be unavailable — locked-down SSH servers, plain `ssh` sessions not managed by Wave, or cases where wsh isn't installed on the remote box.

The OSC listen protocol solves this by letting a remote process proxy a TCP listener through the terminal itself, with no SSH tunnel required.

---

## Philosophy

Rather than inventing a new protocol, this design maps Unix socket primitives directly onto OSC messages. The calls — `accept`, `read`, `write`, `close` — are intentionally the same operations as the C stdlib / POSIX socket API. Blocking semantics, EOF signaling, cancellation via close, flow control via blocking writes: all of it follows what Unix already figured out.

This keeps the protocol unsurprising. Anyone who has written socket code knows the contract. It also means the remote SDK is thin — it just exposes a `net.Listener` / `net.Conn` interface backed by OSC, and any existing HTTP server code runs on top unchanged.

## Core Idea

The remote process asks the local terminal (Wave) to open an ephemeral TCP port on the user's machine. Connections to that local port are forwarded to the remote process as byte streams over OSC sequences and stdin injection. The remote process never opens a real TCP port — it just services connections through the terminal.

This works over any terminal connection: managed SSH, plain `ssh`, serial, anything. The only requirement is that the terminal understands the protocol.

---

## Protocol

### Framing

All messages use OSC `9010`, a dedicated number for this protocol. Remote→Wave messages are JSONL payloads in that OSC sequence. Wave→Remote messages are framed JSONL lines injected into the remote's stdin, using the `##listen{` prefix so the remote SDK can distinguish them from other output.

```
Remote → Wave:  \x1b]9010;{...json...}\x07
Wave → Remote:  ##listen{...json...}\n   (injected into stdin)
```

The remote SDK reads stdin line by line, ignores any line that does not start with `##listen{`, and demultiplexes the rest by `id`.

The terminal must have echo disabled. In echo-on mode the injected `##listen{...}` lines would be echoed back to the terminal output as garbage. The SDK disables echo (and canonical mode, since injected frames can exceed the 4 KB canonical buffer) while keeping `ISIG` set so that ^C and ^Z still deliver signals to the process.

Calls that receive a response carry a unique `id`; Wave's response references the same `id`. Calls that are fire-and-forget omit `id` entirely. Multiple calls can be in-flight simultaneously.

### Protocol Constants

| Constant                 | Value              | Notes                                                                                                                 |
| ------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `MaxPayloadSize`         | 65536 bytes (64KB) | Maximum decoded bytes per `write` call; `read` responses are clamped to this limit                                    |
| `ListenHandshakeTimeout` | 2000ms             | How long the remote waits for the `listen-enter` response before concluding the terminal doesn't support the protocol |
| `ListenBacklog`          | 128                | TCP listen backlog passed to Wave's `listen()` call; unaccepted connections beyond this are refused at the OS level   |

### Entering Listen Mode

```
Remote → Wave:  \x1b]9010;{"id":"l1","call":"listen-enter"}\x07

Wave → Remote:  ##listen{"id":"l1","port":22145}
                ##listen{"id":"l1","error":"..."}
```

The remote waits up to `ListenHandshakeTimeout` for a response. No response means the terminal doesn't support the protocol — fail gracefully. The timeout is 2000ms to accommodate the two-way SSH round trip on high-latency connections (intercontinental SSH at 200ms RTT consumes ~400ms in transit alone).

An error response means the terminal supports the protocol but is refusing this session — for example, the feature is disabled via a Wave config flag or blocked for this specific block. The SDK should treat both cases (timeout and error) as "not available" and degrade gracefully; the distinction is only relevant if the SDK wants to surface a more specific message to the user.

On success, Wave has bound an ephemeral local port on `127.0.0.1` and is ready to accept connections. The remote knows the port and can use it (print it, pass it to another OSC, etc.).

**One listen per terminal session.** Multiple concurrent connections to that port are handled via connection IDs.

### Accepting Connections

`accept` is a blocking call, just like Unix `accept(2)`. The remote keeps one in flight at all times to handle incoming connections.

```
Remote → Wave:  \x1b]9010;{"id":"a1","call":"accept"}\x07

Wave → Remote:  ##listen{"id":"a1","conn":"c1","addr":"127.0.0.1:54321"}
                ##listen{"id":"a1","error":"..."}
```

Wave generates the connection ID (`conn`), guaranteed to be unique within the current listen session. It is an opaque string — the remote SDK should treat it as an identifier only, not parse it.

Only one `accept` may be in-flight at a time. If a second `accept` is issued while one is already pending, Wave returns an error immediately on the second call; the first `accept` remains in-flight and is unaffected. The error case also fires when the listen session is torn down while an `accept` is in flight.

### Reading Data

`read` is a blocking call. It resolves when data arrives, when the connection is closed by the local client (EOF), or on error.

```
Remote → Wave:  \x1b]9010;{"id":"r1","call":"read","conn":"c1","n":4096}\x07

Wave → Remote:  ##listen{"id":"r1","data":"<base64>"}
                ##listen{"id":"r1","data":""}
                ##listen{"id":"r1","error":"..."}
```

Empty `data` signals EOF — the local client closed the connection. There is no separate closed event. If a local client disconnects while a `read` is in flight, Wave resolves it with EOF immediately. If no `read` is in flight at disconnect, the next `read` returns EOF right away.

The `n` parameter specifies the remote's buffer size. Wave returns up to `n` bytes and never more — it does not wait to fill the buffer, returning immediately as soon as any bytes are available. `n` is also clamped to `MaxPayloadSize`; even if `n` is larger, no response will exceed 64KB. Requesting a large `n` is valid — the effective limit is `min(n, MaxPayloadSize)`.

### Writing Data

`write` blocks until Wave has consumed the data. Only one `write` may be in-flight per connection at a time. If a second `write` is issued on the same connection while one is already pending, Wave returns an error immediately on the second call; the first `write` remains in-flight and the connection is unaffected. This is the flow control mechanism — the remote SDK serializes writes per connection.

```
Remote → Wave:  \x1b]9010;{"id":"w1","call":"write","conn":"c1","data":"<base64>"}\x07

Wave → Remote:  ##listen{"id":"w1"}
                ##listen{"id":"w1","error":"..."}
```

Writes are atomic: Wave either accepts all bytes or returns an error. No short writes. If the decoded payload exceeds `MaxPayloadSize`, Wave returns an error without writing anything. The remote SDK is responsible for chunking large payloads into `MaxPayloadSize` chunks and writing them sequentially.

### Half-Close (shutdown)

`shutdown` closes the write side of a connection while keeping the read side open. Wave calls `CloseWrite()` on the local TCP conn — the local client sees EOF on its next read, but the connection remains open for the remote to continue reading.

```
Remote → Wave:  \x1b]9010;{"call":"shutdown","conn":"c1"}\x07
```

Fire-and-forget, no response. `shutdown` on an unknown or already-closed conn-id is a no-op.

When the _local_ client half-closes, the remote sees EOF on its next `read` — the same signal as a full close. This matches libc: `read()` returning 0 is ambiguous between peer `shutdown(SHUT_WR)` and `close()`. The remote discovers whether the connection is still alive by attempting a `write`; if the local client fully closed the write returns an error, otherwise it succeeds.

Calling `write` after the remote has already called `shutdown` on that conn returns an error.

### Closing a Connection

`close` is fire-and-forget. The local client receives EOF on its next read.

```
Remote → Wave:  \x1b]9010;{"call":"close","conn":"c1"}\x07
```

**Calling `close` on a conn-id immediately unblocks all pending `read` and `write` calls for that conn, returning an error to each.** `close` on an unknown or already-closed conn-id is a no-op. This is the cancellation primitive — there is no separate cancel or timeout call. To implement a read deadline, set a timer and call `close` if it fires.

### Exiting Listen Mode

```
Remote → Wave:  \x1b]9010;{"call":"listen-exit"}\x07
```

Fire-and-forget, no response. Wave closes the ephemeral port and all open connections for this session. Any in-flight `accept`, `read`, or `write` calls receive an error response. Teardown cancels everything.

Wave also performs an implicit teardown when the pty closes — no explicit `listen-exit` required in that case.

---

## Edge Cases

### Remote Process Crash

If the remote process crashes without emitting `listen-exit`, Wave's listen session remains open. The behavior is self-limiting:

- Any in-flight calls (`accept`, `read`) resolve and Wave injects their `##listen{...}` responses into stdin. With no receiver, these appear as garbage on the raw tty — typically one line per pending call.
- Since nothing is consuming those responses, no new calls are ever issued. Wave receives no further requests and goes quiet.
- New local clients connecting to the ephemeral port will hang (no `accept` is ever called) until they time out.
- When the user closes the terminal tab or the shell exits, the pty closes and Wave tears down the session implicitly.

Recovery is the same as any program that crashes leaving the terminal in raw mode: `stty cooked` or `reset`. This is no worse than `vim` or `htop` crashing.

### Re-entering Listen Mode

If `listen-enter` is received while a session is already active, Wave tears down the existing session and starts a fresh one — it does not no-op or return an error.

Teardown of the old session follows the same path as `listen-exit`: the ephemeral port is closed, all open connections are closed, and any in-flight `accept`, `read`, or `write` calls receive an error response. Wave then opens a new ephemeral port and responds with the new port number.

This covers the expected cases: a process restarting after a crash, a developer iterating, or a SIGCONT after an unclean SIGTSTP teardown. In all of these the old session is broken anyway; a clean slate is the right response.

---

## Lifecycle and Signal Handling

The session is bound to the pty. Wave needs no PID watching — when the pty closes, all associated connections are cleaned up automatically.

For cooperative teardown, the remote SDK should trap signals:

| Signal                        | SDK action                                          |
| ----------------------------- | --------------------------------------------------- |
| `SIGTERM`, `SIGINT`, `SIGHUP` | emit `listen-exit`, then exit normally              |
| `SIGKILL`                     | uncatchable — pty closure handles implicit teardown |

---

## SIGTSTP / SIGCONT Handling

**This section describes behavior that must be implemented in the SDK.**

SIGTSTP is the interesting case: the process cannot respond to anything while suspended, so the listen session must be torn down before suspending. On resume, a fresh `listen-enter` starts a new session with a new ephemeral port.

| Signal    | SDK action                                         |
| --------- | -------------------------------------------------- |
| `SIGTSTP` | emit `listen-exit` (protocol layer), then suspend  |
| `SIGCONT` | re-emit `listen-enter` (fresh handshake, new port) |

The SDK must handle `SIGTSTP` by calling `listen-exit` before suspending, then on `SIGCONT` issue a new `listen-enter` handshake to obtain a fresh ephemeral port.

---

## Security

**Localhost-only binding.** Wave always binds the ephemeral port to `127.0.0.1`, never `0.0.0.0`. The port is unreachable from outside the local machine regardless of firewall configuration.

**No `connect` primitive.** The remote process cannot initiate outbound connections to local services. Without `connect`, a compromised remote process has no way to probe or access local services (databases, internal APIs, etc.). This is the sharpest potential risk of a protocol like this, and it is intentionally out of scope.

**Data flows only to the requesting process.** The remote receives exactly what local clients send to the port it opened — nothing else. There is no ambient access to other local data.

**Connection count is self-governing.** The remote controls its own exposure through `accept`. If it stops calling `accept`, the backlog fills and new connections are refused at the OS level via `ListenBacklog`. Wave does not need to impose a separate connection limit — the remote process cannot be flooded with connections it did not ask for.

**Any local process can connect to the ephemeral port.** Since it is bound to localhost, other processes on the same machine can connect if they discover the port number. This is the same risk as running any localhost service (e.g., `python -m http.server`), not a new threat introduced by this protocol.

**Session lifetime is bounded by the pty.** Wave tears down the listen session when the pty closes. No orphaned open ports survive a terminal close or Wave restart.

---

## General Use Case

Any remote process can use this protocol. After receiving the port from the `listen-enter` response, the process knows the local URL and can do whatever is appropriate:

```
$ python -m http.server  # hypothetical wave-aware wrapper
Forwarding → http://localhost:22145
```

Wave's terminal link detection makes the URL clickable. No tsunami sub-block, no special UI — just a proxied port. This works for dev servers, databases, any TCP service.

---

## Tsunami Integration

> **Note:** This section is background and motivation only. Tsunami integration is **not** part of this spec's implementation scope — it is described here to explain why the OSC listen protocol exists and how it is expected to be used downstream.

For tsunami, the listen protocol is the transport layer. After getting the port from the `listen-enter` response, the tsunami SDK emits the existing `wave-tsunami` OSC:

```
// SDK gets port from listen-enter response, then:
\x1b]9009;wave-tsunami;{"url":"localhost:22145"}\x07
```

Wave handles these two OSC sequences independently:

- `listen-enter` → opens the socket proxy
- `wave-tsunami` → creates the tsunami sub-block pointing at the proxied URL

The tsunami sub-block connects to `localhost:22145` normally. All HTTP traffic flows through the OSC proxy transparently.

**SIGTSTP flow for tsunami:**

1. SDK emits `listen-exit` — closes the proxy
2. SDK emits `wave-tsunami-suspend` — tears down the sub-block UI
3. Process suspends

**SIGCONT flow for tsunami:**

1. SDK emits `listen-enter` — new handshake, new ephemeral port
2. SDK emits `wave-tsunami;{"url":"localhost:<newport>"}` — fresh sub-block

The two layers are independent. `listen-exit` alone (without `wave-tsunami-suspend`) is valid for non-tsunami use cases.

### Relationship to the Existing Tsunami Dial Mechanism

The current design dials the remote process's HTTP port via Wave's managed SSH connection. The OSC listen protocol replaces the need for that: instead of Wave reaching into the remote to dial a port, the remote reaches out through the terminal. This works on any SSH connection and requires no port forwarding support on the remote host.

The OSC listen approach is strictly more general and should eventually be the primary path. The SSH-dial mechanism can remain as a fallback for backward compatibility.
