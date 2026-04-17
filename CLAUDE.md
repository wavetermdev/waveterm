always response in '简体中文'.

# Waveterm 续跑说明

接手本仓库任务时，按下面顺序恢复上下文：

1. `AGENTS.md`
2. `.harness/progress.md`
3. `.harness/decisions.md`
4. `.harness/unknowns.md`
5. `.harness/task-packets/TASK-001.md`

## 续跑原则

- 不依赖会话记忆，优先依赖 `.harness` 工件
- 一次只推进一个最小闭环
- 改完先跑 `scripts/verify.ps1`
- 如果验证受阻，明确写入 `.harness/unknowns.md`

## 当前仓库特点

- 前端入口和 widget 快捷入口主要在 `frontend/app/workspace/widgets.tsx` 与默认配置 `pkg/wconfig/defaultconfig/widgets.json`
- Web 内容统一复用 `frontend/app/view/webview/webview.tsx`
- 主进程能力通过 `emain/*` + `emain/preload.ts` 暴露给前端
