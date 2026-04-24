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

# ADR-20260422-002: Codex pane 顽固终端问题先做专项诊断闭环，再继续修复

## Context
- `TASK-TERM-005` 的多轮修复在 smoke 中多次显示 `passing`，但用户真实手测仍持续出现“中间 Codex pane 滚轮消失、IME 位置错误、只能看到最新几行”
- 现有 smoke 主要验证静态点位和 seed scrollback，仍缺少“持续输出期间”的真实命中区域、active terminal、IME ownership 证据
- 继续直接修改 `termwrap.ts` / `termutil.ts`，高概率再次出现“修一处坏一处”

## Options
- option A：先创建专项诊断包，只补脚本和 durable 工件，拿到真实交互证据后再修业务代码
- option B：继续按 xterm / upstream 方向直接改 `termwrap.ts`
- option C：先扩大 scrollback 或 UI 尺寸，尝试缓解“只能看到最新几行”

## Decision
- chosen option：A
- why it was chosen：当前最大不确定性已不是“代码怎么改”，而是“真实失败路径到底落在哪一层”；先补证据链能把下一包修复收敛到最小写集，避免继续盲修

## Consequences
- positive effects
  - 先把“中间 Codex pane + 持续输出”的真实失败路径观测清楚
  - 减少 wheel、IME、scrollback 三条链路再次互相打架
  - 后续业务修复可以更精准地限制在最小文件集合
- negative effects
  - 短期内不会立即给出新的业务补丁
  - 需要先投入一轮脚本/实机诊断工作
- follow-up work
  - `TASK-TERM-006`
  - 基于 `TASK-TERM-006` 结论再拆新的最小业务修复包

## Review Date
- 2026-04-23

# ADR-20260422-006: 不再使用 fake scrollback overlay 伪造终端历史视图

## Context
- `TASK-TERM-007` 为了在 `Codex + no native scrollback` 场景下恢复“看更早内容”的能力，引入了 `agentTuiHistoryLines` 与 `.wave-agent-scrollback-overlay`；
- 技术 smoke 证明这套路径确实能把更早输出展示出来，但用户最新手测截图明确显示：滚轮一旦触发，终端字体、排版、底部状态条都会看起来像切换到另一套 UI；
- 代码复核也已确认：当前显示变化并不是 xterm 自身重排，而是 `renderAgentScrollbackOverlay()` 用 `overlay.textContent` 把一份纯文本历史重新盖在 live terminal 上；
- upstream `wavetermdev/waveterm` 并不存在这套 overlay 逻辑，这属于本地修复过程中新增的偏离路径。

## Options
- option A：删除 fake scrollback overlay，恢复官方 terminal live render 路径，只保留最小 wheel -> `PageUp/PageDown` fallback
- option B：继续打磨 overlay，让 fake history 在样式上尽量接近真实 terminal
- option C：继续尝试在本地模拟 native terminal scrollback / shadow buffer

## Decision
- chosen option：A
- why it was chosen：用户当前最痛的不是“能不能看见更早文本”本身，而是“滚一下就切成一套假的终端渲染”。删除 overlay 能直接止住这个最明显、最破坏信任的回归，同时最大程度回到 upstream/官方渲染路径。

## Consequences
- positive effects
  - 滚轮前后 terminal 继续由 xterm live DOM 驱动，不再切成纯文本重绘层
  - 修复方向重新对齐 upstream/官方实现边界
  - 后续只需维护最小的 wheel fallback，而不是长期维护一套伪终端渲染器
- negative effects
  - 删掉 overlay 后，可视“历史深度”将受限于 Codex 自身 TUI 的翻页能力
  - 无法在本仓库内单独补齐 Windows Terminal 那种 native scrollback 体验

## Follow-up Work
- `TASK-TERM-008`

## Review Date
- 2026-04-23

# ADR-20260422-005: 终端修复交付必须同时更新默认 `make` 包，不能只验证 `make-smoke`

