# Spec: Web Agent API — Useful v1

**Date:** 2026-09-02
**Status:** Locked, ready to implement
**Parent (full vision):** [[web-agent-api.md]]
**Companion (already shipped):** [[wsh-agent-api.md]] / [[agent-control-fabric-v2.md]]
**Research:** [[../research/ai-agent-browsers.md]]
**Reference (patterns, not a dependency):** [citrolabs/ego-lite](https://github.com/citrolabs/ego-lite)

Do **not** implement until this spec is locked. It is locked. Next session implements on `feat/agent-control-fabric` (or a branch off it). Do not commit/push unless asked.

## What this is

Wave’s **web widget** — the Electron `<webview>` already opened by `wsh web open`. Not a separate Chrome, not a cloud browser, not Playwright as a dependency.

The guest page is a Chromium `WebContents`. Electron exposes CDP via `webContents.debugger.attach()` / `sendCommand()`. Agent JS runs in **emain** (Node), not in the page. Secrets resolve in emain and enter the page only via `Input.*` / fill — never via `executeJavaScript` of the agent script.

This exceeds the “human can do it via UI/keyboard” guardrail: CDP acts as the logged-in user (cookies, forms, screen). That is a deliberate scope expansion and needs its own opt-in gate.

## Surface design (critical review)

ego-lite is a useful reference for **transport and observation**, not a template for Wave’s agent CLI.

### What ego-lite actually is

The public repo is a Node helper + skill. The agent-facing “CLI” is **not** `ego-browser click 3`. It is:

```bash
ego-browser nodejs <<'EOF'
await openOrReuseTab('https://example.com', { wait: true })
cliLog(await snapshotText())
await click('@21')
EOF
```

Their bet is explicit: **code-base, not CLI-base**. Helpers (`snapshotText`, `click`, `fillInput`, `js`, `cdp`, `wait`, …) are injected into a short-lived `AsyncFunction`. Observation is an accessibility-tree snapshot with ephemeral `@N` refs. Actions are real CDP `Input.*`, not page `.click()`. `cdp()` is the escape hatch (including JS dialogs). Task spaces isolate agent tabs from the user’s.

That is the same mechanism Electron already gives us (`webContents.debugger` ≈ `globalThis.ego.sendCDPMessage`). Copying the CDP/AX/`Input.*` core is correct. Copying ego-lite’s product surface is not.

### Why Wave should not clone ego-lite’s product

| ego-lite | Wave |
|----------|------|
| The browser **is** the product; the heredoc is the only agent API | Agents already speak `wsh` (agent fabric v2, `skills/wsh-agent/SKILL.md`) |
| Fresh Node process per heredoc; no durable helper state | **emain is long-lived** — we could cache refs, but we must not leave the debugger attached |
| Task spaces + handoff protocol | A **web block** is the isolation unit; `web:partition` already exists; do not invent Spaces |
| Large helper bag (`dragMouse`, `uploadFile`, `waitForElement`, `page.locator`, `getByRole`) | v1 is a **small documented function set**. A fake `page` object invites `page.getByRole` which we will not ship |
| `cliLog` is the only stdout | `print()` + optional return value; same idea, less cute |
| Local macOS browser | This fork is **remote-first**: each extra `wsh` round-trip is RPC through connserver |

Playwright MCP / Chrome DevTools MCP / Vercel agent-browser are the other cluster: **one tool call per action**. Fine for an MCP server that holds a session. Wave’s `wsh` is one process per invocation. Discrete `wsh web click @3` only works if emain caches the last snapshot’s ref map and invalidates it on navigation. That cache is real work and a stale-ref footgun. It is not needed if actions happen inside one `web run`.

### Options considered

1. **Discrete CLI only** (`wsh web snapshot` / `click` / `fill` / `type`). Closest to existing `wsh block send-keys`. Easy to audit per action. Bad for this fork: login/search is 8–20 RPCs over SSH; `@N` refs die between invocations unless we build a cache; we would still implement the same CDP guts.
2. **Code-first only** (no discrete snapshot). Matches ego-lite. Forces a script even to *look* at a page. Weak for humans and for “orient, then think, then act” loops.
3. **MCP adapter.** Out of v1 (and out of this workstream).
4. **Playwright `page` object in the mini-API.** Transfer-learning bait. Without locators and auto-wait it is a lie. Rejected for v1.
5. **Asymmetric hybrid (chosen).** Discrete **observation**; code-first **action** in one `web run`; no discrete click/fill CLI.
6. **Crawl4AI / Firecrawl / `crwl` CLI (rejected as the Wave surface).** These are **crawlers**: URL in → cleaned markdown / JSON out, via their own Playwright Chromium. They are good at boilerplate stripping, `fit_markdown`, shadow-DOM flatten, iframe merge, cookie-banner removal, and schema extraction. They are the wrong product for this spec.
   - The job is to drive **Wave’s already-open `<webview>`** (same cookies, partition, screen), not to launch a second browser.
   - Auth in Crawl4AI is a **separate** `user_data_dir` profile (`crwl profiles`), not the widget the user is looking at.
   - Attaching Crawl4AI to Electron requires `--remote-debugging-port` + Playwright `connect_over_cdp` — already rejected (exposes every WebContents, Chromium version drift, fights webview lifecycle).
   - Python + Playwright is a new runtime in the Wave/Electron app. Agents on a remote host can already install `crwl` themselves for *public* URL ingest; that does not need a Wave feature.
   - Crawl4AI’s click/fill lives in **crawl hooks** around `arun()`, not an observe → decide → act loop with `@N` refs.
   - AX snapshots answer “what can I click?” Markdown extractors answer “what is the article?” Both intricacies are real; they are not the same API. v1 ships the action loop. A later `wsh web markdown` may steal **algorithms** (Readability / html2text / pruning) running on HTML from the guest — not vend Crawl4AI.

### Locked surface

- **Open a page:** existing `wsh web open` (ungated). Close with existing `wsh block kill`.
- **Look:** `wsh web snapshot`, `wsh web screenshot`, un-hide `wsh web get`. These return data. They do not keep `@N` action capability for a later process.
- **Act:** `wsh web run` with a small function mini-API. Snapshot inside the same script, then `click`/`fill` those refs. Multi-step (navigate → fill → submit → read) is one RPC — the point of code-first on a remote-first product.
- **Do not ship** `wsh web click` / `fill` / `type` / `cdp` as top-level commands in v1.
- **Do not persist** `@N` refs across `wsh` invocations in v1. Refs live for one `web run`. Discrete `snapshot` is for reading, not for feeding a later `click`.
- **Teach it** by extending `skills/wsh-agent/SKILL.md` and `wsh agent help` — not a second ego-browser-style skill package.

`js()` and `cdp()` stay **inside** `web run` only. A top-level `wsh web cdp Runtime.evaluate …` is session RCE with a worse audit story.

## Effort (from 2026-09-02 estimate)

| Slice | Scope | Rough size |
|--------|--------|------------|
| Thin | Un-hide `web get`; raw AX dump; `web run` with `js()` / `navigate` only | 2–4 days. Not the target. |
| **Useful v1 (this spec)** | CDP attach, compact `@N` snapshot, click/fill/type, `secret()`, screenshot, trust gate, DevTools-attach conflict, tab-targeting fix | **~1.5–2.5 weeks** |
| Full parent spec | Playwright locators, `waitFor` polish, partition targeting CLI, `--background`, login-flow hardening, downloads | ~3–5 weeks |

Hard parts are AX formatting, `Input.*` vs synthetic JS events, one debugger per webview, and site fingerprinting — not Go RPC plumbing.

## Locked for v1

- **Target:** existing web block’s guest `WebContents` (`getWebContentsByBlockId` in `emain/emain-web.ts`, fixed to address the block’s **tab**, not only the active tab).
- **Transport:** Electron `webContents.debugger` only. No `--remote-debugging-port`, no Playwright/Puppeteer package.
- **Primary path:** code-first `wsh web run` with a small documented JS mini-API executed in emain as `AsyncFunction` with helpers as named args (no `require`, no `process` in the helper bag). Same idea as ego-lite `run.ts`, smaller API.
- **Discrete path (observation only):** un-hide `wsh web get`; add `wsh web snapshot` and `wsh web screenshot`; close via existing `wsh block kill` (no new `web close`).
- **Mini-API in v1:** `navigate`, `snapshot`, `click(ref | [x,y])`, `fill(ref, text)`, `type(text)`, `js(expr)`, `cdp(method, params)`, `screenshot()`, `secret(name)`, `sleep(ms)`, `print(...)`, `pageInfo()`.
- **Click/fill:** CDP `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` (plus `elementFromPoint` fallback). Do not rely on page JS `.click()` as the only path — sites ignore synthetic events.
- **Trust:** new setting `agent:allowbrowsercontrol`, **default off**. Also subject to existing `agent:allowremotelocalcontrol` when a remote-origin `wsh` drives a **local** webview (a webview is always local Electron). Do **not** widen the connection gate; reuse the same decision as `shouldAllowRemoteLocalControl` with target conn `""` / `local`.
- **Gated commands:** `web run`, `web snapshot`, `web screenshot`, `web get`. **Not gated:** `web open` (creates a block; same class as `wsh block new --view web`).
- **Secrets:** `secret(name)` resolves via Wave secret store from emain (`GetSecretsCommand`); plaintext never on the CLI / `ps` / shell history / audit logs. Any store name; audit the **name**. Grants later (same as agent-fabric v2).
- **Passkeys / WebAuthn:** deferred (already resolved 2026-08-16).
- **Downloads:** not v1.
- **Playwright locators** (`getByRole` / `getByText` / `getByLabel`) and a `page` object: not v1.
- **`--background` / partition CLI flags** on `web open` / `web run`: not v1. Partitions already exist as block meta `web:partition`; v1 may *use* an existing partitioned block, without new targeting flags.
- **No MCP adapter** in this workstream.

## Resolved questions

### 1. Wait primitive — `sleep(ms)` + snapshot loop; `navigate` waits for load

No first-class `waitFor(selector)` / `waitForText` / `waitForElement` in v1 (those are locator-adjacent). Scripts use:

- `await navigate(url)` — `Page.navigate` then wait for this navigation’s `loaderId` lifecycle / main-frame load (or URL match for same-document hash). Do **not** complete just because the previous document is already `complete`. Honor `errorText`. Cap with the remaining run timeout.
- `await sleep(ms)` — cap per call at **30s**; loop in user JS for longer.
- `await snapshot()` / `await pageInfo()` in a loop until URL/text matches.

Document this in SKILL.md. First-class `waitFor` is v1.1 / parent spec.

### 2. Secret scope — any name, audit the name, no plaintext

Same as agent-fabric v2. No `web_*` prefix and no per-run grant in v1. Missing name → error, no hang. Never log values.

### 3. Default block — same resolver as other wsh commands

`this`, uuid / uuid8, block number, `view:N` / title substring via existing `resolveBlockArg()`. Error if target `view != web`. `this` when `wsh` is invoked from a term block targeting a web block requires `-b` / `--block` (same as `wsh web get` today). Do not special-case “focused web block” — that surprises remote agents whose focused block is a terminal.

### 4. Script size / timeout / stdout

| Limit | Value |
|-------|--------|
| Script bytes | **256 KiB**. Over → error, do not run. |
| Default run timeout | **60s** (`--timeout` using existing `parseDurationFlag`; same grammar as `wsh run` / `wsh block wait`). |
| Max timeout | **5m**. |
| RPC timeout | CLI must set `RpcOpts.Timeout` **greater than** the run timeout (run + **20s** slack). Lookup can take 5s; attach/config/secrets happen before the run clock. `web get` / `snapshot` / `screenshot` use 15s. |
| `js()` / `cdp()` / `snapshot` result | Truncate snapshot text at **64 KiB** or **800 lines**, whichever first; set `truncated: true` on the RPC when clipped. `js()` return JSON at **1 MiB**. |

Stdout of `web run`:

- `print(...args)` concatenates stringified args + newline (ego-lite `cliLog`).
- `console.log` is **not** captured (avoid fighting Node). Teach `print`.
- If the async script **returns** a value other than `undefined`, append a line: if string, raw; otherwise JSON.
- On throw: non-zero exit, error message on stderr, **no** partial stdout requirement (implementations may still print what was `print`ed before the throw).
- Do **not** auto-return `snapshot()`.

One-liners: `wsh web run -- 'await print(await snapshot())'` (remaining args joined) **or** stdin when no args (heredoc). Not both. If args and stdin are a TTY, args win; if no args, read stdin (must be non-empty).

### 5. DevTools conflict — refuse, do not steal

If `webContents.isDevToolsOpened()` or `debugger.isAttached()` by something other than us: error

```
web block <id>: DevTools (or another debugger) is attached; close DevTools and retry
```

Do not `debugger.detach()` a user’s DevTools. Attach at the start of each gated command; **detach in `finally`** when the command ends. Do not leave the debugger attached between `wsh` invocations (that would block the user from opening DevTools).

### 6. Non-active-tab webviews — fix targeting in v1; do not auto-focus

`getWebContentsByBlockId` today sends IPC only to `ww.activeTabView`. The preload handler queries `div[data-blockid=…] webview` **in that renderer**, so a web block on another tab returns null.

**In scope:** send the IPC to the `WaveTabView` for `data.tabid` (`getWaveTabView(tabId)` / `allLoadedTabViews`), not only `activeTabView`. Raise the 2s timeout to **5s**.

If that tab’s view is not loaded (never activated, or destroyed):

```
web block <id>: tab is not loaded in the window (switch to that tab once so the webview stays attached)
```

Do **not** auto-`SetActiveTab` / steal focus (agent-fabric default). Do **not** add `--background` on `web open`. Visited tabs stay in `allLoadedTabViews` off-screen; that is enough for v1.

### 7. `cdp()` in v1 — yes, inside `web run` only

Needed for JS dialogs (`Page.handleJavaScriptDialog`), odd widgets, and AX gaps. Same trust gate + audit of **method name**, never params (params can contain secrets). Allowlist is **not** v1 — the gate is the allowlist.

### 8. Audit events — yes, mirror `[agent-audit]`

`log.Printf("[agent-audit] …")` on: `web run` (block id, script **byte length**, not body), `web snapshot`, `web screenshot`, `web get` (block id + selector **length**, not selector text if it might contain secrets — log selector, it is CSS not a password; OK to log), `secret(name)` (name only), `cdp(method)` (method only). Never secret values, never screenshot bytes, never `js()` expressions.

## Out of v1 (stay on parent spec)

- Cloud/hosted browser
- Browser extensions
- Full Playwright/Puppeteer
- Streaming network capture
- Per-partition allowlists (“agent may drive `persist:work` but not `persist:personal`”)
- Secret namespace grants (`web_*` only)
- `waitFor(selector)` / locators / `page` object
- Discrete `web click` / `web fill` / persistent `@N` cache
- `--background`, partition CLI, MCP
- Task spaces / user↔agent handoff protocol
- Downloads, file inputs, screencast
- Auto-focusing a background tab to attach CDP
- Crawl4AI, Firecrawl, Playwright-as-a-crawler, or any second browser for “read the page as markdown”
- `wsh web markdown` / Readability-style article extract (optional later; steal algorithms, not the crawler stack)

## Existing code (reuse, do not reimplement)

| Piece | Where |
|--------|--------|
| `wsh web open` / hidden `wsh web get` | `cmd/wsh/cmd/wshcmd-web.go` |
| `WebSelectorCommand` RPC | `pkg/wshrpc/wshrpctypes.go` → `emain/emain-wsh.ts` `handle_webselector` |
| Block → guest `WebContents` | `emain/emain-web.ts` `getWebContentsByBlockId` (**must fix tab targeting**) |
| Preload id lookup | `emain/preload.ts` `webcontentsid-from-blockid` |
| CSS `executeJavaScript` scrape | `emain/emain-web.ts` `webGetSelector` |
| Tab view map | `emain/emain-tabview.ts` `getWaveTabView` / `emain-window.ts` `allLoadedTabViews` |
| Partition meta | `web:partition` on block meta; `frontend/app/view/webview/webview.tsx` |
| Clear storage | IPC `clear-webview-storage` in `emain/emain-ipc.ts` |
| Layout screenshot (not page CDP) | existing `CaptureBlockScreenshotCommand` — **not** a substitute for `Page.captureScreenshot` |
| Connection gate (leave alone) | `agent:allowremotelocalcontrol` / `pkg/wshrpc/wshserver/trustgate.go` |
| Duration flags | `cmd/wsh/cmd/wshcmd-duration.go` `parseDurationFlag` |
| Agent CLI patterns | `cmd/wsh/cmd/wshcmd-agent.go`, `skills/wsh-agent/SKILL.md` |
| Secrets | `GetSecretsCommand` / `pkg/secretstore` |

RPC commands that talk to the webview must use `RpcOpts.Route = wshutil.ElectronRoute` (same as `web get` today).

When implementing: read `.kilocode/skills/add-rpc/SKILL.md`, `add-wshcmd/SKILL.md`, `add-config/SKILL.md`. New wsh subcommands require a version bump (`node version.cjs minor` for this feature).

## Trust wiring

Web RPCs land in **emain** (ElectronRoute), so `wshserver.checkRemoteToLocalControl` does not run unless we wrap. v1 must still enforce both gates.

**Implement** a shared emain helper `assertWebAgentControl(rh)` (name flexible):

1. `GetFullConfigCommand` → reject unless `settings["agent:allowbrowsercontrol"]` is true. Error: `browser control is disabled (set agent:allowbrowsercontrol to enable)`.
2. Parse RPC source / origin conn. If origin is remote SSH (not local, not WSL, not empty) → reject unless `agent:allowremotelocalcontrol`. Error text **must match** trustgate.go: `remote-to-local control is disabled (set agent:allowremotelocalcontrol to enable)`.
3. Call this at the top of `web run` / `snapshot` / `screenshot` / `web get` handlers.

Do **not** change `shouldAllowRemoteLocalControl` semantics. Optionally extract a tiny duplicated predicate in TS that matches `trustgate.go` (local = `""` / `local` / `local:*`; WSL = `wsl://`). Webview target conn is always local.

`web open` does not call this helper (CreateBlock already has the connection gate when the block’s connection is local; web blocks typically have no SSH connection).

## CLI help text

```
web
  open        Open a URL in a web widget (existing)
  get         Get HTML for a CSS selector (un-hidden)
  snapshot    Accessibility snapshot with @N refs (observation only)
  screenshot  Capture the page (CDP), not the block chrome
  run         Run a JS mini-API script against the web widget
```

### `wsh web run`

```
wsh web run [-b block] [--timeout duration] [--json] [--] [script]
wsh web run [-b block] [--timeout duration] [--json]    # script on stdin

Run a JavaScript snippet in the Electron main process against a web block.
Helpers are injected; the page is driven via CDP. Requires
agent:allowbrowsercontrol.

Flags:
  -b, --block     target web block (default: this)
  --timeout       run budget (default 60s, max 5m; 30s, 5m, or integer seconds)
  --json          { "blockid", "url", "title", "stdout", "result", "truncated" }

Examples:
  wsh web open https://example.com
  wsh web run -b <web-block> -- 'await navigate("https://example.com"); await print(await snapshot())'
  wsh web run -b <web-block> --timeout 2m <<'EOF'
await navigate("https://example.com");
const snap = await snapshot();
await print(snap);
await click("@1");
EOF
```

### `wsh web snapshot`

```
wsh web snapshot [-b block] [--json]

Print a compact accessibility snapshot. @N refs are for humans/agents to read;
they are not valid in a later process. Use snapshot() inside web run to click.

Flags:
  -b, --block
  --json          { "blockid", "url", "title", "snapshot", "truncated" }
```

### `wsh web screenshot`

```
wsh web screenshot [-b block] [--path file] [--json]

CDP Page.captureScreenshot (the page, not block chrome). PNG bytes return on
the RPC; the CLI writes --path on the machine where wsh runs (remote-friendly,
same as wsh block screenshot --output).

Flags:
  -b, --block
  --path          write PNG here (wsh's filesystem)
  --json          { "blockid", "bytes", "path"? }  bytes = PNG size; not the PNG
Without --path and without --json: write PNG to stdout (binary). Prefer --path
or --json for agents.
```

### `wsh web get` (un-hide)

Keep existing flags (`--inner`, `--all`, `--json`, `-b`). Unset `Hidden`. Same gate as snapshot. Docs in `docs/docs/wsh-reference.mdx`.

## RPC names + payloads

Add to `WshRpcInterface` under the emain section. `task generate`. Implement in `emain/emain-wsh.ts`. CLI always `Route: ElectronRoute`.

```go
WebRunCommand(ctx context.Context, data CommandWebRunData) (*WebRunResult, error)
WebSnapshotCommand(ctx context.Context, data CommandWebSnapshotData) (*WebSnapshotResult, error)
WebScreenshotCommand(ctx context.Context, data CommandWebScreenshotData) (*WebScreenshotResult, error)
// WebSelectorCommand already exists — add the gate in handle_webselector
```

```go
type CommandWebRunData struct {
    WorkspaceId string `json:"workspaceid"`
    BlockId     string `json:"blockid"`
    TabId       string `json:"tabid"`
    Script      string `json:"script"`
    TimeoutMs   int64  `json:"timeoutms,omitempty"` // default 60000
}

type WebRunResult struct {
    BlockId    string          `json:"blockid"`
    URL        string          `json:"url,omitempty"`
    Title      string          `json:"title,omitempty"`
    Stdout     string          `json:"stdout"`
    Result     json.RawMessage `json:"result,omitempty"` // script return value, if any
    Truncated  bool            `json:"truncated,omitempty"`
}

type CommandWebSnapshotData struct {
    WorkspaceId string `json:"workspaceid"`
    BlockId     string `json:"blockid"`
    TabId       string `json:"tabid"`
}

type WebSnapshotResult struct {
    BlockId   string `json:"blockid"`
    URL       string `json:"url,omitempty"`
    Title     string `json:"title,omitempty"`
    Snapshot  string `json:"snapshot"`
    Truncated bool   `json:"truncated,omitempty"`
}

type CommandWebScreenshotData struct {
    WorkspaceId string `json:"workspaceid"`
    BlockId     string `json:"blockid"`
    TabId       string `json:"tabid"`
}

type WebScreenshotResult struct {
    BlockId string `json:"blockid"`
    Data64  string `json:"data64"` // raw PNG base64, no data: URL prefix
}
```

JSON tags lowercase. CLI fills workspace/tab/block from `BlockInfoCommand` like `web get`.

## Mini-API TypeScript signatures

Executed in emain. All page-touching helpers are async. `ref` is `"@N"` or `"N"` from the **current run’s** last `snapshot()`; stale refs error clearly.

```ts
function navigate(url: string): Promise<{ url: string; title: string }>;
function snapshot(): Promise<string>; // AX text; also refreshes @N map for this run
function click(target: string | [number, number]): Promise<void>;
function fill(ref: string, text: string): Promise<void>;
function type(text: string): Promise<void>; // into the focused element
function js(expr: string): Promise<unknown>; // Runtime.evaluate, returnByValue, awaitPromise
function cdp(method: string, params?: object): Promise<unknown>;
function screenshot(): Promise<string>; // PNG base64; no path argument in v1
function secret(name: string): string; // sync throw if missing; value never printed
function sleep(ms: number): Promise<void>; // max 30_000 per call
function print(...args: unknown[]): void;
function pageInfo(): Promise<{ url: string; title: string; w: number; h: number }>;
```

Runtime: `new AsyncFunction(...helperNames, '"use strict";\n' + script)` with helpers as arguments. Do not copy ego-lite’s `Object.assign(globalThis, context)`.

`fill` focuses the ref (DOM.getBoxModel / resolveNode), selects existing content, then `Input.insertText` / key events — not `element.value =` as the only path.

`click("@N")` uses the ref’s box-model center. `click([x,y])` is CSS viewport pixels.

`secret()` is a **function**, not an async CDP call. Implementation may be sync after a prefetch, or a blocking helper; it must throw on missing names before any fill.

## AX snapshot text format

Built from `Accessibility.getFullAXTree`. Skip `ignored` nodes. Interactive roles (`button`, `link`, `textbox`, `searchbox`, `checkbox`, `radio`, `combobox`, `menuitem`, `slider`, `tab`, `switch`, `option`) get `@N`. `N` is 1-based in tree order. Store `backendDOMNodeId` in the **run-local** ref map only.

Example:

```
url: https://example.com/
title: Example Domain
- heading "Example Domain"
- StaticText "This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission."
@1 link "More information..."
```

Rules:

- Header is always `url:` and `title:` lines.
- Non-interactive named nodes: `- <role> "<name>"` (indent optional in v1; one level is enough).
- Interactive: `@N <role> "<name>"` plus `value="…"` when the AX node has a non-empty value (inputs).
- `@N` is **not** a CSS selector. `js("document.querySelector('@1')")` will not work; say so in SKILL.md.
- No `loc=` stable locators in v1 (ego-lite has them; we do not).
- After navigation or `snapshot()`, previous `@N` in **this run** are replaced.

## Config key

`pkg/wconfig/settingsconfig.go` `SettingsType` (global only — **not** `MetaTSType`):

```go
AgentAllowBrowserControl bool `json:"agent:allowbrowsercontrol,omitempty" jsonschema:"description=Allow wsh to drive the embedded web widget via CDP (snapshot, screenshot, run, get)"`
```

Default **off** (omit from `defaultconfig/settings.json`). `task generate` updates `schema/settings.json` and `metaconsts.go`. Document in `docs/docs/config.mdx`. `wsh config set agent:allowbrowsercontrol true`.

Do not add `agent:allowbrowsercontrol` to block metadata in v1.

## Debugger session

Per gated command:

1. Resolve guest `WebContents` (fixed tab targeting).
2. `assertWebAgentControl`.
3. If DevTools open or foreign debugger attached → refuse.
4. `debugger.attach('1.3')` (or Electron’s default protocol version).
5. Enable `Accessibility` / `Runtime` / `Page` as needed.
6. Run the command.
7. `debugger.detach()` in `finally`.

If attach fails because DevTools opened mid-command, fail the command; do not retry-steal.

## Risks (named)

1. **One debugger attach per `WebContents`.** User DevTools and the agent cannot both be attached. v1 **refuses**; does not steal. Detach after every command.
2. **Hidden ≠ headless.** A `<webview>` must stay DOM-attached. Off-screen loaded tab is OK; a tab that was never loaded is not.
3. **`js()` / `cdp()` are session RCE** in that block’s partition (logged-in cookies). Gate + audit. Never log secret values. Mini-API is not a secure sandbox — it is opt-in power.
4. **Electron UA / automation detection.** Document; UA spoof via existing `web:useragenttype` / useragent meta is mitigation, not a guarantee.
5. **Tab targeting.** Must not silently only work on the active tab (Q6).
6. **Screenshot path confusion.** Mini-API `screenshot()` returns base64. Discrete `--path` is written by **wsh** (possibly remote). Do not write files from emain in v1.
7. **Agent JS in emain.** The script is privileged Node with only injected helpers, but it is still code the user opted into. Keep the helper set small.

## v1 test cases (ship gate)

Parent cases `--background`, full login+`waitFor`, partition CLI are **not** v1 ship gates.

| # | Scenario | Expected |
|---|----------|----------|
| 1 | `wsh web open https://example.com` | web block created (existing) |
| 2 | `wsh web run` + `navigate` + `print(await snapshot())` | AX text with `@N` refs |
| 3 | same run: `click("@N")` on a button | observable page change |
| 4 | `fill(ref, "text")` | input value set |
| 5 | `js("1+1")` then `print` / return | `2` |
| 6 | `wsh web get ".selector" --json` | un-hidden; matching HTML |
| 7 | `web run` on a term block | error: not a web block |
| 8 | `wsh web screenshot --path out.png` | non-empty PNG (CDP page shot); file where wsh ran |
| 9 | `agent:allowbrowsercontrol=false` | `web run` / `snapshot` / `screenshot` / `get` rejected; `web open` still works |
| 10 | remote-origin agent, local webview, `allowremotelocalcontrol` off | rejected (existing error string) |
| 11 | DevTools already open on that webview | clear error, no attach, DevTools stays open |
| 12 | `secret("missing")` | error, no hang |
| 13 | `web snapshot` then a **new** `web run` `click("@1")` without snapshot in the script | error: unknown/stale ref (no cross-process ref cache) |
| 14 | web block on a **loaded background tab** (visited, then switched away) | `web snapshot` / `run` succeed without focusing that tab |
| 15 | web block on a tab that was **never** loaded | clear “tab is not loaded” error |
| 16 | script > 256 KiB | rejected, not executed |
| 17 | `cdp("Runtime.evaluate", {expression: "1+1"})` | result `2` (or CDP envelope); audited method name only |

Unit tests (no Electron): AX formatter (ignored nodes, `@N` assignment, truncation); ref parser (`@1` / `1`); script size check; timeout parse; gate predicate (browser control off; remote×local). Table-driven Go and/or TS, `t.Run` / vitest, manual `if` assertions in Go, no testify.

## Implementation checklist

1. Config: `AgentAllowBrowserControl` + generate + `docs/docs/config.mdx`.
2. Fix `getWebContentsByBlockId` to use `tabId`’s `WaveTabView`; 5s timeout; explicit errors.
3. New file `emain/emain-web-agent.ts` (or similar): debugger attach/detach, AX formatter, Input click/fill/type, `AsyncFunction` runner, `assertWebAgentControl`.
4. RPCs in `wshrpctypes.go` → `task generate` → `emain/emain-wsh.ts` handlers.
5. CLI in `cmd/wsh/cmd/wshcmd-web.go` (+ tests for flags/size/timeout/not-a-web-block). Un-hide `get`.
6. Gate `handle_webselector`.
7. Audit logs.
8. `skills/wsh-agent/SKILL.md` + `wsh agent help` / `--json` (`agentHelpDocVersion` bump) + `docs/docs/wsh-reference.mdx`.
9. `node version.cjs minor` once at the end (new wsh subcommands + RPCs).
10. Do not commit/push unless asked.

### Files likely touched

| Area | Files |
|------|--------|
| Config | `pkg/wconfig/settingsconfig.go` → `task generate` → `schema/settings.json`, `pkg/wconfig/metaconsts.go`, `frontend/types/gotypes.d.ts` |
| RPC | `pkg/wshrpc/wshrpctypes.go`, generated `wshclient.go`, `wshclientapi.ts` |
| Emain | `emain/emain-web.ts`, `emain/emain-web-agent.ts` (new), `emain/emain-wsh.ts`, maybe `emain/preload.ts` (only if lookup must change) |
| CLI | `cmd/wsh/cmd/wshcmd-web.go`, `wshcmd-web_test.go` (new), `wshcmd-agent.go` (help text + JSON commands) |
| Docs / skill | `docs/docs/wsh-reference.mdx`, `docs/docs/config.mdx`, `skills/wsh-agent/SKILL.md` |

## Implementation order (same loop as agent-fabric v2)

1. Config + gate helper + tests for the predicate.
2. Tab targeting fix + snapshot RPC + `wsh web snapshot` + un-hide get (gated).
3. Debugger runner + mini-API (`navigate`, `snapshot`, `print`, `sleep`, `pageInfo`, `js`) + `wsh web run`.
4. `click` / `fill` / `type` via `Input.*` + `secret` + `cdp` + screenshot.
5. Help/skill/docs + version bump + ship-gate tests.

## Next-session starter prompt (implement)

> Implement locked spec `.pi/specs/web-agent-api-v1.md` (useful v1 web CDP on the embedded `<webview>`). Do not widen `agent:allowremotelocalcontrol`. Do not add Playwright locators, downloads, MCP, `--background`, or discrete `web click`. Follow the implementation checklist in that spec. Do not commit/push unless asked.
