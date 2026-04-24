# TASK-TERM-005: Codex / alternate buffer 全视图滚轮收口

## Goal

彻底解决“IME 已恢复但 Codex pane / 交互态终端滚轮仍失效”的问题，将当前只覆盖 `normal buffer` 的滚轮补丁升级为“按 active terminal 收口的全视图 wheel router”，并让回归 smoke 明确覆盖 Codex / alternate buffer / mouse tracking 场景。

## In Scope
- `frontend/app/view/term/termwrap.ts`
- 必要时：`frontend/app/view/term/termutil.ts`
- 必要时：`frontend/app/view/term/termutil.test.ts`
- 必要时：`scripts/smoke-terminal.runtime.js`
- 必要时：`scripts/smoke-terminal.ps1`
- 必要时：`scripts/smoke-terminal-real-wheel.ps1`
- `.harness/*`

## Out Of Scope
- 不升级整个 `@xterm/xterm` 大版本
- 不恢复 terminal 历史缓存 / 恢复逻辑
- 不改无关 block / workspace UI
- 不顺手重构 term 以外模块

## Write Set
- `frontend/app/view/term/termwrap.ts`
- `frontend/app/view/term/termutil.ts`
- `frontend/app/view/term/termutil.test.ts`
- `scripts/smoke-terminal.runtime.js`
- `scripts/smoke-terminal.ps1`
- `scripts/smoke-terminal-real-wheel.ps1`
- `.harness/task-packets/TASK-TERM-005.md`
- `.harness/progress.md`
- `.harness/feature-list.json`

## Required Context
- `frontend/app/view/term/termwrap.ts`
- `frontend/app/view/term/termutil.ts`
- `scripts/smoke-terminal.runtime.js`
- `scripts/smoke-terminal-real-wheel.ps1`
- `node_modules/@xterm/xterm/src/browser/CoreBrowserTerminal.ts`
- `node_modules/@xterm/xterm/src/browser/Viewport.ts`
- `https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts`
- `https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/Viewport.ts`
- `https://github.com/wavetermdev/waveterm/blob/main/frontend/app/view/term/termwrap.ts`

## Steps
1. 扩充 smoke，记录并断言目标 terminal 的 `buffer.active.type`、`mouseTrackingMode`、命中元素与右侧滚动区域路径，新增 Codex / alternate buffer 失败诊断。
2. 将 wheel 路由从“只处理 `normal buffer`”改为“按 active terminal 收口”：
   - `normal buffer` 继续走 scrollback
   - `alternate buffer` / Codex 交互态走显式 fallback，而不是直接放过
3. 收紧命中区域逻辑，确保鼠标位于可见输出区域与右侧可滚动区域时，事件都会落到当前 active terminal，而不会串到非 active terminal。
4. 保持 IME ownership 修复不回退，避免“滚轮修好，输入法又坏”。
5. 用 split-pane 上方 Codex / 下方 PowerShell 的真实场景做 smoke 与人工复核。

## Acceptance Criteria
- 右侧 Codex pane 在鼠标位于可见输出区域时可稳定滚动。
- split-pane 场景中只滚动当前 active terminal，不串滚到另一个 terminal。
- `alternate buffer` / `mouseTrackingMode !== none` 时不再出现“IME 正常但滚轮完全失效”。
- IME 输入框位置修复保持有效，不回退。
- smoke 明确覆盖 `normal` 与 `non-normal` 路径，而不是把 `non-normal-buffer` 当成未覆盖区域。

