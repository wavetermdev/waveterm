# waveattach 设计文档

**日期：** 2026-04-27（v2）
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
├── auth.go                socket 发现 + DB 直读 JWT 私钥 + JWT 生成
├── selector.go            交互式 block 选择 UI
└── output.go              输出合成（snapshot + WPS 事件订阅）
```

---

## 第一节：整体架构

### 执行流程

```
1. 数据目录定位     读 WAVETERM_DATA_HOME，否则 fallback ~/.waveterm[-dev]
2. 直读 SQLite      $DATAHOME/db/waveterm.db 取出 JWT 私钥（read-only）
3. 生成 JWT         用私钥签发 token，含 RouteId
4. 连 Socket        $DATAHOME/wave.sock，发送 AuthenticateCommand
5. 选择 Block       没传 blockid 时调用 BlocksListCommand → 交互式选择
6. 进入 Attach 模式  终端切换 raw mode：
   ├── 输出：先 snapshot 历史，再订阅 WPS "blockfile" 事件接收增量
   └── 输入：stdin(raw) → ControllerInputCommand
7. 事件处理         SIGWINCH → 发送 TermSize / Ctrl+A D → detach
8. 清理            恢复终端状态，关闭连接
```

### 依赖的现有 Wave 包

| 包 | 用途 |
|----|------|
| `pkg/wshrpc` | RPC 类型定义 |
| `pkg/wshrpc/wshclient` | RPC 客户端调用 |
| `pkg/wshutil` | Socket 连接、JWT 生成 |
| `pkg/wavebase` | 数据目录路径常量 |
| `pkg/waveobj` | Block/MainServer 类型 |
| `pkg/wavejwt` | JWT 签名 |
| `github.com/jmoiron/sqlx` + `github.com/mattn/go-sqlite3` | 直读 DB |

---

## 第二节：数据目录、Socket 与认证

### 数据目录定位（按优先级）

```
1. 环境变量 WAVETERM_DATA_HOME（用户手动指定）
2. ~/.waveterm（生产模式）
3. ~/.waveterm-dev（开发模式）
4. 都不存在 → exit(1)，提示 Wave 是否在运行
```

### Socket 路径

```
$DATAHOME/wave.sock
```
找不到 socket → exit(1)。

### JWT 私钥获取（核心：直读 SQLite）

> **背景：** Wave 把 Ed25519 JWT 签名密钥（base64 编码）存在 SQLite 数据库的 `db_mainserver` 表里。Wave 用 WAL 模式打开数据库，外部进程可以以 read-only 模式并发读取，不冲突。

**路径：** `$DATAHOME/db/waveterm.db`

**读取流程：**
```
1. sqlx.Open("sqlite3", "file:$path?mode=ro&_journal_mode=WAL")
2. SELECT data FROM db_mainserver LIMIT 1
3. JSON 解析 data 列，取 jwtprivatekey 字段
4. base64.StdEncoding.DecodeString(...) → 64 字节 Ed25519 私钥
5. wavejwt.SetPrivateKey(privateKeyBytes)
```

### JWT 签发与认证

```
1. 构造 RpcContext:
   - SockName  = wave.sock 路径
   - RouteId   = "waveattach-{随机UUID}"
   - ProcRoute = false
2. wshutil.MakeClientJWTToken(rpcCtx) → 签名后的 JWT 字符串
3. wshutil.SetupDomainSocketRpcClient(sockName, ...) 建立连接
4. wshclient.AuthenticateCommand(rpcClient, jwtToken, ...)
5. 后续 RPC 调用走该 RouteId
```

> **注意：** 所有 socket、DB、JWT 文件路径都基于同一个 `$DATAHOME` 解析，保证 dev/prod 一致。

---

## 第三节：Block 选择 UI

### 行为规则

- 传入 `blockid` 参数 → 验证 block 存在且 view=term 后直接 attach
- 没有 term block → `exit(1)` 并打印 `error: no running term blocks found`
- 只有 1 个 term block → 自动选中，跳过 UI，直接 attach
- 多个 term block → 显示交互式选择界面

### 数据获取

`BlocksListCommand` 只返回 ID（WindowId/WorkspaceId/TabId/BlockId 全是 UUID），需要额外解析人类可读名字：

```
1. BlocksListCommand → 拿到所有 block 的 ID 和 Meta
2. 过滤 Meta.View == "term"
3. 对涉及到的 workspace/tab 批量调用 GetMeta（或对应的 RPC）拿 name 字段
4. 组装成展示用的列表
```

### 交互式选择 UI

```
选择要 attach 的 Block：

  [1] term  │ workspace: home │ tab: main   │ cwd: ~/projects/myapp
