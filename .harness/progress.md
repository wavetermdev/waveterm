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

## 2026-04-17 Crash / History Follow-up

- 继续排查“偶发闪退 + 历史记录未保存”时，已在前端终端容器 `frontend/app/view/term/termwrap.ts` 定位到一个高概率根因：`runProcessIdleTimeout()` 采用递归 `setTimeout + requestIdleCallback`，但 `dispose()` 之前没有取消已挂起的 timeout / idle callback；TermWrap 被销毁后，这些回调仍可能继续执行并访问已释放的 terminal / serialize addon，属于典型的“销毁后异步回调继续跑”问题
- 同一链路还存在持久化时机偏晚的问题：终端状态缓存 `cache:term:full` 只会在“累计输出超过阈值”且“5 秒后拿到 idle 时间”时保存；如果窗口被隐藏、应用退出、页面卸载或 renderer 异常终止，最近一段终端状态更容易来不及落盘
- 已在 `frontend/app/view/term/termwrap.ts` 做最小修复：新增 idle/timeout 取消逻辑；`dispose()` 前先做一次强制终端状态持久化；并在 `visibilitychange(hidden)` / `beforeunload` 时追加一次兜底保存，降低退出前与异常前丢状态概率
- 已在 `emain/emain.ts` 增加 `render-process-gone` / `child-process-gone` 日志，后续若仍有闪退，可直接从正式版日志里看到具体崩溃进程类型、退出码和对应 `webContents`
- 当前环境仍缺少 `go` / `task` / `zig`，因此像 `pkg/filestore` 这类后端缓存刷盘周期的源码级优化，本轮无法编译进正式包；从代码上看，后端 blockfile 仍采用异步 cache flush，这仍是“极端崩溃时最近输出可能丢失”的剩余高概率点
- 已执行 `npm.cmd run build:prod`、`scripts/verify.ps1`、`electron-builder --win dir`，并启动 `make/win-unpacked/Wave.exe` 做正式包烟测；`2026-04-17 15:26` 这轮日志显示 `waveterm-app starting`、`wavesrv ready signal received true 564 ms`、`show window ...`，未出现新的首屏异常日志

## 2026-04-17 Packaging Follow-up

- 已将 `electron-builder.config.cjs` 的 Windows NSIS 本地工具接入，从 `file://...7z` 改为自动复用 `LOCALAPPDATA\\electron-builder\\manual-tools\\nsis-*` 已解压目录，并在存在时注入 `ELECTRON_BUILDER_NSIS_DIR` / `ELECTRON_BUILDER_NSIS_RESOURCES_DIR`
- `npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win nsis zip` 已通过，NSIS 不再报 `unsupported protocol scheme "file"`
- 最新产物时间已刷新：`make\\Wave-win32-x64-2026.4.17-1.exe` `15:38:00`、`make\\Wave-win32-x64-2026.4.17-1.exe.blockmap` `15:38:03`、`make\\1.yml` `15:38:03`、`make\\Wave-win32-x64-2026.4.17-1.zip` `15:37:18`、`make\\win-unpacked\\Wave.exe` `15:36:11`

## 2026-04-17 UI Clarity / Drag Smoothness / Visual Polish

- 已定位 4K 清晰度高概率原因：`body` 全局 `transform: translateZ(0)` / `backface-visibility` 会把整页文本放进合成层，Windows 高 DPI 下容易出现文字和边线发虚；同时默认配色大量纯黑/低对比透明层，让界面显得糊和压暗。
- 已定位拖拽掉帧直接原因之一：`TileLayout` 拖拽 hover 被 `throttle(50ms)` 限制到约 20fps；此外拖拽态 `filter: blur(8px)`、resize 态 `backdrop-filter`、高 DPR 拖拽预览 PNG 也会在 4K 屏上增加绘制成本。
- 已修复/优化：移除全局合成层强制提升；拖拽 hover 改为 16ms；拖拽中启用更短过渡；移除拖拽 blur；限制拖拽预览最高 DPR；为 tile 节点增加 paint containment；降低高成本 blur。
- 已做轻量视觉升级：新增深海蓝/翡翠高光默认背景，非 terminal 区域从纯黑改为更清晰的 slate glass 表层；同步 tab、block、tailwind token、窗口背景色。
- 验证：`scripts/verify.ps1` 通过；`npm.cmd run build:prod` 通过；`electron-builder --win dir` 通过；启动 `make/win-unpacked/Wave.exe` 后日志出现 `show window`，未见新的 render/child process gone 日志。
- 未完全验证：真实 4K 主观清晰度与长时间拖拽帧率仍需用户在目标显示器上手感确认；未重新生成 NSIS/zip 正式安装包。

