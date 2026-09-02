# RemoteTerm External Rename — Review & New-User UX Audit

- **Branch / worktree:** `review/remoteterm-rename` at `../waveterm-remote-rename-review`
- **Created:** 2026-08-13
- **Scope:** External rename of the fork to "RemoteTerm", keeping internal/upstream identifiers intact for easy pulls. Plus new-user onboarding review for a remote-session-first product.

---

## 1. Current state of the rename

Partial rename is **already done**:

| Surface | Status |
|---|---|
| `package.json` `name` | ✅ `remoteterm` |
| `productName` | ✅ `RemoteTerm` |
| `appId` | ✅ `io.remoteterm.app` (was `dev.remoteterm.app`; switched 2026-08-24 — `remoteterm.io` was taken, fork domain is `remoteterm.io`) |
| `app.setName()` (Electron app name) | ✅ `RemoteTerm` (prod) / `RemoteTerm (Dev)` |
| `TERM_PROGRAM` env (shells) | ✅ `remoteterm` (commit `6aae307e`) |
| `homepage` | ✅ `https://remoteterm.io` (not yet registered — accepted dead link for now) |
| GitHub repo | ✅ renamed to `whoisjeremylam/remoteterm` (2026-08-24) |

**Rename landed 2026-08-24** (this branch): window title, About modal (branding + fork links + website → remoteterm.io), welcome onboarding (star → fork repo, Discord removed), app menu, quit dialog, ARM64 dialog, `index.html` title, macOS permission strings (`electron-builder.config.cjs`), upgrade modals suppressed (auto-open + widgets-bar "Release Notes" entry removed; files left unreferenced), Wave AI quicktips removed, README rewritten (Download + Quickstart + fork attribution), stale `README.ko.md` / `README.zh-TW.md` / `ROADMAP.md` deleted, `.github/ISSUE_TEMPLATE` menu path fixed.

**Still deferred — intentionally "Wave" / "waveterm":**
- Docs site (`docs/docusaurus.config.ts`: title, URLs, org) — no fork docs host exists
- Assets (logo artwork `waveterm-logo-*`, `wave-*`; `logo.svg` artwork — aria-label already RemoteTerm)
- Data/config directory env vars `WAVETERM_HOME` / `WAVETERM_CONFIG_HOME` / `WAVETERM_DATA_HOME` and on-disk dir `~/.waveterm` / `waveterm/electron`
- Packaging internals: `build/deb-postinstall.tpl` `/opt/Wave` paths, `Taskfile.yml` `APP_NAME` (winget)
- `wsh` CLI help strings + Go dialog titles (code, not chrome)
- Dev-only strings (`frontend/preview/*`, builder)

**Rough scale:** ~318 files still mention "waveterm" (case-insensitive), but the vast majority are **internal** — Go import paths (`github.com/wavetermdev/waveterm/pkg/...`), `tsunami/`, internal identifiers. These should NOT be renamed (see §3).

---

## 2. Guiding principle: external vs. internal naming

To keep pulling from upstream cleanly, split naming into two tiers:

### Tier A — External / user-facing (rename to RemoteTerm)
Anything a user sees, types, or that lives on their disk under a brand identity:
- UI strings, window titles, menus, dialogs
- About modal, onboarding, upgrade modals
- Docs site title/URLs/org
- README (all languages)
- App data directory name + env var names
- Logo/asset filenames and the visible logo artwork
- `TERM_PROGRAM` (done)
- electron-builder `productName` (done)

### Tier B — Internal / upstream identifiers (KEEP as waveterm)
Anything that matches upstream code and would cause merge conflicts if changed:
- Go module path `github.com/wavetermdev/waveterm`
- Go import paths in every `pkg/`, `cmd/`, `tsunami/` file
- TypeScript internal type/variable names (`waveEnv`, `WaveObj`, `WaveBrowserWindow`, `waveDirName` variables — *variable names*, not their *values*)
- `WAVETERM_*` env var names that are part of the upstream config contract (see caveat in §4)
- Internal log strings (`waveterm-app starting…`) — cosmetic, optional, low priority
- `.kilocode/` skill docs referencing import paths

**Rule of thumb:** rename the *value* the user sees/sets; keep the *identifier* the compiler/imports use.

---

## 3. Concrete rename checklist (Tier A)

Ordered by user-visibility. Each is a small, merge-friendly change.

### 3.1 Window & app chrome
- [x] `frontend/wave.ts` lines 40, 119, 187 — `document.title = "Wave Terminal"` → `"RemoteTerm"` (and tab-title variants)
- [x] `emain/emain-menu.ts:175` — `"About Wave Terminal"` → `"About RemoteTerm"`
- [x] `emain/emain.ts:163` — `"Are you sure you want to quit Wave Terminal?"` → `"…RemoteTerm?"`
- [x] `emain/emain-platform.ts:50-51` — ARM64 dialog text "Wave has detected…" / "Wave is running…" → "RemoteTerm…" (docs link left on `docs.waveterm.dev`, see 3.5)