## Verification
- `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
- `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
- `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave`
- `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal-real-wheel.ps1 -KillExistingRepoWave`
- `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
- 手动检查：
  - 上方 Codex pane 与下方 PowerShell pane 同时存在时，右侧 Codex 输出区滚轮可用
  - PowerShell pane 在未激活时不被误滚动
  - 输入法候选与输入框位置不回退

## Rollback Or Fallback
- 若全视图 wheel router 风险过高，可先在 active terminal 范围内做最小 fallback，但必须覆盖 Codex / alternate buffer。
- 若 Codex pane 的滚动其实来自非 xterm 区域，应在 smoke 中明确标出真实命中元素，并将方案收缩为“xterm terminal + Codex pane 可见滚动区域双路径路由”。

## Remaining Risks
- xterm 6.0.0 的 wheel / mouse protocol 与 Electron 命中区域组合较脆弱，可能仍需保留极小本地补丁。
- Codex pane 可能不是纯粹的 `normal buffer` 场景，需以真实 smoke 结果为准，而不是继续依赖当前假设。

## Result

- 状态：`passing`
- 根因：
  - 原先滚轮逻辑只把 `normal buffer` 作为成功路径，Codex / alternate buffer / mouse tracking 场景进入后会直接失去滚轮。
  - 旧 smoke 把 `non-normal-buffer` 当成失败而不是覆盖目标，导致回归闭环没有覆盖真实交互态。
- 修复：
  - `frontend/app/view/term/termwrap.ts` 改为按 active terminal 收口的 wheel router
  - `normal buffer` 继续走 `terminal.scrollLines(...)`
  - `alternate buffer` / Codex 交互态改走 `PageUp/PageDown` fallback
  - `scripts/smoke-terminal.runtime.js` 与 `scripts/smoke-terminal-real-wheel.ps1` 补齐 alternate / mouse tracking / 真实 `mouseWheel` 验证
- 最新验证：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal-real-wheel.ps1 -KillExistingRepoWave`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
- 最新真实结果：
  - JSON：`D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260422-110300.json`
  - 截图：`D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260422-110300.png`
  - `make\win-unpacked\Wave.exe` 时间：`2026-04-22T10:59:49.3611836+08:00`
  - `make\win-unpacked\Wave.exe` SHA256：`665EEF5E7CC24CCA7B3E27543AACC59B42076542DE1337156364DFB51C90838C`
  - `runtime.wheel.allPassed = true`
  - `runtime.ime.allPassed = true`
  - `realWheel.allPassed = true`
  - 2 个 terminal 的 `screen-center` / `screen-right` 全部 `ok`
- 额外核查：
  - 本机常见安装路径仅发现仓库内两份 `Wave.exe`
  - 未发现额外安装版 `Wave.exe` 干扰当前验证
- 2026-04-22 输出历史补充修复：
  - 用户在最新手测中确认：滚轮和 IME 已恢复，但 Codex / Agent 输出只能回看一页，前面的内容会被“吞掉”
  - 根因收敛为：Agent TUI 的 `alternate screen` 与 `CSI 3 J` 清空 scrollback 路径仍会把历史收窄到当前页
  - 本轮在 `frontend/app/view/term/termwrap.ts` 增加 agent-TUI 特判：
    - 对 `codex|claude|opencode|aider|gemini|qwen` 这类命令，抑制 `47/1047/1049` alternate screen 进入
    - 对 agent repaint 场景抑制 `CSI 3 J` 清空 scrollback
  - 新增 smoke 覆盖：
    - `scripts/smoke-terminal.runtime.js` 新增 `agent-repaint-scrollback` 场景
    - 断言种子历史仍在、最新 repaint 内容可见、active buffer 仍为 `normal`
  - 最新验证结果：
    - `D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260422-112409.json`
    - `D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260422-112519.json`
    - `make\win-unpacked\Wave.exe` 时间：`2026-04-22T11:22:55.2418461+08:00`
    - `make\win-unpacked\Wave.exe` SHA256：`BA03754F45CB5DF8BF0E7FF3FF9625E414AAB5A45C2DB1DC37A65B95800194E4`
    - `runtime.agentScrollback.allPassed = true`
    - `runtime.wheel.allPassed = true`
    - `runtime.ime.allPassed = true`
    - `realWheel.allPassed = true`
- 2026-04-22 实时滚动回退修正：
  - 后续真实手测证明：上面这套“强行保历史”的方向不适合 Codex / TUI 实际交互，会把**输出进行中的实时滚动**搞坏
  - 因此本轮已明确回退那部分 agent-TUI 特判，改回更贴近 xterm 官方的 wheel 语义：
    - `normal buffer`：Wave 接管 wheel 做 scrollback
    - `alternate buffer` 且无 app-side wheel：走 xterm 官方箭头 fallback
    - `mouse-tracking`：交回应用自己处理 wheel
  - 新增/更新 smoke：
    - `alternateScenarios` 现在断言箭头 fallback
    - `mouseTrackingScenarios` 断言会发出真实鼠标协议，而不是被 Wave 吞掉
  - 最新验证结果：
    - `D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260422-114610.json`
    - `D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260422-114631.json`
    - `make\win-unpacked\Wave.exe` 时间：`2026-04-22T11:45:35.2099308+08:00`
    - `make\win-unpacked\Wave.exe` SHA256：`3A535573D27CC7F34D1C12931283AA5B0127229F7901C7A52238796D6A837AF6`
    - `runtime.wheel.allPassed = true`
    - `runtime.ime.allPassed = true`
    - `runtime.wheel.mouseTrackingScenarios[*].mouseSequenceSent = true`
    - `realWheel.allPassed = true`
