# Decisions

## 2026-04-16

### 决策 1：飞书入口采用“专用 view + 复用 WebViewModel”

- 原因：与现有 `web/help/tsunami` 模式一致
- 收益：可以独立承载飞书默认 URL、分区、按钮和启动逻辑
- 代价：比纯复用 `web` 多一个轻量 view 文件，但维护性更好

### 决策 2：本地飞书 App 启动放在主进程

- 原因：协议调用、注册表探测、路径探测都属于平台能力
- 收益：前端只保留一个简单 API，不需要承载 Windows 细节
- 回退链路：协议 -> `feishu:apppath` -> 注册表 -> 常见路径 -> 应用内网页

### 决策 3：飞书新窗口不再走普通 openLink，而是继承 `persist:feishu`

- 原因：登录/授权/聊天子页面需要共享 cookie 与 storage
- 实现：在 `FeishuViewModel.handleNewWindow()` 中创建带 `web:partition` 的新 web block

### 决策 4：入口改为 `Feishu App` + `Feishu Web` 双入口

- 原因：本地 App 与应用内网页的能力边界不同，强行合并会让用户误以为本地窗口是内嵌网页
- 收益：入口语义更清晰，既能一键启动本地飞书，也能明确打开应用内网页聊天页
- 代价：侧边栏多一个轻量入口，但整体可维护性更好

### 决策 5：`Feishu Web` 最终只保留图标隐藏入口

- 原因：用户确认“小眼睛”图标已经满足关闭需求，不再需要额外的文字隐藏按钮
- 收益：界面更干净，同时保留现有 block header 的统一交互
- 范围：移除额外文字按钮，不影响 `Feishu Web` 的网页容器能力

## 2026-04-21

# ADR-20260421-001: 终端问题改为“两阶段闭环”推进

## Context
- 当前终端已停用历史恢复链路，并已有单 terminal smoke
- 用户最新截图显示：真实多 terminal split-pane 场景下，输入框错位和滚轮回归仍会发生
- 现有 smoke 通过 `window.term` 与内部 `.xterm-scrollable-element` 直派发事件，不能代表真实用户路径

## Options
- option A：继续在现有 `termwrap.ts` 上直接 patch
- option B：先补多 terminal / 真实焦点 / 真实 wheel 路径 smoke，再改业务逻辑
- option C：先清理后端历史缓存死代码

## Decision
- chosen option：B
- why it was chosen：当前最大不确定性不是“补丁怎么写”，而是“真实失败路径是否已被自动化覆盖”；先补复现场景，再把业务逻辑收口到 xterm 官方扩展点，风险最低

## Consequences
- positive effects
  - 避免再次出现“单测和单 terminal smoke 通过，但用户真实场景仍失败”
  - 后续 wheel/IME 重构有更稳定的回归闭环
- negative effects
  - 比直接 patch 多一个前置任务包，短期交付稍慢
- follow-up work
  - `TASK-TERM-003`
  - `TASK-TERM-004`

## Review Date
- 2026-04-22