### 3.2 About modal
- [x] `frontend/app/modals/about.tsx:30` — "Wave Terminal" → "RemoteTerm" (+ tagline "Open-Source AI-Integrated Terminal" → "Open-Source Remote-First Terminal")
- [x] `about.tsx:42,50,58,66` — GitHub/Sponsor links → fork repo (`whoisjeremylam/remoteterm`); Website → `remoteterm.io`; acknowledgements → upstream (done earlier per files-widget-qa-fixes spec)

### 3.3 Onboarding & upgrade modals
- [x] `frontend/app/onboarding/onboarding.tsx:57` — "Welcome to Wave Terminal" → "Welcome to RemoteTerm"
- [x] `onboarding.tsx:68,83,88` + `onboarding-starask.tsx` — **Resolved 2026-08-24:** star links point to the fork repo (`whoisjeremylam/remoteterm`); the Wave Discord section was removed from the welcome page. `onboarding-starask.tsx` is now unreferenced (see upgrade-modal suppression below).
- [x] All `onboarding-upgrade-v01xx.tsx` + `onboarding-upgrade-minor.tsx` — **Resolved 2026-08-24: suppressed entirely.** Removed the auto-open effect in `modalsrenderer.tsx`, the `UpgradeOnboarding*` registrations in `modalregistry.tsx`, and the widgets-bar "Release Notes" entry in `widgets.tsx`. Files left on disk unreferenced to avoid upstream delete-conflicts.
- [x] `frontend/app/element/quicktips.tsx:160,196` — "Open Wave AI Panel" / "Focus Wave AI" tips removed (feature removed in fork).

### 3.4 Assets / logo
- [ ] The visible logo is `frontend/app/asset/logo.svg`. Currently renders the Wave "wave" mark. For a real rename, commission/replace with a RemoteTerm mark. Low priority if the wave motif is acceptable as a logo, but the *wordmark* must not say "Wave Terminal".
- [ ] `assets/waveterm-logo-*`, `wave-*` — installer/about assets. Either keep visually (a wave can be a RemoteTerm logo) or replace. Filenames are internal (Tier B-ish) and can stay; the *artwork content* is what users see.
- [ ] `README.md` logo `<picture>` sources point to `./assets/wave-dark.png` etc. — fine to keep art, but the README itself must be rewritten (§6).