▶ [2] term  │ workspace: home │ tab: main   │ cwd: ~/go/src
  [3] term  │ workspace: work │ tab: server │ cwd: /var/log

↑/↓ 选择  Enter 确认  q 退出  │ block: a3f2c1d0-4e5f-6789-abcd-ef0123456789
```

实现细节：
- 用 ANSI 转义码实现光标移动和高亮，不引入第三方 TUI 库
- 底部状态栏右侧实时显示当前高亮 block 的完整 UUID
- 选中后清除选择 UI，直接进入 attach 模式
- 解析不到 workspace/tab 名时降级显示其 UUID 短前缀

---

## 第四节：输入输出流（关键修订）

### 输出（Block → 本地终端）：snapshot + 事件订阅

> **关键事实：** `WaveFileReadStreamCommand` **只返回调用时的快照**，不会推送后续 append。Wave 前端的实时更新是通过订阅 WPS pubsub 的 `"blockfile"` 事件（`Event_BlockFile`），事件 payload 含 append 的增量数据。

**双管齐下流程：**

```
attach 启动时（必须按此顺序避免漏数据）：

1. 先订阅 WPS "blockfile" 事件，scope = ["block:<blockid>"]
   - 把收到的事件先暂存到内存队列（暂不写 stdout）
   - 记录每个事件的 file offset

2. 调用 WaveFileReadStreamCommand(blockid, "term") 拉历史快照
   - 写入 stdout
   - 记下快照结尾的 file offset = snapshotEnd

3. 处理事件队列：
   - 丢弃 offset < snapshotEnd 的事件（已包含在快照里）
   - 处理跨界事件：截取从 snapshotEnd 开始的部分写入 stdout
   - 之后的事件直接 stdout

4. 进入稳态：每个新事件直接写 stdout
```

> **边界处理理由：** 先订阅再读快照是为了避免在两步之间漏掉新写入的字节；用 file offset 做去重是因为快照和事件可能重叠。

**Term 文件大小：**
- 实际是 **2MB 循环缓冲**（`DefaultTermMaxFileSize = 2*1024*1024`），不是 5MB
- 历史回放只能拿到最近 2MB 的输出

**流退出条件：**
- 收到 controller status = "done" 事件
- WPS 订阅断开（连接丢失）

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
| Block controller 状态变为 done | 打印 `[process exited]`，退出 |
| 连接断开（Wave 关闭） | 打印 `[connection lost]`，退出 |
| Ctrl+C | **转发给 block**（不退出工具本身） |

---

## 关键 RPC 调用

| RPC 命令 | 用途 |
|----------|------|
| `AuthenticateCommand` | 认证握手 |
| `BlocksListCommand` | 列出所有 block（用于选择） |
| `GetMetaCommand` 或 workspace/tab 查询 | 解析 workspace/tab 人类可读名 |
| `WaveFileReadStreamCommand` | 一次性读取 block term 文件历史快照 |
| `EventSubCommand` | 订阅 WPS `"blockfile"` 事件接收实时增量 |
| `ControllerInputCommand` | 发送键盘输入和 TermSize |

---

## 不在范围内

- 支持非 term 类型的 block（web、codeeditor、tsunami 等）
- 多路复用（同时 attach 多个 block）
- 远程/SSH block 的 attach（只支持本地 Wave 实例）
- Windows 支持（Raw mode 使用 Unix syscall）

---

## 已知风险与边界

1. **DB schema 变动风险：** 此设计直接读 `db_mainserver` 表的 `data` JSON 字段中的 `jwtprivatekey`。Wave 内部 schema 改变时本工具会失效。缓解：明确捕获并报告 DB schema 不匹配的错误。
2. **历史输出有限：** 只能回放最近 2MB（约 5-15 万字节字符），更早的输出已被循环缓冲覆盖。
3. **快照与事件边界：** 实现必须严格按"先订阅、后读快照、按 offset 去重"的顺序，否则会丢字节或重复输出。