## Context
- `TASK-TERM-007` 的 Codex wheel / IME 修复在 `make-smoke\win-unpacked\Wave.exe` 中已经通过真实 smoke；
- 但用户持续反馈“还是滚不了”，最终比对发现默认 `make\win-unpacked\Wave.exe` 仍然是旧 hash；
- 旧默认包缺少 `agentTuiHistoryLines` / `wave-agent-scrollback-overlay` 等新代码，导致用户即使打开仓库内 exe，也可能仍在使用旧前端。

## Options
- option A：继续只验证 `make-smoke`，手工提醒用户自己找对 exe
- option B：每次终端相关修复完成后，强制重跑 `build:prod` + `electron-builder --win dir`，并校验默认 `make` 与 smoke 包 hash 一致
- option C：只复制 `make-smoke` 到 `make`，不保留正式重打包步骤

## Decision
- chosen option：B
- why it was chosen：这能直接消除“代码已修好但用户打开的仍是旧包”的交付歧义；同时比单纯目录复制更可追溯，能保证 `dist` 与 `make` 一致。

## Consequences
- positive effects
  - 后续用户手测默认指向 `make\win-unpacked\Wave.exe` 时，不再混淆新旧包
  - `make` 与 `make-smoke` 的 hash 可直接比对，便于确认是不是最新构建
  - 终端问题的 smoke 证据和最终交付包保持同一份前端代码
- negative effects
  - 每轮终端修复收尾都需要额外跑一次正式 `build:prod` 和 `electron-builder`
  - 如果用户正占用默认 `make` 目录包，会增加一次“先停旧进程再重打包”的流程

## Follow-up Work
- `TASK-TERM-007`

## Review Date
- 2026-04-23

# ADR-20260422-004: 当前轮改为“整块 terminal 容器 bubble wheel 兜底 + 复用 xterm 原生 textarea 坐标”

## Context
- 用户当前真实窗口已被直接定位到三栏 terminal，其中中间栏 `46ef...` 为当前焦点；
- 用当前 pane 的 `WAVETERM_JWT` + `wsh termscrollback` 读取后，已确认真实用户实例仍是 `baseY=0`、无 native scrollback；
- 现有 `termwrap.ts` 的 wheel 兜底仍过窄：
  - 只在 `mouseTrackingMode !== none` 时才走外层 fallback；
  - 对 Codex 这种 `normal buffer + mouseTrackingMode=none + full-screen repaint` 的真实场景，整块 terminal 内容区域可能出现“只有小块区域可滚”；
- 现有 IME override 会在 `_syncTextArea()` 之后再次按 `cursorRow/cursorCol` 手算 `top/left`，容易把 xterm 官方已经算好的位置再次算偏。

## Options
- option A：继续只依赖 `attachCustomWheelEventHandler()`，不加整块容器 fallback
- option B：在 terminal 容器上增加 bubble 阶段 wheel 兜底，并让 IME override 复用 `_syncTextArea()` 结果
- option C：彻底去掉 IME override，只保留 xterm 默认行为

## Decision
- chosen option：B
- why it was chosen：它同时解决了两个真实痛点：
  - 当 wheel 没命中 xterm 内层节点时，外层 bubble fallback 仍能兜住整个 terminal 区域；
  - IME 位置不再依赖我们自己二次推导的网格坐标，而是直接沿用 xterm 官方同步后的坐标，能最大程度降低再次算偏的概率。

## Consequences
- positive effects
  - 修复范围仍限制在 `frontend/app/view/term/termwrap.ts`
  - wheel 与 IME 两条链路重新共享同一份更稳定的 agent TUI 判定
  - 更贴近 xterm 官方行为，减少“自己把 textarea 又算坏”的风险
- negative effects
  - 仍需继续观察 bubble fallback 是否会在极端情况下与某些内层事件路径重叠
  - clean-room CDP 的 Codex 启动时序仍有波动，导致自动化 wheel 断言偶发不稳定
- follow-up work
  - 继续让用户在真实中间 pane 中复测
  - 如仍有边角问题，再补一条更窄的 runtime diagnostic，而不是重新大改 term 架构

## Review Date
- 2026-04-23

# ADR-20260422-003: Codex 无 native scrollback 时，滚轮优先转为内部翻页

