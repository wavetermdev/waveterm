# TASK-TERM-004: 将 Wheel / IME 修复收口到 xterm 官方扩展点与焦点归属

## Goal

基于 `TASK-TERM-003` 复现结果，重构当前 `termwrap.ts` 的滚轮与 IME 兜底逻辑：从“外层 DOM patch + 文本正则猜测”收口到“xterm 官方扩展点 + 当前真实焦点 terminal ownership”。

## In Scope

- `frontend/app/view/term/termwrap.ts`
- 必要时：`frontend/app/view/term/termutil.ts`
- 必要时：`frontend/app/view/term/termutil.test.ts`
- 必要时：`scripts/smoke-terminal.ps1`
- 必要时：`scripts/smoke-terminal.runtime.js`
- `.harness/*`

## Out Of Scope

- 不升级整套 xterm 大版本
- 不做后端 terminal cache API 清理
- 不改 fit / resize 无关逻辑
- 不调整非 terminal 模块 UI

## Write Set

- `frontend/app/view/term/termwrap.ts`
- `frontend/app/view/term/termutil.ts`
- `frontend/app/view/term/termutil.test.ts`
- `scripts/smoke-terminal.ps1`
- `scripts/smoke-terminal.runtime.js`
- `.harness/task-packets/TASK-TERM-004.md`
- `.harness/progress.md`
- `.harness/feature-list.json`

## Required Context

- `frontend/app/view/term/termwrap.ts`
- `scripts/smoke-terminal.ps1`
- `.harness/task-packets/TASK-TERM-003.md`
- xterm API `attachCustomWheelEventHandler`
- xterm issue `#5734`
- xterm PR `#5759`

## Steps

1. 用 `attachCustomWheelEventHandler` 替换当前外层 `connectElem.addEventListener("wheel", ...)` 兜底路径。
2. 将 normal buffer / alternate buffer / mouse tracking 的 wheel 分流收口到 xterm hook 中，避免依赖 bubble 阶段 `event.defaultPrevented` 的不稳定时机。
3. 引入真实 terminal focus ownership：
   - 只有当前 active/focused terminal 可重定位 textarea/composition-view
   - 非 active terminal 一律清理 override
4. 将 IME 兜底改为更接近 xterm 官方修复点：
   - 优先 compositionstart / focus 时同步
   - onRender 只保留最小补偿，不再作为主路径
5. 将 Agent/Codex 文本正则识别降级为 fallback，而不是 primary trigger。
6. 用 `TASK-TERM-003` 的多 terminal smoke 验证修复是否真正覆盖 split-pane 场景。

## Acceptance Criteria

- 在多 terminal split-pane 场景下，只有当前 active terminal 的输入框/IME helper 跟随 cursor。
- normal buffer Codex 会话中，真实用户滚轮路径可稳定改变正确 terminal 的 viewportY。
- alternate buffer / mouse tracking 场景不被误拦截。
- 现有“去历史恢复”逻辑保持不回退。

## Verification

```powershell
npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave
npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir
```

- 手动检查：
  - 上方 Codex 终端 + 下方 PowerShell 终端同时存在时，输入框不串位
  - 当前活跃终端滚轮有效，非活跃终端不被误滚动

## Rollback Or Fallback

- 若 `attachCustomWheelEventHandler` 无法满足全部场景，可保留当前 DOM 兜底作为临时 fallback，但必须把触发条件收紧到“xterm 未消费且 terminal 为 active”
- 若 IME 官方生命周期补偿不足，可保留现有 regex 检测作为 secondary fallback，不再作为 primary path

## Remaining Risks

- xterm 6.0.0 本身在 Electron + AI CLI + IME 场景已有已知问题，即使收口到官方扩展点，也可能仍需最小本地补丁
- 多 terminal runtime 对象的生命周期与 DOM 绑定可能没有公开 API，只能通过现有 Wave 封装保持 ownership

## 2026-04-21 执行结果

- 已在 `frontend/app/view/term/termwrap.ts` 完成两类收口：
  - `wheel`：改为优先走 xterm 官方 `attachCustomWheelEventHandler`，只在 `mouseTrackingMode !== "none"` 且 `normal` buffer 时保留一个极窄的 capture fallback，避免再用粗粒度外层 bubble patch 抢事件
  - `IME`：新增 `TermWrap.liveInstances` 与全局 `imeOwnerBlockId`，把 helper textarea / composition-view 的 override 严格限制到当前 owner terminal；在 `focus` / `compositionstart` 时先调用 xterm 私有 `_syncTextArea()`，对齐官方 issue/PR 的修复点
- 为了让回归闭环能准确验证这次修复，还补强了 smoke：
  - `scripts/smoke-terminal.runtime.js` 现在优先从 `TermWrap.liveInstances` 枚举现存终端
  - 当前工作区没有 terminal 时，会自动创建首个 shell terminal 再继续 split-pane smoke
  - IME ownership 断言从“任意 inline style”收紧为“可见 IME override（忽略 xterm 默认 z-index:-5）”
- 验证结果：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts` 通过
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1` 通过
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir` 通过，最新 `make\win-unpacked\Wave.exe` 时间为 `2026-04-21T17:16:35.2754971+08:00`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave` 通过
    - JSON：`D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-172449.json`
    - PNG：`D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-172449.png`
- 最终 smoke 结论：
  - `dom terminal=2`
  - `known runtime=2`
  - `wheel diagnoses=ok`
  - `ime diagnoses=ok`

## 2026-04-21 真实滚轮补充验证

- 用户继续反馈“依然没有滚轮”后，新增 `scripts/smoke-terminal-real-wheel.ps1`，避免只用 JS `WheelEvent` 误判：
  - 通过 CDP `Input.dispatchMouseEvent(type=mouseWheel)` 注入真实鼠标滚轮事件；
  - 对 split-pane 中两个 terminal 分别测试 `screen-center` 与 `screen-right`；
  - 通过运行态 `viewportY` / scroll state 断言目标 terminal 是否实际滚动，且不串到其他 terminal。
- 最新成品验证结果：
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal-real-wheel.ps1 -KillExistingRepoWave` 通过；
  - JSON：`D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260421-184158.json`
  - PNG：`D:\files\AI_output\waveterm-terminal-smoke\terminal-real-wheel-20260421-184158.png`
  - 2 个 terminal 的 `screen-center` / `screen-right` 均为 `diagnosis=ok`。
- 为避免继续混用旧包，本轮将版本号提升到 `2026.4.21-2`，并重新生成：
  - `make\Wave-win32-x64-2026.4.21-2.exe`
  - `make\Wave-win32-x64-2026.4.21-2.zip`
  - `make\win-unpacked\Wave.exe`
- 补充验证：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts` 通过；
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1` 通过；
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir nsis zip` 通过；
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave` 通过，JSON 为 `D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-184339.json`。