### 3.5 Docs site
- [ ] `docs/docusaurus.config.ts` — `title: "Wave Terminal Documentation"` → "RemoteTerm Documentation"; `url`/`baseUrl`/`organizationName`/`projectName`/editUrl/Algolia `indexName` → fork's values (only once a docs site is hosted for the fork). **Caveat:** the fork currently relies on `docs.waveterm.dev` for in-app help links. If the fork doesn't host its own docs, in-app links should keep pointing to upstream docs (they're accurate for the shared codebase) OR be removed. Don't link `remoteterm.io` docs that don't exist yet.
- [x] Decide: does the fork host `docs.remoteterm.io`? → **No (2026-08-24).** In-app doc links stay on `docs.waveterm.dev`.

### 3.6 App data directory & env vars (highest user-impact, needs care)
This is the one Tier-A change with **migration risk**:

- `emain/emain-platform.ts`:
  - `waveDirNamePrefix = "waveterm"` → `"remoteterm"` (controls `~/.config/remoteterm`, `~/.local/share/remoteterm`-ish via `envPaths`)
  - `envPaths("waveterm", …)` → `envPaths("remoteterm", …)`
  - `app.setName("waveterm/electron")` line 17 → keep or align with `RemoteTerm` (line 35 already sets `RemoteTerm`; the line-17 `waveterm/electron` is a legacy macOS app-data subdir — see migration note)
  - Env vars `WAVETERM_HOME` / `WAVETERM_CONFIG_HOME` / `WAVETERM_DATA_HOME` → rename to `REMOTETERM_*` **but keep accepting the old `WAVETERM_*` as aliases** for backward compat.
- `pkg/jobmanager/jobmanager.go:396` — socket dir `/tmp/waveterm-<uid>` → `/tmp/remoteterm-<uid>` (internal, low-stakes; optional).

**Migration concern:** existing users on this fork already have data under `~/.waveterm` / `~/.config/waveterm`. The code already has a `getWaveHomeDir()` backward-compat path (it detects `wave.lock`). **Recommendation:** add a parallel `getLegacyRemoteTermHomeDir()` that detects the *previous* `waveterm` dir and migrates/points to it on first run, OR keep the on-disk dir name `waveterm` for a deprecation cycle and only rename the *displayed* name. Simplest safe path: **keep on-disk dir as `waveterm` for now** (it's barely user-visible), rename only the UI/app-name surfaces, and plan the data-dir migration as a separate, tested change. Flag this as a decision in [[decisions.md]].

---

## 4. Things to deliberately NOT rename (Tier B — keep for upstream pulls)

- Go module path & all `github.com/wavetermdev/waveterm/...` imports (~250+ files in `pkg/`, `cmd/`, `tsunami/`). Renaming these = permanent merge pain and no user benefit.
- Internal TS identifiers: `waveEnv`, `WaveObj`, `WaveBrowserWindow`, `wsh`, `wave`-prefixed internal types. These are code symbols, invisible to users.
- `.kilocode/` and `.roo/` skill docs referencing import paths.
- `go.mod` module path.
- `tsunami/` (internal Wave store engine) — internal.
- Comments/log strings that say "waveterm-app starting" — cosmetic, optional, skip for now (low value, merge friction).

**Caveat on `WAVETERM_*` env vars:** these are documented in upstream as user-facing config knobs. If a user sets `WAVETERM_HOME`, renaming silently breaks their setup. Resolution: accept both `REMOTETERM_HOME` (new, preferred) and `WAVETERM_HOME` (legacy, deprecated, log a one-time warning).

---

## 5. New-user onboarding audit (remote-session-first lens)

This is the more important part of the review. **The current first-run experience sells upstream Wave's story, not RemoteTerm's.**

### What a new RemoteTerm user sees today (first launch)
1. Welcome modal: "Welcome to Wave Terminal" + "Support us on GitHub" (links to `wavetermdev/waveterm`) + "Join our Community" (Wave's Discord) + ToS agree.
2. Features page (`onboarding-features.tsx`) → `onboarding-durable.tsx` (durable sessions) + command showcase (`EditBashrcCommand`, `ViewLogoCommand`, `ViewShortcutsCommand`).
3. On subsequent version bumps: `onboarding-upgrade-*` modals describing Wave AI, Claude Code, durable sessions — most of which the fork has removed or doesn't center on.

### Problems for a remote-first user
- **No SSH/connection setup in onboarding.** The #1 thing a remote-first user needs — "connect to a host" — is not in the welcome flow. They land in a *local* terminal and must discover the connection UI.
- **Branding mismatch.** "Welcome to Wave Terminal", Wave AI tips, upstream Discord/GitHub links. Feels like someone else's product.
- **Upgrade modals are noise.** They advertise upstream features (Wave AI) the fork removed. Confusing/incoherent.
- **No guidance on `~/.ssh/config`**, which the fork treats as the source of truth for connections (per `.pi/context.md`). A remote-first terminal should *teach* this on first run.
- **Default block is a local shell.** A remote-first product might default to a connection picker or prompt to add a host.

### Onboarding suggestions (concrete, ordered)
1. **Rewrite `onboarding.tsx` welcome** → "Welcome to RemoteTerm", replace Wave GitHub/Discord with the fork's repo + (optional) a note that it's a Wave Terminal fork. Keep ToS if required by license/attribution.
2. **Add a "Connect to your first remote" page** to the features flow: prompt for a host alias, explain that RemoteTerm reads `~/.ssh/config`, offer to open the connection picker. Reuse `conn-suggestions.ts` / `conntypeahead.tsx` logic.
3. **Suppress or rewrite `onboarding-upgrade-*` modals.** Since the fork diverges from upstream version cadence, these per-version "what's new" pages are wrong. Recommend: gate them behind a fork-specific version check that the fork never bumps, OR replace with a single "What's different in RemoteTerm" page (no telemetry, remote-first focus, SSH config port forwarding, source-control widget).
4. **Remove Wave AI tips** in `quicktips.tsx` ("Open Wave AI Panel", "Focus Wave AI") — the feature is gone in this fork.
5. **Default experience consideration (bigger, separate spec):** make the first tab open a "no connections yet — add one" prompt instead of a bare local shell. This is a product decision; capture as a future spec, not part of the rename.
6. **Quickstart doc** in README/docs: a 5-line "add a host to `~/.ssh/config`, launch RemoteTerm, click the connection dropdown" walkthrough (see §6).

---

## 6. README rewrite (currently very out of date)

Current `README.md` is upstream's README with a small "Fork Notes" section bolted on. It still says "Wave is an open-source terminal…", links to `waveterm.dev`, shows Wave screenshots, advertises Wave AI, and the Fork Notes list is stale (mentions "macOS builds" as the only CI, but the AGENTS.md says the user never builds locally and downloads CI artifacts).

### Proposed README structure for RemoteTerm
1. **Title + one-line pitch:** "RemoteTerm — a remote-session-first terminal, forked from Wave Terminal." State the thesis from `.pi/context.md`: local machine is a thin client, remote SSH is primary.
2. **What it is / why this fork exists** (pull from `.pi/context.md` "What this fork targets" table).
3. **Key differences from upstream** (table): no telemetry, SSH config port forwarding, source-control widget on remotes, image rendering, durable-session reconnect fixes. Drop "macOS builds" unless that's still the only CI target — confirm with user.
4. **Quickstart for a new user** (remote-first): add a host to `~/.ssh/config` → launch → connect. 5 lines.
5. **Download / install** — link to the fork's GitHub Actions artifacts (not `waveterm.dev/download`).
6. **Building from source** — keep BUILD.md link but note the fork's local-Go/Task setup from AGENTS.md.
7. **Credits / attribution** — "Forked from [Wave Terminal](https://github.com/wavetermdev/waveterm). This is an independent project; issues/feature requests belong in this fork's repo, not upstream."
8. Remove Wave AI section, Wave Community/Discord (or keep as "upstream community"), and stale screenshots (or replace).
9. Mirror changes to `README.ko.md` / `README.zh-TW.md` (or delete them if the fork isn't maintaining translations — stale translations are worse than none).

### Other docs files
- `docs/` is an upstream Docusaurus site. The fork doesn't appear to host it. Recommendation: leave `docs/` alone (it tracks upstream) and don't ship fork-specific docs there; put fork docs in README + `.pi/`. Avoids a second docs site to maintain.

---

## 7. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Renaming on-disk data dir breaks existing users' sessions/config | **High** | Keep `waveterm` dir name for now, or add legacy-detection migration. Never silently move user data. |
| Renaming `WAVETERM_*` env vars breaks user scripts | Medium | Accept both old + new; warn on old. |
| Upgrade modals reference removed features (Wave AI) | Medium (UX) | Suppress/replace in fork. |
| In-app doc links go to `docs.waveterm.dev` | Low | Keep (accurate for shared code) or remove; don't dead-link to `remoteterm.io` docs that don't exist. |
| Renaming Go import paths | High (merge pain) | **Don't.** Tier B. |
| Logo/wordmark still says "Wave" | Medium (brand) | Replace `logo.svg` content; can keep wave *motif* if acceptable. |

---

## 8. Recommended execution order

1. **Phase 1 — UI chrome rename (low risk, high visibility):** window title, About modal, menu, quit dialog, ARM64 dialog, welcome onboarding text. One PR.
2. **Phase 2 — onboarding coherence:** suppress/replace upgrade modals, remove Wave AI tips, add remote-first welcome content. One PR (can be the PR that also does §5 items 1–4).
3. **Phase 3 — README rewrite** + attribution. One PR.
4. **Phase 4 — data dir / env var rename** (separate, tested, with legacy compat). Own PR + decision record in `.pi/decisions.md`.
5. **Phase 5 — docs site & assets** (only if/when a `docs.remoteterm.io` is hosted; otherwise skip).
6. **Defer:** Go import paths, internal identifiers (never rename).

Each phase keeps diff surface small and upstream-mergeable. Phases 1–3 unblock a coherent "RemoteTerm" first impression without touching risky data-dir logic.

---

## 9. Open questions for the user — RESOLVED 2026-08-24

1. **Data directory:** keep on-disk `~/.waveterm` (safe) or rename to `~/.remoteterm` with migration? → **Keep `waveterm` on-disk** (migration risk not worth it now; own spec if revisited).
2. **Fork's own docs site:** will `docs.remoteterm.io` exist? → **No fork docs host for now**; in-app help links stay on `docs.waveterm.dev`.
3. **GitHub star/community links in welcome:** → **Star links point to the fork repo; Discord section removed.**
4. **Upgrade modals:** → **Suppressed entirely** (auto-open, registry, and "Release Notes" menu entry removed; files left unreferenced).
5. **Default first tab:** local shell (status quo) vs. "add a connection" prompt (remote-first)? → **Separate future spec** (see §5 item 5), not part of the rename.
6. **Logo:** keep the wave motif, or commission a new RemoteTerm mark? → **Keep the wave motif**; `aria-label`/wordmark surfaces already say RemoteTerm.
7. **Translations (ko/zh-TW README):** maintain or delete? → **Deleted** (plus `ROADMAP.md`) — stale upstream content advertising Wave AI / waveterm.dev.
8. **Repo/domain:** → **GitHub repo renamed to `whoisjeremylam/remoteterm`; domain is `remoteterm.io`** (not yet registered); `appId` → `io.remoteterm.app`.