## Context
- `TASK-TERM-006` 已证实：真实 `codex --no-alt-screen` 在 Wave/xterm 中是 `normal buffer + 全屏重绘`，但 `baseY=0 / length=73` 不增长，因此没有 native terminal scrollback 可滚。
- 已额外验证 `CSI 6n` 在 Wave 中能正常收到 `ESC[row;colR]` 响应，说明问题不在 CPR / 初始光标定位。
- 已额外验证 Codex 自己能响应 `ESC[5~ / ESC[6~]`，即使没有 native scrollback，也可以在自身 UI 内部前后翻页。

## Options
- option A：继续尝试在 Wave 侧伪造 Codex native scrollback
- option B：在 Codex 无 native scrollback 时，把 wheel 翻译为 `PageUp/PageDown`
- option C：维持现状，只等待 Codex 上游彻底修复 xterm.js / inline 模式兼容

## Decision
- chosen option：B
- why it was chosen：这是当前最小、最可验证、且不会重新引入历史缓存链路的修复；它直接恢复用户最关心的“滚轮能翻看当前 Codex 对话更早内容”，同时不需要侵入 xterm 内核或伪造 scrollback。

## Consequences
- positive effects
  - 在 `baseY=0` 的真实 Codex 场景下，滚轮终于有可见效果
  - 修复范围收敛在 `termwrap.ts` / `termutil.ts`
  - 与现有 IME owner 逻辑基本解耦，回归风险相对可控
- negative effects
  - 恢复的是 Codex **内部翻页**，不是 Windows Terminal 那种 native terminal scrollback
  - 如果 Codex 上游未来补齐 xterm.js inline scrollback 兼容，这条 fallback 可能需要重新收窄
- follow-up work
  - `TASK-TERM-007`

## Review Date
- 2026-04-23
# ADR-20260422-007: Codex transcript 只允许注入同一 live xterm，不再回到 fake overlay

## Context
- `TASK-TERM-008` 的用户核心投诉已从“能否翻到更早内容”收口为“滚一下就切成另一套假终端渲染”。
- 既有深度 probe `D:\files\AI_output\waveterm-terminal-smoke\task-term-008-native4-probe.json` 已证明：在默认交付包上，`fakeOverlayExists=false`、`xtermOverlayExists=false`，同时 `baseY` 已真实增长并可从 `viewportY=63` 滚到 `10`。
- 2026-04-22 再次重打默认包后，`make\win-unpacked\Wave.exe` 的 SHA256 仍为 `BB7D7277A4F437B373F8B6F6E08B52DFB87BA5C2E2717F94A25F111EB12EC34A`，说明本轮交付物与已验证产物一致。

## Options
- option A：恢复或继续修补 fake overlay / xterm overlay 方案。
- option B：维持“隐藏 preview terminal + native scrollback injection”的当前路径，只允许在同一个 live xterm 内补足 transcript。
- option C：完全不做 transcript 补足，只接受 Codex 当前 repaint 窗口内的可见内容。

## Decision
- chosen option：B
- why it was chosen：它是当前唯一同时满足三件事的路径：
  - 不再切换到另一套伪渲染；
  - 仍能把早期输出补进同一个 xterm 的真实 scrollback；
  - 对用户看到的 IME、状态条、字体和 terminal chrome 保持同一渲染面。

## Consequences
- positive effects
  - 默认交付包已与深度验证证据对齐，可继续直接让用户从 `make\win-unpacked\Wave.exe` 手测。
  - 后续若继续优化，也应只围绕“更早启动 transcript 捕获”这类同路径收口，不再回到 overlay 分叉实现。
- negative effects
  - 仍需接受 Codex 上游 full-screen repaint 时序波动带来的自动化不稳定性。
  - 若未来上游真正补齐 native scrollback 语义，还需要再收窄这层 transcript augmentation，避免重复保留历史。

## Follow-up Work
- 如用户仍能稳定复现“最前几行丢失”，下一刀只看 `frontend/app/view/term/termwrap.ts` 的 transcript 捕获起点，不重开 overlay 路径。

## Review Date
- 2026-04-23