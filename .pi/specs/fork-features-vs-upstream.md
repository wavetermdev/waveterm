# Fork Features vs. Upstream — High-Level Summary

- **Fork:** `whoisjeremylam/remoteterm` (RemoteTerm)
- **Upstream:** `wavetermdev/waveterm` (Wave Terminal)
- **Compiled:** 2026-08-13
- **Scope:** User-visible features and notable architectural changes introduced in this fork that are **not** in upstream Wave Terminal.

---

## Method

1. The `upstream` remote is **not configured** in this checkout (`git remote -v` shows only `origin`). So a direct diff against upstream HEAD wasn't possible. Instead, fork-specific commits were identified by author (`whoisjeremylam` / `Jeremy Lam`), which isolates the fork's own work from upstream merges/syncs:
   `git log --no-merges --author=whoisjeremylam --author=Jeremy main`
2. Each headline feature was cross-checked against the project's planning docs (`.pi/index.md`, `.pi/context.md`, `.pi/todos.md`, `.pi/specs/`) and **verified present in the actual code** via `git grep` (symbols/files exist), so the list reflects implemented features, not just plans.
3. "Removed/disabled vs upstream" was derived from the early fork commits (`Remove waveai`, `remove telemetry`, `Remove updater`) and cross-referenced with `.pi/specs/remove-*.md`.
4. Planned-but-not-landed features were taken from `.pi/specs/` and `.pi/todos.md` where no corresponding implementation commit was found.

The fork diverged early (initial commits: `.pi/` planning docs, AGENTS.md, local toolchain, macOS CI), then layered feature branches on top. The features below are grouped by area.

---

## Fork-specific features (implemented)

