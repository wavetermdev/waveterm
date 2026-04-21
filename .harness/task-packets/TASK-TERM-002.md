# TASK-TERM-002: 终端回归 Smoke 自动化闭环

## Goal

建立一个可重复执行的本地 smoke 脚本，降低后续滚轮、IME、历史恢复、旧包误测问题的排查成本。

## In Scope

- 新增 `scripts/smoke-terminal.ps1`
- 覆盖最新 `make\win-unpacked\Wave.exe` 启动路径、时间戳、SHA256
- 校验 `termwrap.ts` 中历史缓存/恢复链路仍处于停用状态
- 通过 Electron CDP 运行终端 DOM 级 smoke：
  - 终端对象可达
  - 当前 rows/cols 可读
  - runtime 中不存在历史缓存方法
  - normal buffer wheel 能改变 `viewportY`
  - 强制 Agent IME 场景时 helper textarea 能对齐当前 cursor
- 输出 smoke JSON 与截图到 `D:\files\AI_output\waveterm-terminal-smoke`

## Out Of Scope

- 不修改终端业务逻辑
- 不改滚轮/IME 策略
- 不清理 Go 后端历史缓存死代码
- 不生成 nsis/zip 正式分发包
- 不依赖真实系统中文输入法候选窗截图作为唯一通过条件

## Write Set

- `.harness/task-packets/TASK-TERM-002.md`
- `scripts/smoke-terminal.ps1`
- `.harness/progress.md`
- `.harness/feature-list.json`

## Required Context

- `AGENTS.md`
- `CLAUDE.md`
- `.harness/progress.md`
- `.harness/task-packets/TASK-TERM-001.md`
- `frontend/app/view/term/termwrap.ts`

## Steps

1. 新增 smoke 脚本，支持安全关闭仓库 `make` 目录下的旧 Wave 进程。
2. 启动最新 `make\win-unpacked\Wave.exe --remote-debugging-port=<port>`。
3. 通过 CDP `/json/list` 定位主 page target，并用 `Runtime.evaluate` 执行终端 smoke。
4. 记录静态检查、运行态检查、截图、进程路径、产物时间戳和 SHA256。
5. 运行脚本与现有验证命令，更新 `.harness` 结果。

## Acceptance Criteria

- `scripts/smoke-terminal.ps1` 可从仓库根目录重复执行。
- 脚本默认不关闭仓库外的 Wave 进程；需要时可显式传 `-KillAllWave`。
- 脚本能确认 `termwrap.ts` 不再包含历史恢复/缓存关键入口。
- 当当前 workspace 有终端 block 时，脚本能验证 wheel 和 IME DOM 对齐。
- 脚本输出 JSON 结果和截图路径，失败时给出明确原因。

## Verification

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave
npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

## Rollback Or Fallback

- 删除 `scripts/smoke-terminal.ps1` 即可回滚验证脚本。
- 若 CDP 在当前机器不稳定，可保留静态检查与路径/SHA256 校验，手动执行终端滚轮/IME 复测。

## Remaining Risks

- 系统级中文输入法候选窗无法仅靠 CDP 完整验证；本脚本以 xterm helper textarea/composition view DOM 坐标作为自动化代理指标。
- 如果当前 Wave workspace 没有终端 block，运行态终端 smoke 会失败，需要用户先打开一个终端 block 或以 `-RequireTerminal:$false` 跑路径/静态检查。
- Electron 单实例行为可能导致新启动请求转发到既有 Wave 实例；脚本会优先关闭仓库 `make` 目录下的旧 Wave 进程，并在路径不匹配时提示。

## 2026-04-21 执行结果

- 已新增 `scripts/smoke-terminal.ps1`，使用 PowerShell 直连 Electron CDP，不依赖 `agent-browser.ps1`，绕过本机 PowerShell execution policy 对全局 npm shim 的限制。
- 首次执行 smoke 抓到真实问题：源码已移除历史链路，但当时的 `make\win-unpacked` 运行态仍暴露 `loadInitialTerminalData` / `processAndCacheData` / `runProcessIdleTimeout`，说明产物 bundle 仍是旧的；脚本输出失败结果到 `D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-161932.json`。
- 串行重跑构建并刷新目录包后，第二次 smoke 通过：
  - 结果 JSON：`D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-162451.json`
  - 截图：`D:\files\AI_output\waveterm-terminal-smoke\terminal-smoke-20260421-162451.png`
  - `make\win-unpacked\Wave.exe` 时间：`2026-04-21T16:23:14.5073581+08:00`
  - SHA256 前缀：`0A9EC1A4814CB56A`
  - runtime `window.term` 可达：`true`
  - runtime 历史方法：空
  - runtime `serializeAddon`：`false`
  - wheel smoke：`viewportY 127 -> 87`
  - IME smoke：`topDelta=0`、`leftDelta=0`
- 验证通过：
  - `powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir`
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts`
