# waveattach 设计文档

**日期：** 2026-04-27  
**状态：** 待实现

---

## 概述

`waveattach` 是一个独立的命令行工具，允许用户从任意外部终端（如 iTerm、系统终端）attach 到 Wave Terminal 中正在运行的 term block，实现双向终端输入输出。

---

## 使用方式

```bash
waveattach                    # 不传参数，交互式选择 block
waveattach <blockid>          # 直接指定 block UUID，跳过选择
```

退出方式：`Ctrl+A D`（detach，不影响 block 内的进程）

---

## 文件结构

```
cmd/waveattach/
└── main-waveattach.go     入口（无 cobra，简单 main）

pkg/waveattach/
├── attach.go              attach 主循环（输入输出 goroutine、detach 处理）
├── auth.go                socket 发现 + JWT 生成
└── selector.go            交互式 block 选择 UI
```

---

## 第一节：整体架构

### 执行流程

```
1. 发现 Socket     自动搜索 ~/.waveterm[-dev]/wave.sock
2. 认证            读取 authkey 文件 → 生成 JWT → Authenticate RPC
3. 选择 Block      没传 blockid 时调用 BlocksListCommand → 交互式选择
4. 进入 Attach 模式  终端切换 raw mode，启动两个 goroutine：
   ├── 输出 goroutine：WaveFileReadStreamCommand("term") → stdout
   └── 输入 goroutine：stdin(raw) → ControllerInputCommand
5. 事件处理        SIGWINCH → 发送 TermSize / Ctrl+A D → detach
6. 清理            恢复终端状态，关闭连接
```

### 依赖的现有 Wave 包

| 包 | 用途 |
|----|------|
| `pkg/wshrpc` | RPC 类型定义 |
| `pkg/wshrpc/wshclient` | RPC 客户端调用 |
| `pkg/wshutil` | Socket 连接、JWT 生成 |
| `pkg/wavebase` | 数据目录路径常量 |
| `pkg/waveobj` | Block/ORef 类型 |

---

## 第二节：Socket 发现与认证

### Socket 路径发现（按优先级）

1. 读环境变量 `WAVETERM_SOCKETPATH`（用户手动指定）
2. 尝试 `~/.waveterm/wave.sock`（生产模式）
3. 尝试 `~/.waveterm-dev/wave.sock`（开发模式）
4. 都不存在 → 打印错误退出，提示 Wave 是否在运行

### 认证流程

`wsh` 依赖 Wave 注入的 `WAVETERM_JWT` 环境变量，外部工具没有这个。Wave 在数据目录下存有 authkey 文件用于签发 JWT：

```
~/.waveterm/waveterm.authkey      (生产模式)
~/.waveterm-dev/waveterm.authkey  (开发模式)
```

认证步骤：
1. 读取 `waveterm.authkey` 文件内容（JWT 签名密钥）
2. 调用 `wshutil.MakeClientJWTToken()` 生成 JWT
   - `RouteId = "waveattach-{随机UUID}"`
   - `Sock = socket 路径`
   - `ProcRoute = false`
3. 连接 Unix domain socket
4. 发送 `AuthenticateCommand(jwt)` 完成握手

---

## 第三节：Block 选择 UI

### 行为规则

- 传入 `blockid` 参数 → 验证 block 存在后直接 attach，跳过 UI
- 没有 term block → `exit(1)` 并打印 `error: no running term blocks found`
- 只有 1 个 term block → 自动选中，跳过 UI，直接 attach
- 多个 term block → 显示交互式选择界面

### 交互式选择 UI

```
选择要 attach 的 Block：

  [1] term  │ workspace: home │ tab: main   │ cwd: ~/projects/myapp
▶ [2] term  │ workspace: home │ tab: main   │ cwd: ~/go/src
  [3] term  │ workspace: work │ tab: server │ cwd: /var/log

↑/↓ 选择  Enter 确认  q 退出  │ block: a3f2c1d0-4e5f-6789-abcd-ef0123456789
```

实现细节：
- 只显示 `view=term` 的 block，其他视图类型不支持 attach
- 用 ANSI 转义码实现光标移动和高亮，不引入第三方 TUI 库
- 底部状态栏右侧实时显示当前高亮 block 的完整 UUID
- 选中后清除选择 UI，直接进入 attach 模式

---

## 第四节：输入输出流

### 输出 goroutine（Block → 本地终端）

```
WaveFileReadStreamCommand(blockId, "term")
    ↓
从流中读取字节（完整历史 + 实时新增，同一个流）
    ↓
直接写入 os.Stdout（原样透传，含 ANSI 转义序列）
```

- Block 的 term 文件上限 5MB，全量重播后自动进入实时跟踪
- 流结束（block 被关闭）→ 通知主循环退出

> **实现风险：** 需要在实现阶段验证 `WaveFileReadStreamCommand` 是否支持"历史+实时追加"的流式传输。如果它只返回调用时的快照，则需要改用 WPS 事件订阅（监听 block 文件变更事件）来接收实时新增数据，历史部分仍通过该命令读取。

### 输入 goroutine（本地终端 → Block）

```
读取 os.Stdin（raw mode，逐字节）
    ↓
检测 Ctrl+A D 前缀序列（见第五节）
    ↓
base64 编码
    ↓
ControllerInputCommand(blockId, inputData64)
```

### 终端 Resize 处理

```
监听 SIGWINCH 信号
    ↓
读取当前终端尺寸（ioctl TIOCGWINSZ）
    ↓
ControllerInputCommand(blockId, termSize={rows, cols})
```

attach 进入时立即发送一次当前尺寸。

---

## 第五节：终端处理与退出

### Raw Mode 管理

- 进入时：保存终端原始状态（`tcgetattr`），切换到 raw mode（无回显、无行缓冲）
- 退出时：无论正常/异常退出，`defer` 恢复终端状态（`tcsetattr`）

### Ctrl+A D 前缀键状态机

在输入 goroutine 内维护状态：

```
状态: normal
  读到 0x01 (Ctrl+A) → 进入 got_prefix 状态

状态: got_prefix
  读到 'd' 或 'D'    → 触发 detach，退出
  读到 0x01          → 将一个 0x01 转发给 block，保持 got_prefix 状态
  读到其他字节       → 将 0x01 + 该字节都转发给 block，回到 normal 状态
```

### 退出场景处理

| 场景 | 行为 |
|------|------|
| Ctrl+A D | 正常 detach，打印 `[detached]`，恢复终端 |
| 输出流结束（block 关闭） | 打印 `[block closed]`，退出 |
| Block controller 状态变为 done | 打印 `[process exited]`，退出 |
| 连接断开（Wave 关闭） | 打印 `[connection lost]`，退出 |
| Ctrl+C | **转发给 block**（不退出工具本身） |

---

## 关键 RPC 调用

| RPC 命令 | 用途 |
|----------|------|
| `AuthenticateCommand` | 认证握手 |
| `BlocksListCommand` | 列出所有 block（用于选择） |
| `WaveFileReadStreamCommand` | 流式读取 block 的 term 文件（历史+实时） |
| `ControllerInputCommand` | 发送键盘输入和 TermSize |

---

## 不在范围内

- 支持非 term 类型的 block（web、codeeditor 等）
- 多路复用（同时 attach 多个 block）
- 远程/SSH block 的 attach（只支持本地 Wave 实例）
- Windows 支持（Raw mode 使用 Unix syscall）
