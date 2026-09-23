# Spec: Web Agent API — Browser Control Fabric

**Date:** 2026-08-16
**Status:** Draft — full vision. **Useful v1 is locked:** [[web-agent-api-v1.md]] (implement next; do not implement the full surface from this file).
**Companion to:** [[wsh-agent-api.md]] ("agent control fabric" — v2 already shipped)

This file is the long-term design. Do not implement the full surface from here. Cut, gates, and the locked v1 command surface live in [[web-agent-api-v1.md]].

## Problem

Agents that need the web have no access to Wave Terminal's embedded browser. Wave already ships a full Chromium browser (Electron `<webview>`), and Electron exposes raw CDP natively via `webContents.debugger`. We want to expose that browser to agents the way tools like ego-lite do — a real browser the agent can observe and drive — so agents can log into sites, fill forms, scrape authenticated pages, and run web workflows.

## Design Position: Code-First

Agents interact with the browser primarily by **writing code** against a small, familiar JavaScript API, not by emitting a novel CLI per action.

**Rationale:**

1. **Latency & context.** Browser automation is multi-step (click → wait → fill → submit → read). Code-first collapses a whole sequence into one round-trip and one result; a discrete command per action is slow and context-heavy.
2. **Transfer learning.** Agents are trained on JavaScript and Playwright-style browser APIs (`getByRole`, `locator`, `click`, `fill`). A small familiar API transfers that skill; a novel CLI throws it away.
3. **Expressiveness.** Waiting, retries, loops, conditionals — trivial in code, awkward as discrete tool calls.
4. **Evolvability.** Agent-written web code encapsulates selectors and workflows. When a page changes, the code is updated in one place and re-run — it does not depend on re-teaching per-step CLI reasoning. (Skills that access the web benefit from the same property.)

**Counterweights (why not *only* code-first):** observability, step-by-step gating, and weaker-model robustness favor discrete tool calls. So we keep a thin discrete surface for the simple/safe cases, and make code-first the expressive primary path.

## Control Model

- **Transport:** direct CDP via Electron's `webContents.debugger.attach()` + `sendCommand()` on the webview guest `WebContents` (resolved via `getWebContentsByBlockId` → `webContents.fromId`). No `--remote-debugging-port`, no Playwright/Puppeteer. This is the same raw-CDP pattern ego-lite uses.
- **Observation:** an accessibility-tree snapshot (`Accessibility.getFullAXTree`) rendered as text with `@N` action refs (carrying `backendNodeId`/`role`/`name`), plus `Page.captureScreenshot` + coordinates as fallback for canvas/visual content. This is the format every serious tool converged on.
- **Actions:** `Runtime.evaluate` / `Runtime.callFunctionOn`, `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`, `DOM.getBoxModel` / `DOM.resolveNode`, `Page.navigate`.
- **Runtime host:** the agent's JS executes in the Node `emain` layer (mirroring ego-lite's `run.ts`), bridged to the webview via IPC → CDP. Wave's Go backend + wsh RPC + emain bridge means emain is the natural JS host.

## Command Surface

### Primary (code-first)

```
wsh web run [--block <block_ref>] [--background] [--partition <name>] -- <<'EOF'
await navigate("https://app.example.com");
await fill(getByRole("textbox", { name: "email" }), "user@example.com");
await click("@21");
EOF
```

Mini-API exposed to the script (small, documented, versioned):

- `navigate(url)` — `Page.navigate`
- `snapshot()` — AX snapshot with `@N` refs
- `click(ref | [x,y])` — `Input.dispatchMouseEvent` (+ `elementFromPoint` fallback)
- `fill(ref, text)` / `type(text)` — focus + `Input.dispatchKeyEvent`
- `getByRole(...)` / `getByText(...)` / `getByLabel(...)` — Playwright-style locators → refs
- `js(expr)` — `Runtime.evaluate`
- `cdp(method, params)` — raw escape hatch
- `screenshot([path])` — `Page.captureScreenshot`
- `waitFor(selector, timeout)` — poll

### Secondary (discrete)

- `wsh web open <url> [--background] [--partition <name>]` — create a web block (optionally in a background tab)
- `wsh web get <selector> [--inner] [--all] --json` — un-hide the existing command
- `wsh web snapshot --json` — one-shot AX snapshot
- `wsh web screenshot [--path]`
- `wsh web close <block_ref>` — via `block kill`

## Session & Auth Model

- The webview is full Chromium: cookies, localStorage, IndexedDB, service workers all work; standard login forms and HTTP-redirect OAuth work (popups handled via `allowpopups` + `setWindowOpenHandler`).
- **Partitions** (`webview` `partition` attribute, already wired as block meta `web:partition`): `persist:<name>` gives an isolated, persistent cookie jar — the Electron equivalent of Chrome profiles. Different blocks can hold different logged-in sessions. No partition = shared default session.
- **Logout/clear:** `clear-webview-storage` IPC already calls `session.clearStorageData()`.

## Credentials & Secrets Bridge

The browser has no password manager, but Wave's `wsh secret` store (OS-keychain-backed via Electron `safeStorage`) closes the *storage* gap. The code-first path bridges storage → browser:

```js
await fill(getByRole("textbox", { name: "password" }), secret("github_password"));
await click("@submit");
```

