# macOS browser controls: investigation and fix

**Status: user-confirmed fixed in an isolated Wave (Dev) build.** On November 8, 2026, at 11:43 EST, the reporting user confirmed:

> testing is complete. It's fixed.

This report records the browser-control failure, two corrective commits, verification, and reproduction steps. The confirmation applies to the tested development build on the reporting Mac. It does not establish that an upstream release or a packaged installer contains these changes.

For the newly packaged builds, use the [hands-on Mac checklist](./browser-controls-macos-checklist.md). The checklist now records a passing result reported by the user on November 9, 2026; this is separate from the earlier development-build confirmation above.

## Environment and changes

| Item             | Investigated configuration                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Platform         | macOS 27.0.1, build 26A434, Apple Silicon / ARM64                                                                                     |
| Release base     | Wave `v0.14.5`, upstream commit [`97e56002`](https://github.com/wavetermdev/waveterm/commit/97e560027f494d20fed347b2d6b72b6bcb3e50e0) |
| Fork and branch  | [`cjosewski/waveterm`](https://github.com/cjosewski/waveterm), `fix/browser-focus`                                                    |
| Electron         | 41.1.0                                                                                                                                |
| Build tools used | Node.js 22.23.4, Go 1.25.6, Task 3.54.0                                                                                               |
| Test tools       | Vitest 3.2.4; jsdom 26.1.0 for DOM interaction tests                                                                                  |

| Commit                                                                                                                                                       | Change and observed result                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`738896d0` — Fix pane focus loops and stale magnification backdrops](https://github.com/cjosewski/waveterm/commit/738896d0a07ccb159c09ccccb44997aa256d51f2) | Fixed reproducible pane-focus and backdrop regressions. The native browser-control problem remained.                                      |
| [`d7a66119` — Fix macOS toolbar clicks after embedded browser focus](https://github.com/cjosewski/waveterm/commit/d7a66119d907bcafe55c19e7a4b9271326d03cc4)  | Distinguished renderer focus from native window activation. After rebuilding and restarting, the user confirmed the reported issue fixed. |

## Symptoms and reproduction

The browser header controls behaved inconsistently: sometimes they highlighted or responded, sometimes actions were delayed, and eventually mouse clicks stopped working. Keyboard controls often continued working. `Cmd+L` worked in one browser pane, but switching to another could leave both unresponsive. Closing the second pane temporarily restored the first pane's controls. Clicking the magnify icon could make the browser or apparently the whole Wave window unresponsive.

The practical reproduction sequence was:

1. Open a browser pane and interact with its page, address bar, navigation buttons, and pane header.
2. Open a second browser pane, then alternate page interaction and toolbar clicks between the two.
3. Try `Cmd+L` and typing in each address bar after mouse controls become unreliable.
4. Magnify and un-magnify a pane using its header icon, including quick toggles; compare with `Cmd+M`.
5. Close the second browser pane and check whether the first recovers. Check terminal interaction as well.

These were reports of lost interaction and apparent lockups; the investigation did not establish an operating-system deadlock. Process and log checks also mattered: an early test was still using the installed application. Once the first patched native development build was confirmed running, the user still reported dead controls, requiring further investigation.

## Findings and implementation

### Pane focus and magnification

The first patch addressed two independently reproducible defects:

- `BlockFull` retained click state and reacted to later focus changes through an effect. Two panes could repeatedly reclaim focus from each other. Pane selection now follows actual pointer events, preserves toolbar input focus, and cancels obsolete animation-frame focus retries. See [blockfocus.ts](../frontend/app/block/blockfocus.ts) and its [interaction tests](../frontend/app/block/blockfocus.test.tsx).
- Delayed magnification backdrops could survive a rapid exit from magnification. Initial magnified and ephemeral backdrop states were also swapped. Backdrop timers now cancel when no longer needed, and rendering requires the corresponding pane to exist. See [nodebackdrops.tsx](../frontend/layout/lib/nodebackdrops.tsx) and its [tests](../frontend/layout/lib/nodebackdrops.test.tsx).

The original focus implementation failed the pane-transfer regression with repeated focus transfers and React's `Maximum update depth exceeded` error. The original backdrop implementation failed three checks involving rapid un-magnification, timer cancellation, and restored layout state. The corrected implementations passed these checks. They did not, by themselves, resolve the native toolbar failure.

### macOS activation-click filtering

The remaining cause was the application's macOS first-click handler. Its original sequence was:

1. Record every renderer DOM `window.focus` event as if the native application window had just become active.
2. If a mouse-down arrived within 50 ms, cancel that mouse-down and its following click.
3. Refocus the clicked pane after 10 ms.

Moving from an embedded web page to Wave's toolbar can return focus to the host renderer while the native window is already active. That transition wrongly qualified as an activation click, so the intended toolbar action was discarded and focus returned to the page.

Electron's version-pinned documentation explains that macOS [`WebContents` focus](https://github.com/electron/electron/blob/v41.1.0/docs/api/web-contents.md#event-focus) concerns first-responder changes within a window. Native window focus is a separate [`BaseWindow` event](https://github.com/electron/electron/blob/v41.1.0/docs/api/base-window.md#event-focus).

The native development log recorded an activation at 09:39:26.837, followed by repeated guest blur/refocus pairs roughly 11–15 ms apart through 09:39:54.523, without another native activation. That timing was consistent with the 10 ms first-click refocus path. The disk log did **not** directly record the renderer's click-cancellation messages; the event-handler reproduction supplied the direct cancellation evidence.

The follow-up patch records native activation time in [WaveBrowserWindow](../emain/emain-window.ts) and exposes it through the [IPC handler](../emain/emain-ipc.ts), [preload bridge](../emain/preload.ts), API type, and preview mock. The getter returns `null` for an absent, destroyed, or unfocused native window.

The renderer's [first-click handler](../frontend/app/macos-firstclick.ts) uses DOM focus only as a cheap 50 ms candidate check. Before suppressing a candidate click, it confirms a recent native activation and consumes that activation once. Ordinary clicks outside that transition perform no IPC lookup. The lookup is synchronous so the mouse event can be accepted or canceled before dispatch continues; it only reads existing window state. Electron documents that [`sendSync` blocks the renderer until its reply](https://github.com/electron/electron/blob/v41.1.0/docs/api/ipc-renderer.md#ipcrenderersendsyncchannel-args), which is why it is excluded from ordinary clicks.

Pending refocus timers cancel on subsequent mouse-down, keyboard input, renderer blur, or disposal. Renderer blur deliberately retains suppression of the paired physical activation click: the handler's own delayed refocus can focus a webview and blur the renderer before mouse-up. Keyboard and programmatic clicks remain usable. The magnify icon's existing, separate 50 ms refocus callback was left unchanged.

## Verification and limits

| Check                         | Result                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original first-click handler  | Both renderer-only focus regressions failed. In 20 repeated focus/click cycles, all 20 mouse-downs were swallowed: **0/20 delivered**.                                                                                                                                           |
| Corrected first-click handler | The same sequence delivered **20/20**, without unwanted refocus. All 14 first-click tests passed.                                                                                                                                                                                |
| Combined regression coverage  | **46 tests passed across six files**: the 14 activation-click checks plus 32 pane-focus, backdrop, and existing layout checks.                                                                                                                                                   |
| TypeScript                    | **17 pre-existing preview diagnostics remained**, also reproduced from a pristine release-base archive. No new diagnostics were introduced. This is not a clean full-project typecheck.                                                                                          |
| Development build             | `npm run build:dev` successfully built the Electron main process, preload, and renderer. Native ARM64 backend and CLI compilation also succeeded.                                                                                                                                |
| Artifact/source checks        | Seven renderer/preload source-map entries exactly matched the changed sources: `app.tsx`, `macos-firstclick.ts`, `block.tsx`, `blockfocus.ts`, `TileLayout.tsx`, `nodebackdrops.tsx`, and `preload.ts`. The main bundle contained the native timestamp and guarded IPC response. |
| Independent review            | No blocking code-review findings; formatting and `git diff --check` passed.                                                                                                                                                                                                      |
| Native confirmation           | The user completed testing of the isolated Wave (Dev) build and supplied the confirmation quoted above.                                                                                                                                                                          |

The first-click tests cover genuine activation, repeated renderer-only focus, rapid second clicks, webview blur ordering, keyboard/programmatic activation, timer cleanup, and zero IPC calls for ordinary clicks. They exercise the same handler installed by the application. DOM tests cannot establish Electron's complete native event ordering. The user's subsequent native test confirmed that the reported interaction problem was resolved in that build; it did not independently verify every underlying event sequence. Other platforms and packaged distribution were outside this verification.

The existing TypeScript diagnostics concern missing preview configuration fields, the preview API's missing `getPathForFile`, and process-viewer fixtures missing `numthreads`. The preview API file also changed in this patch, so the accurate result is unchanged baseline diagnostics, not an absence of errors in every edited file.

## Build, test, and relaunch

Follow [CONTRIBUTING.md](../CONTRIBUTING.md), its linked [BUILD.md](../BUILD.md), and the repository's [Taskfile.yml](../Taskfile.yml). The following uses versioned commands rather than the local investigation launcher. Install Node.js 22, Go, Task, and a compatible macOS compiler/SDK first.

```sh
git clone --branch fix/browser-focus https://github.com/cjosewski/waveterm.git
cd waveterm
git show --no-patch --oneline 738896d0 d7a66119
npm ci

npx vitest run \
  frontend/app/macos-firstclick.test.ts \
  frontend/app/block/blockfocus.test.tsx \
  frontend/layout/lib/nodebackdrops.test.tsx \
  frontend/layout/tests

npx tsc --noEmit
npm run build:dev
```

At the documented revision, the test command passes 46 tests and `tsc` reports the 17 baseline diagnostics above. `npm ci` uses the committed dependency lockfile. The upstream guide also provides `task init` for full development setup.

Quit the existing development app completely before starting the rebuilt application. A page reload or renderer hot reload is insufficient because this patch changes the main process and preload API. To use separate Wave data/configuration for testing, create a temporary profile in the same shell:

```sh
wave_focus_profile="$(mktemp -d "${TMPDIR:-/tmp}/wave-browser-focus.XXXXXX")"
mkdir -p "$wave_focus_profile/data/config"
env -u ELECTRON_RENDERER_URL -u ELECTRON_RUN_AS_NODE \
  WAVETERM_HOME="$wave_focus_profile/data" \
  WAVETERM_DATA_HOME="$wave_focus_profile/data" \
  WAVETERM_CONFIG_HOME="$wave_focus_profile/data/config" \
  task start
```

`task start` runs `electron:start`, builds its backend dependencies, and launches the standalone development application. Setting the legacy `WAVETERM_HOME` to the same data directory prevents fallback to an existing legacy profile; keeping configuration under that directory also preserves isolation on repeat launches. The command clears inherited Electron development-server and Node-only launch settings. Confirm the running application is **Wave (Dev)** from this checkout, then repeat the two-pane, address-bar, magnification, and terminal checks above. Retain the same profile path when repeating a test that depends on saved layout state.

An initial custom launch failed because `WCLOUD_ENDPOINT` was unset. Development backend startup requires a valid endpoint. The launcher was corrected to supply the same three public development defaults as `electron:start`: `WCLOUD_ENDPOINT=https://api-dev.waveterm.dev/central`, `WCLOUD_PING_ENDPOINT=https://ping-dev.waveterm.dev/central`, and `WCLOUD_WS_ENDPOINT=wss://wsapi-dev.waveterm.dev`. A headless backend smoke test with those values reached `WAVESRV-ESTART` and shut down with exit code 0. Using `task start` supplies them automatically; the startup failure was separate from the mouse-control bug.

On the reporting machine, an inherited `SDKROOT` selected a newer Command Line Tools SDK incompatible with the selected Xcode linker. Native compilation succeeded when that build invocation used the SDK shipped with the selected Xcode installation. Match the compiler and SDK on your machine rather than copying an absolute SDK path. No global SDK or system Node settings were changed. Linker deployment-version warnings remained; the resulting native binaries were used for development testing on that Mac, not validated as a redistributable release.