## 2026-04-17 Feishu Image Preview Compatibility

- 用户截图显示飞书消息图片区域提示“暂不支持查看，请稍后再试”。已确认这不是 Wave 本地图片渲染组件问题，而是 Feishu Web 在 Electron `<webview>` 内的站点兼容链路问题。
- 高概率原因 1：Feishu Web 使用默认 Electron UA 时，图片/预览能力可能走降级或不支持分支；已为 `feishuweb` 单独设置去掉 `Electron/...` 标识的桌面 Chrome UA，不影响通用 Web 入口。
- 高概率原因 2：Wave 原本统一 deny `<webview>` 的 `window.open` 并转成 Wave 内新 block；Feishu 的图片查看/预览可能依赖 `about:blank`、`blob:` 或同域弹窗返回值。已在主进程中仅对 Feishu/Lark opener 的 Feishu/资源/blank/blob/data 弹窗放行，降低“暂不支持查看”的概率。
- 已为 `feishuweb` 开启 `nativeWindowOpen=yes` web preference，用于兼容依赖原生 popup 行为的图片查看链路。
- 验证：`npm.cmd run build:dev` 通过；`git diff --check` 通过；`npm.cmd run build:prod` 通过；`electron-builder --win dir` 通过；已启动最新 `make/win-unpacked/Wave.exe`，日志出现 `show window`，并进入 `https://ycnflp4nd2cp.feishu.cn/next/messenger/`。
- 未完全验证：真实飞书图片是否恢复需要用户在已登录账号里实际打开该消息确认；如果仍失败，下一步应抓 Feishu WebView DevTools console/network，重点看图片资源状态码、popup URL 和站点环境检测结果。

## 2026-04-17 Terminal Scrollback / Resize Loss Fix

- 已定位“消息被吞、滚轮滑不到最上面、缩放后记录丢失”的高概率根因：终端默认 `scrollback` 只有 2000 行，Codex/长文本输出在缩放或卡片变窄时会触发 xterm 重排，长行被拆成更多物理行后超过缓冲上限，旧行会被 xterm 裁掉；持久化的 `cache:term:full` 又会记录裁剪后的状态，导致重新打开后也只能看到被截断后的历史。
- 已将前端默认终端滚动缓冲提升到 50000 行，并把可配置上限提升到 200000 行；同时补充 `term:scrollback` 默认配置与 schema 范围。
- 已在终端缩放/变窄前根据当前 buffer 行数与列宽变化预估重排后的行数，必要时先临时扩大 scrollback，再执行 xterm resize，避免缩放动作本身裁掉旧消息。
- 已优化初始恢复策略：当底层 `term` 原始 blockfile 未循环覆盖且不超过 2MB 时，优先从原始终端文件重放恢复，降低因旧 `cache:term:full` 已被裁剪而永久恢复不全的概率；循环覆盖或过大文件仍保留缓存路径，避免启动过慢。
- 验证通过：`npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts`、`git diff --check`、`npm.cmd run build:dev`、`npm.cmd run build:prod`、`npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win nsis zip`。
- 已刷新产物：`make\win-unpacked\Wave.exe`、`make\Wave-win32-x64-2026.4.17-1.exe`、`make\Wave-win32-x64-2026.4.17-1.zip`、`make\Wave-win32-x64-2026.4.17-1.exe.blockmap`、`make\1.yml`。
- 已启动新版 `make\win-unpacked\Wave.exe` 做 smoke，日志出现 `show window`，未在本轮 tail 中看到新的 `render-process-gone` / `child-process-gone`。
- 剩余风险：如果单个终端输出超过 2MB 的底层 circular blockfile 可保留范围，早于 circular 起点的内容仍无法恢复；如果某些 CLI 主动发送清空 scrollback 控制序列，Wave 不能无条件阻止，否则会破坏全屏/交互程序行为。