### SSH & remote connectivity
- **SSH port forwarding from `~/.ssh/config`** — automatic `LocalForward` / `RemoteForward` parsing and application on connect. Upstream does not support config-driven forwarding.
  - `pkg/remote/sshclient.go`, `pkg/remote/conncontroller/conncontroller.go`, `pkg/wconfig/settingsconfig.go` (ConnKeywords `ssh:LocalForward` / `ssh:RemoteForward`)
  - Commits: `c46ad70e` (#24), `999f44a0` (UI #29), `daae7038` (surface bind errors on reconnect)
  - Spec: `.pi/specs/portforwarding.md`
- **Durable-session reconnect overhaul** — fast reconnect, visibility-driven reconnect (tab switch / app focus), reconnect scheduler with tuned bounds and jitter, soft-cancel of hung dials, permanent-failure detection (known_hosts / host key), sticky suppress after user Stop, password cache preserved across network flaps, gave-up overlay with stop-retry. A large multi-phase effort (P0 + P1 + UX-2.x).
  - `pkg/remote/conncontroller/conncontroller.go`, `frontend/app/block/connstatusoverlay.tsx`, `connectionbutton.tsx`, scheduler logic
  - Commits: `38fde94a` (#23), `7ac402b5` (#10), `e42d1493`, `d519f484`, `4d980363`, `170d8865`, `f62a6305`, `e7b9438e`, and the `feat(reconnect):` / `fix(reconnect):` series
  - Specs: `.pi/specs/reconnection.md`, `reconnection-design.md`, `reconnect-ui-overlay.md`, `visibility-driven-reconnect.md`, `reconnection-ux-backlog.md`, `configurable-reconnect-thresholds.md`, `fast-reconnect-hardcoded.md`
- **SSH connections without `wsh` on the remote** — fallback so a connection still works when the remote lacks the `wsh` agent. Commit `6b403784`.
- **Password cold-start prompt** — prompt for credentials immediately on cold start instead of waiting for an invisible ~60s dial race; serialize password prompts per window; prompt positioning fixes. Commits `d7f8a613`, `98bbd632`, `ac684f1e`.
- **SSH agent unavailability after sleep/wake** — surface a clear error when the SSH agent isn't available after system resume (UX-2.5). Commit `654061a5`.
- **Linux/Windows resume parity** — reconnect behavior matches macOS after sleep/resume (UX-2.4). Commit `61a787b4`.

### Source control (SCM) widget
- **Visual git sidebar on remote hosts** — staged/unstaged/untracked file lists, side-by-side Monaco diffs, stage/unstage files and hunks, revert, commit (Ctrl+Enter), push with credential handling. Works over any connected remote via wsh RPC.
  - `frontend/app/view/sourcecontrol/*`, `pkg/wshrpc/wshremote/wshremote_scm*`, wsh `GitStageCommand` et al.
  - Commits: `d40932e3` (MVP), `5f54d0e1` (stage/unstage/revert), `43095f06` (commit input), `84ab947f` (push button), `2d6d0451` (git push auth via secret store), `247008c9` (multi-file review mode), `b9bd2075`, `9a0bb55f` (binary/large file handling)
  - Specs: `.pi/specs/source-control-widget.md`, `scm-multifile-diff.md`, `scm-multifile-diff-review.md`, `git-push-auth.md`
- **Git push authentication with secret store** — `GIT_ASKPASS` integration, secret-store-backed credentials, unpushed-commits check before prompting, push-failure error dialog, encoded secret names, scope tracking. Commits `2d6d0451`, `69601319`, `7591ed33`, `10b15ee3`, `b88c6c28`.

### Remote file transfer & image rendering
- **Remote file paste & drag-drop upload** — clipboard paste and drag-drop file upload routed to the correct remote connection (not the local FS). Commit `8f4a24c4`, `54bc30b7`.
  - Spec: `.pi/specs/pi-image-paste.md`
- **Inline image rendering in terminals** — `@xterm/addon-image` supporting Sixel, iTerm2 (IIP), and Kitty graphics protocols; image restore across durable-session reconnect; tools like `chafa`/`imgcat`/pi-tui render inline.
  - `frontend/app/view/term/image-addon.test.ts`, `image-restore.test.ts`, `dec-modes.test.ts`
  - Commit `6ccbb74c` (#34), plus `durable-session-image-restore` spec
  - Spec: `.pi/specs/iip-sizing-investigation.md`, `durable-session-image-restore.md`

### Terminal & block UX
- **tmux/screen CWD tracking** — `wsh setmeta` tracks the working directory under tmux/screen so blocks follow the right dir. Commit `e9614d41`. Spec: `tmux-cwd-tracking.md`.
- **tmux mouse reconnect fix** — mouse integration lost on durable SSH session reconnect (upstream bug #2). Commit `26b1b34b` (#3).
- **Tab close crash fix** — crash on tab close after SSH session exit. Commit `0cd6489b`.
- **Background terminal resize** — send resize events to background (non-focused) terminal sessions. Commit `1756ba0e`.
- **Native copy fix** — restore ESC key and trim trailing spaces on native copy. Commit `f2877d67`.
- **New-tab connection dropdown** — typeahead with frecency sort, ≥2-char auto-select first match, Cmd-T toggle, no default selection on open; block-header connection switcher. Commits `8024da00`, `c9f2e782`, `d7f8a613`.
- **Tab auto-naming from connection** — new tabs auto-named from connection hostname or local machine. Commit `47a64397`. Spec: `tab-name-from-connection.md`.
- **Widget keep-alive** — preserve widget state across toggle. Commit `70e14a61`, `6ca2c879`. Spec: `widget-keepalive.md`.
- **Directory dropdown** — shared directory dropdown for Files and SCM widgets, CWD detection, browse-then-OK. Commits `ffc995e9`, `767c55f9`, `fe5e6b98`. Spec: `directory-dropdown.md`.
- **Close terminal block on Enter after shell exit** — Commit `bb6b4b9c`.

### Reconnection robustness (bugfix cluster)
- **x/crypto/ssh drain loop spin bug** — patched `golang.org/x/crypto` drain loop (upstream Go bug `golang/go#79658`), DomainSockListener close ordering to prevent CPU spin on closed mux, close-involuntary preserves cached password, stream-reader leak fix on reconnect, xterm `_isPaused` reset on resume, per-job bounded retry in `onConnectionUp`, runtime auth-prompt tracking, term-file corruption on stream supersession. Commits `51577106`, `eb2c659a`, `402acb77`, `6f04028a`, `b6f7487a`, `3cd17d3c`, `634bdc27`, `f4a2a60c`/`590b107f`.

### Branding / build / infra
- **RemoteTerm branding** — `productName`/`appId`/`name`/`app.setName()`/`TERM_PROGRAM` set to RemoteTerm/remoteterm; UI chrome, onboarding, README rename landed (see `specs/remoteterm-rename-review.md`). Commit `146ceb1e`, `6aae307e`.
- **Local build toolchain** — Go and Task installed locally (not global); `golang-1.26.2/` local install; macOS CI workflow via GitHub Actions. Commits `4828633a`, `18c93b6b`, `6f7ad3fc`, `d4d5a158`.
- **CI artifact sanitization** — sanitize branch name in CI artifact upload. Commit `ab2f1256`.

---

## Fork-specific features (planned / in-progress)

From `.pi/specs/` and `.pi/todos.md` with no landed implementation commit yet:

- **Configurable reconnect thresholds** — `.pi/specs/configurable-reconnect-thresholds.md` (user-tunable reconnect timing).
- **P1 reconnection UX clarity** — post-give-up copy, interactive idle overlay, wrong-password feedback, drain indicator (`.pi/specs/reconnection-ux-backlog.md`, marked "next" not blocking).
- **Soft network readiness gates before automatic TCP dial** (P2 / UX-2.8) — defer dialing until network is actually ready.
- **Data-dir / env-var rename to RemoteTerm** — `.pi/specs/remoteterm-rename-review.md` §3.6; external rename landed, on-disk `~/.waveterm` / `WAVETERM_*` deliberately kept (migration risk, see decisions.md 2026-08-24).
- **Remote-first onboarding / new-user UX** — same review spec; no connection-setup welcome flow yet.
- **wsh agent API** — `.pi/specs/wsh-agent-api.md` (listed as spec; verify implementation status separately if needed).
- **Widget follow-focus** — `.pi/specs/widget-follow-focus.md` (spec exists; check whether landed).

---

## Things removed / disabled vs. upstream

These upstream Wave features were **deleted** in this fork:

- **Wave AI** — all AI features removed (Phase A–D): AI docs, schemas, generator, builder AI wiring, frontend AI sparkle icon, AI panel/tips. Commits `1a7f1c83` (#1), `92506fd3`, `144578f3`, `06284b9d`, `f180e5d3`, `4cce99c0`, `bd355fad`. Spec: `.pi/specs/remove-waveai.md`.
- **Telemetry / analytics / user tracking** — completely removed; no usage data sent to external servers. Commit `23127297`. Spec: `.pi/specs/remove-telemetry.md`.
- **Auto-updater** — updater removed (the fork uses manual CI-artifact downloads instead of in-app auto-update). Commits `2b907b80` (#31), and `.pi/specs/remove-updater.md`, `remove-updater-delete.md`.
- **README AI/upstream sections** — README restructured: fork notes moved up, upstream-specific sections (AI, download-from-waveterm.dev) removed. Commits `9529abc9`, `f8449cf3`, `95347af6`.

---

## Notes & caveats

- The `upstream` remote isn't fetched in this checkout, so verification against current upstream HEAD was done via commit-authorship filtering + `.pi/` planning docs + README "Fork Notes", not a live `git diff upstream/main`. If you want a precise file-level diff against the latest upstream, add the remote (`git remote add upstream https://github.com/wavetermdev/waveterm`) and `git fetch upstream` first.
- Many "fix:" commits are bug fixes to the fork's own new features (reconnect, SCM) rather than upstream bugs. A few target upstream bugs (tmux mouse #2, tab-close crash, x/crypto drain loop).
- The branding rename is **partial** — see `.pi/specs/remoteterm-rename-review.md` for the remaining external surfaces.