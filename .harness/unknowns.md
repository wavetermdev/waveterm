# Unknowns

## 未解决 / 待验证项

1. 飞书真实登录流程是否会在所有账号态下稳定走完
   - 当前证据：代码已支持本地 App 优先与同分区新窗口
   - 缺口：缺少真实账号登录 smoke

2. 飞书聊天页在 Electron `webview` 中是否存在站点策略变更风险
   - 当前证据：已能以网页容器方式接入，且有网页兜底
   - 缺口：缺少长时间运行与多页面跳转验证

3. 非 Windows 平台的本地 App 自动发现策略
   - 当前证据：协议方式跨平台更通用
   - 缺口：注册表 / 常见路径探测目前主要覆盖 Windows

4. 当前本地开发环境为何缺少可用的 `WCLOUD_ENDPOINT`
   - 当前证据：直接前台启动 Electron 时，日志显示 `invalid wcloud endpoint, WCLOUD_ENDPOINT not set or invalid`，随后 `wavesrv` 退出
   - 缺口：尚未确认这是开发机环境要求，还是仓库当前 dev 启动约束

5. 中间 Codex pane 在“持续输出期间”的真实滚动命中区域到底是谁
   - 当前证据：用户多轮截图都集中指向中间 Codex pane；现有 smoke 只覆盖 `screen-center` / `screen-right` 的静态点位与 seed scrollback，尚未覆盖“输出进行中”的真实交互路径
   - 缺口：还没有拿到持续输出期间 `elementFromPoint`、active terminal、buffer type、mouseTrackingMode、scroll container 命中链路的实测证据

6. IME owner 在多 pane + 持续输出场景下是否仍会漂移
   - 当前证据：现有实现通过 `TermWrap.liveInstances` + `imeOwnerBlockId` 管理 helper textarea；已有 smoke 能发现静态 ownership 问题，但依赖 monkey patch `shouldAnchorImeForAgentTui`
   - 缺口：还没有证明真实 Codex 输出期间，IME helper / composition-view ownership 会稳定跟随当前活动 pane，而不是在中间 pane 与其他 pane 间串位

7. 真实 Codex / agent pane 是否和“纯 xterm middle pane”走的是同一条滚动链路
   - 当前证据：`terminal-smoke-20260422-143509.json` 与 `terminal-real-wheel-20260422-143832.json` 已证明纯 xterm 的 3-pane 中间 terminal 在持续输出期间滚轮正常，命中区域也正常
   - 缺口：这仍不能代表真实 Codex / agent TUI；当前还没有拿到“真实 agent pane”下的 `elementFromPoint`、可视滚动区域、实时 `baseY/viewportY` 与 IME ownership 采样

8. 真实 Codex pane 如何稳定进入“长输出进行中”状态
   - 当前证据：`terminal-codex-pane-20260422-145534.json` 已证明真实 `codex` 可以在中间 pane 被拉起，且 `shouldAnchorIme=true`、`imeOwnerBlockId` 对齐正确；`terminal-codex-pane-20260422-150151.json` 已进一步证明可通过 `codex --no-alt-screen "<prompt>"` 稳定拿到长输出
   - 缺口：虽然长输出已可复现，但还没有把“raw repaint 序列 -> scrollback 不增长 -> 用户滚轮无效”这条链路转换成最小业务修复

9. Wave 与 Windows Terminal 对 Codex `normal-buffer + full-screen repaint` 的差异点是什么
   - 当前证据：`terminal-codex-pane-20260422-150151.json` 的 `debugTermTail` 已显示大量 `ESC[K`、`ESC[H`、`?2026h/l`，同时运行态 `baseY=0`、`length=73`
   - 缺口：还缺一份与 Windows Terminal 的对照证据，来确认是 Codex 自身设计如此，还是 Wave/xterm 在这类 repaint 序列上确实少了 scrollback 保留

## 建议补充信息

- 一组可用的飞书测试账号或用户自行登录后的验证反馈
- 目标发布平台范围：仅 Windows，还是包含 macOS / Linux