## 2026-04-17 Terminal Wheel Follow-up

- 用户复测后确认“历史容量/缩放保护”修复后，鼠标滚轮仍无法滚动终端历史。
- 已进一步定位根因：`frontend/app/view/term/termwrap.ts` 的自定义 wheel handler 在 `terminal.modes.mouseTrackingMode !== "none"` 时直接放弃处理；Codex/Claude Code 等交互式 CLI 会启用终端鼠标模式，导致滚轮事件被 CLI/xterm 鼠标协议吃掉，Wave 没有机会执行 `terminal.scrollLines()`。
- 已调整策略：普通 buffer 下，即使终端应用开启 mouse tracking，也由 Wave 优先处理滚轮滚动历史；alternate buffer 仍不抢占滚轮，避免破坏 vim/less/tmux 等全屏程序的交互语义。
- 已补充 `shouldHandleTerminalWheel()` 单测，覆盖 normal buffer、alternate buffer、已取消事件三种场景。
- 验证通过：`npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts`、`git diff --check`、`npm.cmd run build:dev`、`npm.cmd run build:prod`、`npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win nsis zip`。
- 已刷新并启动新版 `make\win-unpacked\Wave.exe`；产物时间：`Wave.exe` 17:13:35，NSIS exe 17:15:32，zip 17:14:50；日志出现 `show window`，未看到新的 renderer/child 崩溃日志。
- 剩余风险：如果某个 CLI 使用 alternate screen 并且自己不响应鼠标滚轮，Wave 仍不会强行抢滚轮；这属于保护全屏程序交互的取舍，后续可考虑做一个显式“强制滚历史”快捷键或开关。

## 2026-04-17 Alternate Buffer Wheel Paging Fix

- 结合用户截图继续定位后，确认当前主要问题不是普通 scrollback，而是 Codex/Agent 类全屏 TUI 运行在 terminal alternate buffer 中；这类界面顶部内容属于应用内部视图，`terminal.scrollLines()` 无法让其回滚。
- 已在 `frontend/app/view/term/termwrap.ts` 调整 wheel 处理：当 active buffer 为 `alternate` 时，不再尝试滚动 xterm viewport，而是把滚轮转换成终端输入序列发送给 PTY。
- 当前实现将 alternate buffer 的滚轮映射为 `PageUp` / `PageDown`（`\x1b[5~` / `\x1b[6~`），并按滚轮幅度放大为多次分页输入，优先保证 Codex/类似 TUI 的消息列表可回滚。
- 保留 normal buffer 的 scrollback 逻辑，因此普通 shell 输出继续走 xterm 历史滚动，全屏 TUI 则走内部翻页。
- 已补充 `getAlternateWheelInputSequence()` 单测，并更新 `shouldHandleTerminalWheel()` 语义，覆盖 normal/alternate/cancelled wheel 场景。
- 验证通过：`npm.cmd exec vitest -- run frontend/app/view/term/termutil.test.ts`（17 个用例通过）、`git diff --check`、`npm.cmd run build:dev`、`npm.cmd run build:prod`、`npm.cmd exec electron-builder -- -c electron-builder.config.cjs -p never --win nsis zip`。
- 已刷新并启动最新产物：`make\win-unpacked\Wave.exe` 时间 `17:57:19`，`make\Wave-win32-x64-2026.4.17-1.exe` 时间 `17:59:06`，`make\Wave-win32-x64-2026.4.17-1.zip` 时间 `17:58:29`；日志已出现 `show window`。
- 剩余风险：如果某些 alternate-screen 程序本身不支持 `PageUp/PageDown` 翻页，而只支持鼠标滚轮事件或自定义快捷键，则仍可能需要为特定 TUI 再补专门兼容；下一步若用户仍反馈无效，应抓取该命令的真实 `lastcmd`、buffer type 和 wheel 后应用响应日志，进一步按具体 TUI 做适配。
