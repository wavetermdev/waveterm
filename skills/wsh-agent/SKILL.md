---
name: wsh-agent
description: Control RemoteTerm/Wave Terminal from an in-terminal coding agent via the wsh CLI. Use when WAVETERM=1 is set, or when you need to run commands, capture panes, spawn subagents, prompt the user, or manage tabs/blocks without stealing focus.
---

# wsh Agent Control Fabric

You are inside RemoteTerm (Wave Terminal). Control the app with `wsh`. Do not assume tmux is present — the tmux-named commands are aliases onto `wsh block …`.

## Detect and orient

1. Check `WAVETERM=1` (also `WAVETERM_BLOCKID`, `WAVETERM_TABID`, `WAVETERM_CONN`, `WAVETERM_VERSION`).
2. First commands:
   ```sh
   wsh agent context --json
   wsh agent help --json
   ```
   Context is one shot: this block, focused block, tabs, connections, and blocks (geometry, cwd, best-effort process state).

## Mode A vs Mode B

**Mode A (90%)** — run a command, wait, get the result. Default: **no focus steal**, close the block on exit, 5 minute timeout.

```sh
wsh run --wait --json -- npm test
wsh run --wait --json --connection prod --timeout 2m -- ./deploy.sh
```

JSON fields: `stdout`, `stderr` (always `""`), `exitcode`, `durationms`, `blockid`, `outputmerged` (`true`). A PTY merges streams. Use `--focus` only if the user must see the block; `--keep-block` to leave it open.

**Mode B (10%)** — long-running or interactive (REPL, server, editor). Create/attach a block, type into it, capture, wait, kill.

```sh
wsh agent spawn --cmd "claude" --name claude-prod --connection prod
wsh block send-keys claude-prod "fix the build" --enter
wsh block capture claude-prod --json          # default last 200 lines
wsh block capture claude-prod --all
wsh block wait claude-prod --until-exit --timeout 60s
wsh agent stop claude-prod
```

Default capture is a **tail of 200 lines**. Pass `--all` for the full buffer. Do not dump unbounded scrollback into context.

## Do not steal focus

`wsh agent spawn` and `wsh run --wait` default to **no-focus**. Do not pass `--focus` unless the user asked to watch that block. `wsh block new` focuses by default — pass `--no-focus` when creating blocks for yourself.

## Secrets and prompts

- Pass secrets **by name**: `wsh block send-keys <block_ref> --secret <secret_label> --enter`.
- **Never** inline secret values in `--cmd`, prompts, flags, or JSON.
- Ask the user with `wsh prompt`. Use `--default` so a missed prompt is safe:
  ```sh
  wsh prompt "Deploy to production?" --options "yes,no" --default no --timeout 60s
  ```

## Addressing

Blocks: `this`, uuid / uuid8, `3`, `term:2`, title substring (`--name` on spawn sets `frame:title`).
Tabs: uuid, `tab:N`, title substring.

## Spawn / list / stop

```sh
wsh agent spawn --cmd "claude" --idempotency-key claude-1   # reuse if still running
wsh agent list --json
wsh agent stop                 # all owned blocks in this workspace
wsh agent stop <block_ref>     # one owned block; --force for non-owned
```

Spawned blocks are tagged `agent:owned`. Prefer `agent stop` over `block kill` for work you created.

## tmux aliases

| tmux-style            | canonical            |
|-----------------------|----------------------|
| `wsh capture-pane`    | `wsh block capture`  |
| `wsh send-keys`       | `wsh block send-keys`|
| `wsh split-pane`      | `wsh block split`    |
| `wsh select-pane`     | `wsh block select`   |
| `wsh kill-pane`       | `wsh block kill`     |
| `wsh rename-pane`     | `wsh block rename`   |
| `wsh list-panes`      | `wsh block list`     |

Also useful: `wsh file` (ls/cat/write/cp over `wsh://conn/path`), `wsh view`, `wsh edit`, `wsh notify`, `wsh connection list --json`, `wsh tab list --json`.

## Web widget

Drive the **already-open** embedded web widget (same cookies, partition, screen). Not a second Chrome. Close with `wsh block kill`.

Enable: `wsh config set agent:allowbrowsercontrol true`. Remote-origin `wsh` also needs `agent:allowremotelocalcontrol`. Close DevTools on that page before driving it.

```sh
wsh web open https://example.com
wsh web snapshot -b <web-block>
wsh web screenshot -b <web-block> --path /tmp/page.png
wsh web get -b <web-block> "h1" --json
wsh web run -b <web-block> -- 'await navigate("https://example.com"); await print(await snapshot())'
```

`open` is **not** gated. `get` / `snapshot` / `screenshot` / `run` are. Target with `-b` (same resolver as other wsh commands). `this` from a term block needs `-b` pointing at the web block.

**Observe** with discrete `snapshot` / `screenshot` / `get`. `@N` in that output is for reading only — it is **not** valid in a later process.

**Act** inside one `wsh web run` (script as remaining args, or stdin when there are no args):

```sh
wsh web run -b <web-block> --timeout 2m <<'EOF'
await navigate("https://example.com");
const snap = await snapshot();   // refreshes @N for THIS run
await print(snap);
await click("@1");
await fill("@2", secret("site_password"));
await type("\n");
await sleep(500);
await print(await pageInfo());
EOF
```

Helpers (injected; no `require` / `process` / `page` object): `navigate(url)`, `snapshot()`, `click(ref | [x,y])`, `fill(ref, text)`, `type(text)`, `js(expr)`, `cdp(method, params?)`, `screenshot()`, `secret(name)`, `sleep(ms)` (max 30s per call), `print(...)`, `pageInfo()`. Use `print`, not `console.log`. Loop `sleep` + `snapshot` / `pageInfo` instead of `waitFor`.

`@N` is **not** a CSS selector. `js("document.querySelector('@1')")` will not work. Call `snapshot()` in the **same** run before `click`/`fill`. After `navigate` or another `snapshot()`, previous `@N` in this run are replaced. Discrete `wsh web snapshot` then a new `web run` `click("@1")` without `snapshot()` in the script errors: unknown or stale ref.

`secret(name)` is sync, any store name, throws immediately if missing. Never print secret values. `cdp` is audited by method name only.

Script max 256 KiB. Default timeout 60s, max 5m. If DevTools is open on that webview, the command fails — close DevTools and retry. A tab that was never activated is not attached (`tab is not loaded…`); switch to it once. Do not pass `--focus` to steal the user's tab.
