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

## 2026-04-17 Packaging

- 版本规则新增为 `YYYY.M.D-N`，当前本地包版本已切为 `2026.4.17-1`
- 新增 Windows `buildVersion` 映射，安装包文件版本可映射为 `2026.4.17.1`
- 已产出 `make/Wave-win32-x64-2026.4.17-1.exe` 与 `make/Wave-win32-x64-2026.4.17-1.zip`
- 当前环境缺少 `task` / `go` / `zig`，本轮无法按仓库标准完整重编后端版本链，只能复用现有 `dist/bin`
- 通过设置 `ELECTRON_BUILDER_NSIS_DIR` / `ELECTRON_BUILDER_NSIS_RESOURCES_DIR` 复用了本机 `manual-tools`，绕过了 NSIS 在线下载证书失败
- `msi` 仍受 WiX 在线下载证书失败阻塞，未产出 `.msi`
- `make/win-unpacked/Wave.exe` 的文件版本仍显示 Electron `41.1.0`；若要同步成时间版号，需要恢复 `signAndEditExecutable` 依赖链或补齐本机 `winCodeSign/rcedit`
## 2026-04-17 Startup Fix

- 已定位正式包“慢启动 / UI 像旧版本 / 飞书入口未出现”的共同根因：`frontend/wave.ts` 中 `preloadMonaco()` 调用了未导入的 `fireAndForget`
- 已在 `frontend/wave.ts` 补回 `@/util/util` 的 `fireAndForget` 导入，避免 `initWave` 在首屏初始化后抛出 `ReferenceError`
- 已执行 `scripts/verify.ps1`、`npm.cmd run build:prod`，并重新生成 `make/win-unpacked`、`make/Wave-win32-x64-2026.4.17-1.exe`、`make/Wave-win32-x64-2026.4.17-1.zip`
- 已启动 `make/win-unpacked/Wave.exe` 复核正式版日志；`2026-04-17 14:14` 这轮启动不再出现 `fireAndForget is not defined` / `Error in initWave`
- 当前默认 `widgets.json` 与正式版用户配置均不拦截飞书入口：默认配置仍包含 `feishu` 与 `fei-web`，`C:\Users\yucohu\.config\waveterm\widgets.json` 当前不存在
- 继续排查“打开慢”时，已确认首屏主阻塞点之一是 `initBare()` 把 `setWindowInitStatus("ready")` 绑定在 `document.fonts.ready` 上，导致主窗口在字体全部加载完成前无法继续 `wave-init`
- 已将 `frontend/wave.ts` 调整为：字体仍在后台加载，但 `ready` 状态通过事件循环立即上报，不再让字体加载卡住主窗口初始化；期间曾验证到 `requestAnimationFrame()` 在隐藏页会被节流，已回退为 `setTimeout(..., 0)` 避免隐藏窗口死锁
- 正式包日志对比：`2026-04-17 14:59` 基线从 `waveterm-app starting` 到 `show window` 约 `4.010s`，`tabview init` 为 `1425ms`；`2026-04-17 15:11` 新版从启动到 `show window` 约 `3.087s`，主 `tabview init` 降到 `781ms`
- 已补做“启动中重复双击”验证：`2026-04-17 15:12` 日志出现 `second-instance event`，但未再出现 `createNewWaveWindow` / `creating new window`，最终只显示恢复窗口，说明启动中二次启动放大慢感的问题仍被正确拦截
## 2026-04-17 Widget Compatibility Fix

- 已确认右侧飞书入口缺失的直接根因不是前端未打包，而是正式包仍复用旧 `wavesrv`（日志显示 `wave version: 0.14.4 (202604151554)`），其内嵌默认 `widgets.json` 早于飞书入口改动
- 已在 `frontend/app/workspace/widgets.tsx` 增加兼容逻辑：当前端包版本与后端 `fullConfig.version` 不一致时，回退合并前端打包内置的 `pkg/wconfig/defaultconfig/widgets.json`
- 已额外在正式版运行时配置 `C:\Users\yucohu\.config\waveterm\widgets.json` 写入 `defwidget@feishu` / `defwidget@feishuweb`，确保当前机器上的正式版也能拿到飞书入口
- 已重新执行 `scripts/verify.ps1`、`npm.cmd run build:prod`、`electron-builder --win dir nsis zip`，并重启 `make/win-unpacked/Wave.exe`
