# TASK-TERM-001

## 任务标题

终端滚轮与输入法位置专项修复

## 目标

以原作者/官方终端逻辑为基线，修复 Wave 终端在 Codex/Agent 会话中的滚轮不可用、输入法候选框/组合文本位置错误问题，并建立可复测的验证闭环。

## In Scope

- `frontend/app/view/term/termwrap.ts`
- `frontend/app/view/term/termutil.ts`
- `frontend/app/view/term/termutil.test.ts`
- `frontend/app/view/term/fitaddon.ts`
- 仅在必要时触及 `frontend/app/view/term/osc-handlers.ts`
- Electron 本地 smoke / `agent-browser` 可达性验证

## Out of Scope

- 非终端区域 UI 重构
- 全仓格式化或命名调整
- Feishu/WebView/AI Panel 等无关模块
- 新增大规模可配置系统

## 子任务

1. **官方基线对照**：对比 `HEAD`、关键历史提交和上游原作者逻辑，确认滚轮、IME、fit、scroll-to-bottom 的原始设计。
2. **滚轮根因定位**：区分 normal buffer scrollback、alternate buffer 应用内滚动、mouse tracking 三类场景，避免互相覆盖。
3. **IME 根因定位**：确认 xterm textarea/composition-view 的真实坐标来源，优先遵循 xterm 原生逻辑，只对明确失效场景做最小兜底。
4. **历史恢复验证**：检查 `cache:term:full`、`term`、`heldData`、`viewportY/baseY/cursorY` 是否导致恢复后状态滞后。
5. **可执行验证**：跑单测、`scripts/verify.ps1`、`electron-builder --win dir`，并尽量用 `agent-browser` 连 Electron 做截图/滚轮 smoke。

## 验收标准

- 普通终端历史可以用鼠标滚轮上下滚动。
- Codex/Agent 会话中的滚轮行为与 Windows Terminal 尽量一致：normal buffer 走 scrollback，alternate buffer 尊重应用 mouse tracking。
- 中文输入法候选框/组合文本不再出现在左上角或历史 viewport 位置。
- 调整窗口大小或从历史恢复后，当前输入位置和可视 viewport 不错位。
- 验证命令通过，并记录无法自动化验证的原因。

## 验证命令

```powershell
npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir
```

## Electron Smoke 计划

1. 关闭旧 Wave 进程。
2. 用 `make\win-unpacked\Wave.exe --remote-debugging-port=9222` 启动。
3. 用 `agent-browser` 连接 CDP。
4. 截图确认主窗口目标可达。
5. 如果 CDP 能稳定拿到主 UI，执行滚轮/输入焦点 smoke；如果只能拿到 `about:blank` 或黑屏，记录为工具限制，不把它当作通过依据。

## 2026-04-20 最终运行态结果

- 官方基线：已重新 fetch `upstream/main`，`termwrap.ts` 以官方主线为基线，只保留本任务必要差异。
- PTY 尺寸：最新包中 PowerShell `[Console]::WindowHeight; [Console]::WindowWidth` 返回 `113 / 208`。
- Codex IME：启动 `codex` 后自动锚定到对话中部，textarea 为 `top=1116px / left=864px / zIndex=5`；退出 Codex 后锚点清理。
- 滚轮：normal buffer wheel smoke 中 `viewportY` 从 `3596` 变为 `3556`，滚轮事件被终端消费。
- 验证：`vitest`、`scripts/verify.ps1`、`electron-builder --win dir` 均通过，最新产物为 `make\win-unpacked\Wave.exe`，时间 `2026-04-20 18:30:59`。

## 2026-04-21 分发产物补充验证

- 已重新生成并验证完整分发产物，而不再只验证 `win-unpacked`：
  - `make\Wave-win32-x64-2026.4.17-1.zip`：`2026-04-21 10:57:29`
  - `make\Wave-win32-x64-2026.4.17-1.exe`：`2026-04-21 10:58:22`
  - `make\Wave-win32-x64-2026.4.17-1.exe.blockmap`：`2026-04-21 10:58:25`
