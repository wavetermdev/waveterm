# waveterm-remote Fork

A fork of [Wave Terminal](https://github.com/wavetermdev/waveterm) optimized for **remote development workflows**.

## Upstream

- Original: `https://github.com/wavetermdev/waveterm`
- This fork: `https://github.com/whoisjeremylam/waveterm-remote`
- CWD origin points to this fork

## Purpose

Most developer terminals assume code is installed, built, and tested locally. This fork targets developers who primarily work on remote machines via SSH — with the local machine as a thin client.

## Active Specs

- [[specs/remove-telemetry.md]] — Remove all telemetry, analytics, and tracking
- [[specs/remove-waveai.md]] — Remove/disable all Wave AI features
- [[specs/portforwarding.md]] — SSH port forwarding (`LocalForward` / `RemoteForward`)

## Context & Decisions

- [[context.md]] — Full project background and goals
- [[decisions.md]] — Architecture decisions (ADRs)

## Tasks

- [[todos.md]] — Active work and backlog
