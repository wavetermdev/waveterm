# RemoteTerm Fork

A fork of [Wave Terminal](https://github.com/wavetermdev/waveterm) optimized for **remote development workflows**.

## Upstream

- Original: `https://github.com/wavetermdev/waveterm`
- This fork: `https://github.com/whoisjeremylam/remoteterm`
- CWD origin points to this fork

## Purpose

Most developer terminals assume code is installed, built, and tested locally. This fork targets developers who primarily work on remote machines via SSH — with the local machine as a thin client.

## Active Specs

- [[specs/web-agent-api-v1.md]] — **Web CDP useful v1** — **Locked, ready to implement** (embedded web widget, not a new browser). Parent vision: [[specs/web-agent-api.md]]
- [[specs/wsh-agent-api.md]] — **"Agent Control Fabric"** — v2 implemented on `feat/agent-control-fabric` (see [[specs/agent-control-fabric-v2.md]]); connection gate unchanged
- [[specs/reconnection-ux-backlog.md]] — **P0 + P1 + most of P2 merged**; remaining is UX-3.2 QA matrix + spec hygiene
- [[specs/reconnection.md]] — Implementation log (through stale hung-dial soft-cancel / password-cache hardening)
- [[specs/newtab-connect-dropdown.md]] — Implemented; ≥2-char auto-select; block-header is filter-free switcher
- [[specs/portforwarding.md]] — SSH port forwarding (`LocalForward` / `RemoteForward`) — landed earlier
- [[specs/tmux-cwd-tracking.md]] — CWD tracking under tmux/screen via `wsh setmeta`
- [[specs/widget-keepalive.md]] — Widget state persistence across toggle
- [[specs/remove-telemetry.md]] / [[specs/remove-waveai.md]] — earlier fork goals

## Current branch / handoff

- **Branch:** `feat/agent-control-fabric` (worktree `waveterm-remote-agent-fabric`; based on `feat/files-widget`)
- **Landed:** Agent Control Fabric v2 — see [[specs/agent-control-fabric-v2.md]] (connection gate unchanged)
- **Next session:** implement **Web CDP useful v1** — [[specs/web-agent-api-v1.md]] (Status = Locked). Paste the implement starter prompt at the bottom of that file.
- **⚠️ ACTION (Jeremy):** run the reconnection UX-3.2 QA matrix (Q1–Q17) — manual tests, see [[specs/reconnection-p1-p2-verification.md]] for steps/expected results and [[todos.md]] for the recommended order
- **Todos:** [[todos.md]] — web v1 implementation is next; reconnection QA is still open

## Context & Decisions

- [[context.md]] — Full project background and goals
- [[decisions.md]] — Architecture decisions (ADRs)

## Tasks

- [[todos.md]] — Active work and backlog
