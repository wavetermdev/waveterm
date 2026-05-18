# Project Context

## Problem Statement

Most modern terminals and developer tools assume a **local-first workflow**:
- Code lives on the local machine
- Build tools run locally
- Terminal access is to local shell or occasional remote SSH sessions
- AI assistants analyze local files and local terminal output

This doesn't match how many developers actually work:
- Code lives on remote servers, cloud VMs, or containers
- Builds happen remotely (CI/CD, remote compile farms)
- The developer's machine is primarily a thin client
- Network connectivity is the primary bottleneck, not local CPU

## What This Fork Targets

A terminal where **remote is the default**, not an afterthought:
- SSH connections are first-class, not a plugin
- Port forwarding is automatic from SSH config
- File editing on remote machines feels as seamless as local
- Durable sessions survive network interruptions gracefully
- The terminal understands remote context (which host, which directory, which project)
- Local resources (AI, file previews) enhance remote work rather than competing with it

## What's Different from Upstream

Wave Terminal already has excellent SSH and durable session support. This fork will:

| Area | Upstream Wave | This Fork |
|------|---------------|-----------|
| **Port forwarding** | Not supported from SSH config | Automatic from `~/.ssh/config` |
| **Local-first features** | AI, widgets, file previews for local | Evaluate which to keep/diminish |
| **Remote context** | Basic | Potentially enhanced (host-aware prompts, etc.) |
| **UI chrome** | Full Wave branding/chrome | Potentially stripped for remote-dev focus |

## Non-Goals

- Rebuild from scratch — this is a fork, not a rewrite
- Remove all local features indiscriminately — evaluate usefulness
- Compete with upstream — this is a specialized variant

## Target User

Developers who:
- Spend >50% of terminal time in SSH sessions
- Have multiple persistent remote development environments
- Use `~/.ssh/config` extensively for host/forwarding configuration
- Want a terminal that treats remote machines as "primary" workspaces
