# TASK-TERM-003: 多终端焦点与真实事件路径 Smoke 补强

## Goal

把当前单终端 DOM 级 smoke 扩展为更接近用户真实操作路径的多终端验证闭环，优先复现并观测“上方 Codex 终端输入框错位、滚轮失效、下方 PowerShell 终端焦点干扰”这类 split-pane 场景。

## In Scope

- 扩展 `scripts/smoke-terminal.ps1`
- 识别页面上多个 terminal block，而不是只依赖 `window.term`
- 记录当前真实 focus owner、active terminal、textarea/composition-view 所属 terminal
- 将 wheel 断言从内部 `.xterm-scrollable-element` 直派发，升级为对 terminal 外层可交互容器派发
- 增加 split-pane 场景断言：
  - 上下至少两个 terminal block 同时存在时
  - 只有真实 active terminal 允许改 IME helper 位置
  - 滚轮应作用于当前 active terminal，而不是错误 terminal
- 更新 `.harness/*`

## Out Of Scope

- 不修改 `frontend/app/view/term/termwrap.ts` 业务逻辑
- 不切换到 xterm 官方 hook
- 不处理后端历史缓存死代码
- 不要求系统级 IME 候选窗截图完全自动化

## Write Set

- `scripts/smoke-terminal.ps1`
- `.harness/task-packets/TASK-TERM-003.md`
- `.harness/progress.md`
- `.harness/feature-list.json`
- 如需要：`.harness/unknowns.md`

## Required Context

- `frontend/app/view/term/termwrap.ts`
- `scripts/smoke-terminal.ps1`
- `.harness/task-packets/TASK-TERM-002.md`
- 用户 2026-04-21 最新截图反馈

## Steps

1. 扩展 smoke 脚本枚举页面上所有 terminal 容器与对应 runtime 对象。
2. 为每个 terminal 采集：
   - rows/cols
   - buffer type / viewportY
   - textarea style
   - 是否聚焦
   - 所在 block/tab 的可见性与几何位置
3. 增加 split-pane 场景断言：
   - 当前 focus terminal 与被重定位的 IME helper 必须一致
   - 非 active terminal 不得改 textarea/composition-view 坐标
4. 将 wheel smoke 改为更接近真实用户路径：
   - 优先向 terminal 外层交互容器派发事件
   - 只把内部 scrollableElement 作为调试回退信息
5. 输出更详细 JSON，包含每个 terminal 的 id、几何位置、focus owner、wheel target 与命中结果。

## Acceptance Criteria

- 脚本能在同一页面发现至少 2 个 terminal block 时输出多 terminal 明细。
- 脚本能明确指出当前 active/focused terminal。
- 脚本能断言 IME helper 是否被错误 terminal 改写。
- 脚本能区分“内部 xterm 可滚”与“真实外层用户路径不可滚”的差异。
- 失败日志能直接告诉后续修复包是“焦点归属问题”还是“wheel 路由问题”。

## Verification

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-terminal.ps1 -KillExistingRepoWave -KeepApp
```

- 手动检查：
  - 上下两个 terminal 都存在时，确认 smoke JSON 中有两个 terminal 项
  - 确认 active terminal 与 IME helper 所属 terminal 一致

## Rollback Or Fallback

- 若多 terminal runtime 无法稳定枚举，保留现有单 terminal smoke，并把多 terminal 相关结果记录为 `blocked`
- 如真实 wheel 路径无法自动命中，则同时输出“外层路径结果”和“内部 scrollableElement 结果”，避免假阳性

## Remaining Risks

- 当前页面可能未暴露所有 terminal runtime 的全局引用；脚本可能需要通过 DOM 结构和私有属性探测，稳定性低于单实例 `window.term`
- Electron/CDP 的真实鼠标事件路径仍可能与系统级滚轮略有差异，但比直接打到 `.xterm-scrollable-element` 更贴近用户路径