- `secret(name)` — mini-API helper that resolves a secret by name and injects the value directly into the script. The plaintext never appears on the command line, in shell history, or in process args (no `$(wsh secret get …)`).
- **Secrets are referenced by name, never inlined** in scripts/configs — matching the existing `ssh:passwordsecretname` pattern (`pkg/remote/sshclient.go` resolves the name via `secretstore.GetSecret` at connect time).
- **Scoping (open question):** a browser agent should not automatically read every secret. Consider a namespace allowlist (e.g. `web_*`) or an explicit per-script grant.

**Non-goal:** this is credential *storage + injection*, not a password manager — no per-site association, auto-fill, or form detection.

## Trust & Security

- CDP access lets an agent act *as the user* in logged-in sessions (cookies), read screen content, fill/submit forms. This exceeds the "human can do it via UI/keyboard" guardrail — a deliberate scope expansion.
- **Gate:** `agent:allowbrowsercontrol`, default **off**, analogous to `agent:allowremotelocalcontrol`. Remote-origin agents driving a local browser session are additionally subject to the remote→local trust boundary.
- Per-partition isolation is the natural unit for scoping ("agent may drive the `persist:work` partition, not `persist:personal`").

## Limitations of the Electron Browser

- **No OS password manager / keychain integration.** Logins persist only in the partition's Chromium storage; no credential sync or manager (and no Chrome extension support).
- **WebAuthn/passkeys** — platform passkeys and hardware keys are a known rough edge in Electron; may not surface OS prompts cleanly. *(Deferred — not a blocker; too few target sites require them yet.)*
- **Automation detection** — some sites flag Electron UA or missing chrome; UA spoofing (`useragent` meta) mitigates but doesn't eliminate.
- **Downloads** — require `will-download` handling.
- **Partitions are local** — they don't roam across machines.
- **"Hidden" is a background tab**, not a detached headless process (a `<webview>` must stay DOM-attached).

## Build Order (phases)

Useful v1 (see [[web-agent-api-v1.md]]) is phases 1–4 + 6, **without** Playwright locators, downloads, or new partition CLI:

1. Un-hide and extend `wsh web get` (executeJavaScript path already works).
2. AX-snapshot RPC + `wsh web snapshot`.
3. CDP bridge in emain (`webContents.debugger`) + `wsh web run` runtime + mini-API (`navigate`, `snapshot`, `click`/`fill`/`type` by `@N`, `js`, `cdp`, `secret`).
4. Screenshot + `Input.*` dispatch for click/type.
5. Partition/session support + auth-flow validation — **after v1**.
6. `agent:allowbrowsercontrol` trust gate — **in v1**, default off; still stacked with `agent:allowremotelocalcontrol`.

Playwright-style `getByRole` / `waitFor(selector)` / `--background` / download handling are post-v1.

## Out of Scope (for now)

- Cloud/hosted browser (Browserbase-style)
- Multiple OS-level profiles with sync
- Browser extensions
- Full Playwright/Puppeteer as a dependency
- Streaming network capture to a live feed (one-shot capture only)

## Test Cases

| # | Scenario | Type | Expected |
|---|----------|------|----------|
| 1 | `wsh web open https://example.com --background` | happy | web block created in background tab; not focused |
| 2 | `wsh web run -- navigate(...); snapshot()` | happy | returns AX snapshot with `@N` refs |
| 3 | `wsh web run -- click("@21")` on a button | happy | click dispatched; observable page state changes |
| 4 | `wsh web run -- fill(ref, "text")` into an input | happy | input value set; form submittable |
| 5 | `wsh web run -- js("1+1")` | happy | returns `2` |
| 6 | `wsh web get ".selector" --json` | happy | returns matching outerHTML |
| 7 | `wsh web run --` on a non-web block | error | "not a web block" |
| 8 | `wsh web screenshot --path out.png` | happy | PNG written, non-empty |
| 9 | login flow: fill → submit → waitFor → snapshot | happy | authenticated page observed |
| 10 | `wsh web run` targeting `persist:work` vs `persist:personal` | edge | separate cookie jars (logins don't leak across partitions) |
| 11 | browser control with `agent:allowbrowsercontrol=false` | security | command rejected |
| 12 | remote-origin agent drives local webview, gate off | security | rejected (remote→local boundary) |

## Open Questions

Answered on [[web-agent-api-v1.md]] (locked). Remaining for the **full vision**, not v1:

- Per-partition allowlists
- Secret namespace grants
- Whether a later discrete `web click` should use an emain ref cache
- Downloads, locators, `--background`, MCP

## Resolved

- **2026-08-16 — Passkeys/WebAuthn: not a blocker.** Too few target sites require them yet; deferred until demand. The Electron rough edge stays documented under Limitations.
- **2026-09-02 — Useful v1 cut.** Embedded `<webview>` + emain CDP + `@N` snapshot + click/fill + `secret()` + `agent:allowbrowsercontrol` (default off). Locators, downloads, `--background`, partition CLI, MCP: later.
- **2026-09-02 — Useful v1 locked.** Asymmetric hybrid: discrete observation (`snapshot` / `screenshot` / `get`); code-first action (`web run` mini-API). No discrete click/fill; no Playwright `page` object; no ego-lite task spaces. Details on [[web-agent-api-v1.md]].