- `zip` 解压到 `make\zip-smoke` 后运行，`location.href` 指向 `make/zip-smoke/resources/app.asar/...`，PowerShell 返回 `113 / 208`，Codex IME 锚到 `top=1116px / left=864px / zIndex=5`。
- `installer exe` 静默安装到 `make\installer-smoke` 后运行，`location.href` 指向 `make/installer-smoke/resources/app.asar/...`，PowerShell 返回 `113 / 208`，wheel smoke 中 `viewportY` 从 `3597` 变为 `3557`。
- 产物名仍显示 `2026.4.17-1` 仅因为当前 `package.json` 版本号未变，不代表内容仍是 `2026-04-17` 的旧代码。

## 2026-04-21 版本号纠偏

- 已将分发版本从 `2026.4.17-1` 更新为 `2026.4.21-1`，避免用户继续误测旧文件名。
- 新产物：
  - `make\Wave-win32-x64-2026.4.21-1.zip`
  - `make\Wave-win32-x64-2026.4.21-1.exe`
  - `make\Wave-win32-x64-2026.4.21-1.exe.blockmap`
- 新 zip 已解压并验证到 `make\zip-smoke-2026.4.21-1`，运行态路径明确指向新目录，PowerShell 返回 `113 / 208`。
- 另外已生成目录版 `make\Wave-win32-x64-2026.4.21-1\Wave.exe`，用户可直接双击该目录下的 `Wave.exe`。

## 2026-04-21 滚轮与输入框对齐补充

- 滚轮根因确认：normal buffer wheel 兜底如果挂在 `connectElem` capture 阶段，会先于 xterm 内部 `xterm-scrollable-element` 吃掉事件。
- 修复后：wheel 兜底改为 bubble 阶段，只在真正折算出整行滚动时才阻止默认行为。
- 输入框根因确认：固定中线锚点不符合 Windows Terminal 参考，正确行为应当跟随当前 cursor。
- 修复后：IME textarea/composition view 使用 `buffer.active.cursorX / cursorY` 计算 `top / left`。
- 运行态结果：最新 `win-unpacked` 中 Codex 启动后 textarea 与 cursor 对齐；对 xterm 内部 scrollableElement 派发 wheel 后 `viewportY` 从 `3597` 变为 `3557`。

## 2026-04-21 移除终端历史缓存/恢复逻辑

- 根据用户最新要求，“历史记录/历史恢复”本身被视为错误逻辑，不再继续修补；本轮目标改为彻底停用这条链路，而不是继续优化 `cache:term:full`。
- 前端最小范围移除：
  - `frontend/app/view/term/termwrap.ts` 不再读取 `cache:term:full`
  - 不再调用 `loadInitialTerminalData()`
  - 不再调用 `runProcessIdleTimeout()`
  - 不再通过 `SerializeAddon` + `BlockService.SaveTerminalState()` 持久化终端快照
- 为避免初始化阶段丢实时输出，新增 `flushHeldTerminalData()`：`mainFileSubject` 订阅仍然保留，`loaded=false` 期间收到的 append 数据会先进入 `heldData`，待初始化完成后顺序回放到当前会话终端。
- 保留范围：
  - 当前会话实时输出链路 `getFileSubject(...) -> handleNewFileSubjectData(...) -> doTerminalWrite(...)`
  - 已有的滚轮兜底、IME 对齐、resize/termsize 同步逻辑
- 验证结果：
  - `npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts frontend/app/view/term/osc-handlers.test.ts` 通过
  - `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1` 通过
  - `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win dir` 通过
  - 代码检索确认 `termwrap.ts` 中已不存在 `cache:term:full`、`SaveTerminalState`、`loadInitialTerminalData`、`runProcessIdleTimeout`、`processAndCacheData`、`SerializeAddon`、`fetchWaveFile` 引用
- 当前限制：
  - `agent-browser` 可通过 `agent-browser.cmd` 调用，但 PowerShell 直接执行 `agent-browser.ps1` 会被本机执行策略拦截；这属于本机策略限制，不是仓库代码问题。
