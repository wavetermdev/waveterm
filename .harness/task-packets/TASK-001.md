# TASK-001

## 任务标题

飞书入口增强与 Harness 初始化

## 目标

在当前 Waveterm 架构下，把飞书接入打磨为可交付的最小完整版本：支持本地 App 优先、应用内网页兜底、同分区新窗口、清晰的双入口交互，并为仓库建立最小可续跑的 Harness。

## 背景

当前项目已经能新增飞书入口，但还缺少 3 个关键补强：

1. 飞书登录/弹窗新窗口没有继承专用分区
2. 用户需要明确区分“本地 App”与“应用内网页”两类入口
3. 仓库缺少面向长任务续跑的最小 Harness 工件

## In Scope

- 飞书入口、视图与主进程启动链路
- 飞书偏好配置项与 schema
- `.harness` 工件
- 仓库级 `AGENTS.md` / `CLAUDE.md`
- `scripts/verify.ps1`

## Out of Scope

- 与飞书无关的重构
- 全仓格式化
- 深改现有通用 WebView 架构
- 完整的跨平台本地安装探测体系

## 相关文件

- `frontend/app/view/webview/webview.tsx`
- `frontend/app/view/feishuview/feishuview.tsx`
- `frontend/app/view/feishuweb/feishuweb.tsx`
- `emain/emain-feishu.ts`
- `emain/emain-ipc.ts`
- `emain/preload.ts`
- `pkg/wconfig/defaultconfig/widgets.json`
- `pkg/wconfig/defaultconfig/settings.json`
- `pkg/wconfig/settingsconfig.go`
- `schema/settings.json`

## 已知事实

- 默认快捷入口由 `pkg/wconfig/defaultconfig/widgets.json` 提供
- 通用网页视图基于 `WebViewModel + <webview>`
- 本机已存在 `feishu://` 与 `lark://` 协议注册

## 关键未知项

- 真实飞书账号登录后的完整聊天流程
- 非 Windows 平台的本地安装路径探测效果

## 验收标准

- 点击飞书入口后，本地 App 优先，失败回退到应用内网页
- 用户可见地提供 `Feishu App` / `Feishu Web` 双入口，并可直接隐藏当前 `Feishu Web` 卡片
- 飞书弹出的新窗口继承 `persist:feishu`
- `scripts/verify.ps1` 通过
- `.harness` 工件足以支持后续续跑

## 验证命令

```powershell
scripts/verify.ps1
```

## 执行建议

1. `Research`：确认入口、WebView、IPC 与配置链路
2. `Plan`：确定最小补强方案
3. `Implement`：只改飞书相关文件与 Harness 工件
4. `Verify`：跑 verify，并尽量补一轮最小 smoke

## 风险

- 飞书站点后续策略变化可能影响应用内网页模式
- 登录/授权弹窗链路仍需要真实账号验证

## 回滚思路

- 回滚飞书相关新增文件与配置项
- 移除 `.harness` 文件与 `scripts/verify.ps1`
- 恢复到只保留基础飞书入口的状态
