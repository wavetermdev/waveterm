# Progress Log

## 当前任务

- `TASK-001`：飞书入口增强与 Harness 初始化

## 当前阶段

- `Verify`

可选阶段：

- `Research`
- `Plan`
- `Implement`
- `Verify`

## 已确认事实

- 右上角快捷入口来自默认 widgets 配置，不是单独写死在某个固定 header 中
- 现有网页容器统一基于 Electron `webview`，适合继续复用
- 本机已注册 `feishu://` 与 `lark://` 协议，可作为本地飞书 App 优先启动路径
- 飞书视图已接入本地 App 自动发现、路径可配置、网页兜底
- 飞书新窗口已改为继承 `persist:feishu` 分区
- 右上角快捷入口当前采用双入口：`Feishu App` 与 `Feishu Web`

## 当前修改

- `emain/emain-feishu.ts`
- `emain/emain-ipc.ts`
- `emain/preload.ts`
- `frontend/app/view/feishuview/feishuview.tsx`
- `frontend/app/view/feishuweb/feishuweb.tsx`
- `frontend/app/view/webview/webview.tsx`
- `frontend/app/view/webview/webviewenv.ts`
- `frontend/app/block/blockregistry.ts`
- `frontend/app/block/blockutil.tsx`
- `pkg/wconfig/defaultconfig/widgets.json`
- `pkg/wconfig/defaultconfig/settings.json`
- `pkg/wconfig/settingsconfig.go`
- `frontend/types/custom.d.ts`
- `frontend/types/gotypes.d.ts`
- `schema/settings.json`
- `AGENTS.md`
- `CLAUDE.md`
- `.harness/*`
- `scripts/verify.ps1`

## 最新追加

- `2026-04-16 20:42`：将 Feishu App 入口改为本地 App 控制卡片，并新增“隐藏卡片”按钮；该按钮只关闭当前 Wave block，不关闭本地飞书 App
- `2026-04-16 21:06`：为 `Feishu Web` 追加页面内右上角悬浮“隐藏卡片”按钮，避免 header 按钮被布局挤掉后用户无法关闭卡片
- `2026-04-17`：按用户要求回退额外通讯应用入口，只保留飞书相关能力
- `2026-04-17`：右侧 `feishu / fei-web` widget 改为切换行为：若当前 tab 已有对应卡片，再次点击图标会直接关闭该类卡片

## 当前阻塞

- 飞书真实登录与聊天 smoke 需要可用账号态
- 非 Windows 环境下的本地 App 自动发现尚未做真机验证
- 当前仓库运行态 smoke 还受本地启动环境阻塞：直接前台启动 Electron 时，`wavesrv` 会因 `WCLOUD_ENDPOINT` 缺失/无效而退出，导致应用无法稳定停留在可交互界面

## 下一步最小动作

1. 在可用环境中补做真实飞书登录 / 聊天 smoke
2. 确认是否需要为本地开发环境补齐 `WCLOUD_ENDPOINT`

## 验证记录

- `2026-04-16 20:09`：`scripts/verify.ps1`，通过（包含 `git diff --check` 与 `npm.cmd run build:dev`）
- `2026-04-16 20:09`：尝试使用 `agent-browser` + Electron CDP 做最小 smoke，阻塞；项目运行时 `wavesrv` 提前退出，日志显示 `invalid wcloud endpoint, WCLOUD_ENDPOINT not set or invalid`
- `2026-04-16 20:42`：`npm.cmd run build:dev`，通过；应用已重启到 `Wave (Dev)`
- `2026-04-16 22:00`：`scripts/verify.ps1`，通过（包含 `git diff --check` 与 `npm.cmd run build:dev`）
- `2026-04-16 22:05`：`C:\Users\yucohu\.config\waveterm-dev\widgets.json` 与 `.harness/feature-list.json` 均可正常 `ConvertFrom-Json`
- `2026-04-16 22:05`：已重启 `Wave (Dev)`，主 Electron 进程 PID 为 `21464`
- `2026-04-17`：`scripts/verify.ps1` 通过（包含 `git diff --check` 与 `npm.cmd run build:dev`）
- `2026-04-17`：已重启 `Wave (Dev)`，主 Electron 进程 PID 为 `37632`
- `2026-04-17`：`npm.cmd run build:dev`，通过；已移除额外通讯应用入口相关代码
- `2026-04-17`：按用户要求完成额外通讯应用入口回退；`scripts/verify.ps1` 通过
- `2026-04-17`：已重启 `Wave (Dev)`，主 Electron 进程 PID 为 `11996`

## 剩余风险

- 飞书站点登录/聊天弹窗链路是否完全稳定，仍需真实账号验证
- `Feishu Web` 悬浮按钮仅覆盖当前 block 的关闭体验，尚未补充更多页内快捷操作
- 当前 smoke 结论只覆盖构建与主进程日志，不覆盖真实可交互 UI 流程
