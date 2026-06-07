# Session Daemon — Design Document V1

## 1. Overview

Session Daemon 是一个持久的远程终端 session 模型。与当前 "一个 block 对应一个远程 job" 的 1:1 架构不同，Session Daemon 将**远端连接**与**block 视图**解耦。Session Daemon 独立于任何 block 存在，多个 block 可以 attach/detach 到同一个 daemon，所有 block 共享同一份 raw 输出数据，各自独立渲染。

**核心目标**：持久化（跨重启保持）、多视图镜像、所有 block 均可输入。

## 2. Architecture

```
┌── Local WaveTerm ──────────────────────────────────────────────────┐
│                                                                     │
│  ┌── SessionDaemon ────────────────────────────────────────────┐   │
│  │  id:        "sd-abc"                                        │   │
│  │  name:      "dev"                                           │   │
│  │  jobId:     "job-xyz"                                       │   │
│  │  connName:  "ssh:user@host"                                 │   │
│  │  status:    "running"                                       │   │
│  │                                                              │   │
│  │  InputSessionId: "uuid-X"                                   │   │
│  │  seqNum: 42                                                 │   │
│  │                                                              │   │
│  │  StreamReader ──▶ runOutputLoop() ──▶ job:job-xyz/term      │   │
│  │                                                              │   │
│  │  AttachedBlocks: [block-A, block-B]                         │   │
│  └──────────────────────────────┬───────────────────────────────┘   │
│                                 │                                    │
│                    ┌────────────┴────────────┐                      │
│                    │                         │                      │
│               Block-A                   Block-B                     │
│          ┌──────────────────┐     ┌──────────────────┐             │
│          │ view: "term"     │     │ view: "term"     │             │
│          │ meta:            │     │ meta:            │             │
│          │  daemonid:sd-abc │     │  daemonid:sd-abc │             │
│          │                  │     │                  │             │
│          │ read job file    │     │ read job file    │             │
│          │ sendInput ▶ D    │     │ sendInput ▶ D    │             │
│          └──────────────────┘     └──────────────────┘             │
│                    │                         │                      │
│                    └────────┬────────────────┘                      │
│                             ▼                                       │
│                  SessionDaemon.SendInput()                          │
│                             │                                       │
│                             ▼                                       │
│                  jobcontroller.SendInput()                          │
│                             │                                       │
│                             ▼                                       │
│                   Remote JobManager(job-xyz)                        │
│                   (single attached client, 不改动)                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. Data Model

### 3.1 SessionDaemon（DB 持久化）

```
SessionDaemon {
    OID:          string         // "sd-abc"，内部标识
    Name:         string         // "dev"，用户别名，可选
    Connection:   string         // "ssh:user@host"
    JobId:        string         // "job-xyz"
    Status:       string         // "init" | "running" | "disconnected" | "done"
    Cwd:          string         // 创建时的 CWD
    CreatedAt:    int64
    IdleTimeout:  int64          // 超时回收（秒），默认 86400（24h）
    Meta:         MetaMapType
}
```

- **Name 唯一性**：全局唯一。创建时若冲突，自动追加时间后缀（`dev` → `dev-150623`），并提示用户实际名称。
- **空闲回收**：无 block attach 超过 `IdleTimeout`（默认 24h）后自动回收（`TerminateAndDetachJob` + status=done）。

### 3.2 Status 状态机

```
      ┌─────────────────────────────────────────────────┐
      │                                                  │
      ▼                                                  │
   ┌──────┐   StartJob成功    ┌─────────┐   SSH断开   ┌───────────────┐
   │ init │ ───────────────▶ │ running │ ──────────▶ │ disconnected │
   └──┬───┘                  └────┬─────┘             └───────┬───────┘
      │                           │                          │
      │ StartJob失败               │ 用户删除 (ssh在线)       │ 用户删除、idle timeout
      │                           │ 或 shell退出             │ 或 shell退出
      ▼                           ▼                          │
   ┌──────┐                   ┌──────┐                      │
   │ done │                   │ done │                      │
   └──────┘                   └──────┘                      │
      ▲                                                    │
      └────────────────────────────────────────────────────┘
```

| 状态 | 含义 | 前端 block 显示 |
|------|------|----------------|
| `init` | 正在创建，job 尚未启动 | "Starting..." |
| `running` | SSH 在线，远端 shell 运行中 | 正常终端 |
| `disconnected` | SSH 断开但远端 shell 仍存活 | "Reconnecting..." |
| `done` | 已终止 | "Session Ended" |

### 3.3 Block（扩展）

```
Block {
    ...                          // 现有字段不变
    Meta: {
        ...
        "session:daemonid": string   // 新增。为空 = 未 attach
    }
}
```

### 3.4 Job（不变）

现有结构完全保留。`AttachedBlockId` 仍为单值，指向 SessionDaemon（不直接指向 block）。

### 3.5 DurableShellController 移除

SessionDaemon 完全取代旧的 `DurableShellController`：

- 移除 `pkg/blockcontroller/durableshellcontroller.go`
- 移除 `ResyncController` 中的 `DurableShellController` 分支
- `IsBlockIdTermDurable` 不再需要
- `handleAppendJobFile` 不再同时写 `block:blockId/term`，只写 `job:jobId/term`

## 4. Backend Design

### 4.1 Controller 调度（ResyncController）

dispatch 只取决于 block 是否 attach 到 daemon，与 connection 无关：

```
if block.Meta["session:daemonid"] != "" {
    → SessionDaemonController    // 桥接到 daemon，无进程
} else if controllerName == "shell" || controllerName == "cmd" {
    → ShellController            // 本地 shell
} else if controllerName == "tsunami" {
    → TsunamiController
}
```

block 的 `connection` meta 在未 attach 时仅作为创建/attach daemon 时的提示信息，不影响 controller 类型。远端会话的概念完全由 SessionDaemon 承载。

block 三态：

```
                create / detach
  ShellController ◄─────────────────► SessionDaemonController
  (本地 shell)                         (桥接到 daemon)
       │                                       │
       │  block 创建时默认                     │ attach
       │  (或 detach 后恢复)                   │
       │                                       ▼
       └── 没有 attach 时跑本地 shell          session 输出实时显示
            行为与现有非 durable block 一致      所有 block 可输入
```

### 4.2 SessionDaemonController

```
SessionDaemonController {
    BlockId:   string
    ConnName:  string
    DaemonId:  string
}

Start():
    → SessionDaemonManager.AttachBlock(daemonId, blockId)
    → 返回 daemon.JobId（前端据此读文件）
    → 发 controllerstatus 事件

SendInput(input):
    → SessionDaemonManager.SendInput(daemonId, input.InputData)
    → 若 input.TermSize 非空，更新 daemon 的 PTY 尺寸
      (多个 block resize 时最后一个生效)

Stop():
    → SessionDaemonManager.DetachBlock(daemonId, blockId)

GetRuntimeStatus():
    → 返回 daemon 的连接状态 (running/disconnected/done)
```

### 4.3 职责分层

```
SessionDaemon              jobcontroller           Remote
──────────────             ─────────────           ──────
 生命周期编排                 原子操作                 远端执行
  Start / Reconnect /        StartJob()             RemoteStartJob
  Stop                        ReconnectJob()         RemoteReconnect
  runOutputLoop goroutine     SendInput()            RemoteTerminate
  SendInput (入口)            TerminateJob()
  AttachBlock / DetachBlock  RunOutputLoop()        ← 函数保留，goroutine 由 daemon 启动
                              handleAppendJobFile()
```

### 4.4 runOutputLoop 归属

当前 `RunOutputLoop` goroutine 由 `StartJob()` 和 `restartStreaming()` 内部启动。改为 **SessionDaemon 启动 goroutine，jobcontroller 提供函数**。

`StartJob()` 和 `restartStreaming()` 内部移除 `go runOutputLoop(...)`，改为返回 `(reader, streamMeta)`：

```go
// SessionDaemon 组装生命周期
func (sd *SessionDaemon) Start(ctx) error {
    jobId, reader, streamMeta, err := jobcontroller.StartJob(ctx, params)
    sd.jobId = jobId
    go jobcontroller.RunOutputLoop(ctx, jobId, streamMeta.Id, reader)
    return nil
}

func (sd *SessionDaemon) Reconnect(ctx) error {
    reader, streamMeta, err := jobcontroller.ReconnectJob(ctx, sd.jobId, rtOpts)
    // jobStreamIds 已更新，旧 RunOutputLoop 因 currentStreamId != streamId 自动退出
    go jobcontroller.RunOutputLoop(ctx, sd.jobId, streamMeta.Id, reader)
    return nil
}
```

`RunOutputLoop` 代码本身不动——自毁逻辑 `currentStreamId != streamId → break` 直接复用。

### 4.5 SessionDaemonManager（全局 in-memory）

```
SessionDaemonManager {
    daemons: map[daemonId] *SessionDaemon

    // daemon 操作
    GetOrCreate(params) → (*SessionDaemon, error)
    Get(daemonId) → (*SessionDaemon, error)
    Remove(daemonId)
    InitFromDB()          // 启动时恢复所有 running daemon

    // block 操作
    AttachBlock(daemonId, blockId)
    DetachBlock(daemonId, blockId)
    GetBlocksForDaemon(daemonId) → []blockId

    // 输入
    SendInput(daemonId, data []byte) → error
}

SessionDaemon (每个 daemon 一个实例) {
    daemonId       string
    jobId          string
    InputSessionId string
    seqNum         int
    reader         *streamclient.Reader
    cancel         context.CancelFunc   // 终止 runOutputLoop
    blocks         map[blockId] bool    // attached blocks

    Start()        // StartJob + runOutputLoop
    Reconnect()    // ReconnectJob + runOutputLoop
    Stop(reason)   // cancel loop, TerminateJob, notify blocks
    Shutdown()     // 进程退出时优雅断开

    GetJobId() → string
    GetStatus() → connected | disconnected | done
}
```

## 5. Data Flow

### 5.1 Output（只写 job 文件）

当前 `handleAppendJobFile` 同时写 `job:jobId/term` 和 `block:blockId/term`。
改为只写 `job:jobId/term`，所有 block 读同一份 raw 数据：

```
runOutputLoop(job-xyz)
    │
    ▼
handleAppendJobFile(jobId, "term", data)
    │
    ├── doWFSAppend(job:jobId, "term", data)
    └── WPS Publish "blockfile" scope=job:{jobId}
```

前端 TermWrap 根据 block 的 daemonId 找到 JobId，以 `jobId` 作为 zoneId 读取。

### 5.2 Input（单路复用）

所有 attached block 的输入汇聚到同一个 SessionDaemon，使用同一 `InputSessionId`：

```
Block-A.sendInput("ls\n")     Block-B.sendInput("grep\n")
         │                             │
         └────────────┬────────────────┘
                      ▼
        SessionDaemon.SendInput()
                      │
        InputSessionId: uuid-X, seqNum: ++
                      │
                      ▼
        jobcontroller.SendInput()
                      │
                      ▼
        Remote JobManager.InputQueue
        (QuickReorderQueue, 按 sessionId 排序)
```

远程 JobManager 不改动——它仍只看到一个 attachedClient，一条输入流。

## 6. Lifecycle

### 6.1 创建

```
wsh session create --name "dev" --connection ssh:user@host
    │
    ├── DB: Insert SessionDaemon{status:"init"}
    ├── StartRemoteShellJob() → job-xyz
    ├── DB: Update SessionDaemon{status:"running", jobId:"job-xyz"}
    ├── 注册到 SessionDaemonManager，启动 runOutputLoop
    └── ✅ Daemon 存活，AttachedBlocks:[]（无 block 连接）
```

### 6.2 Attach

```
wsh session attach dev --block block-A
    │
    ├── Block.Meta["session:daemonid"] = "sd-abc"
    ├── SessionDaemonManager.AttachBlock("sd-abc", "block-A")
    ├── 前端 TermWrap.attachToDaemon(jobId)
    │     ├── unsubscribe WPS blockfile scope=block:{blockId}
    │     ├── subscribe WPS blockfile scope=job:{jobId}
    │     └── loadInitialTerminalData(jobId)   // raw data，全量历史
    └── ✅ Block 显示 session 输出，可以输入
```

### 6.3 Detach

```
wsh session detach --block block-A
    │
    ├── 清除 Block.Meta["session:daemonid"]
    ├── SessionDaemonManager.DetachBlock("sd-abc", "block-A")
    ├── ControllerResync → 重建 ShellController
    │     └── ShellController.Start() → 启动本地 shell
    ├── 前端 TermWrap.detachFromDaemon()
    │     ├── unsubscribe WPS blockfile scope=job:{jobId}
    │     ├── subscribe WPS blockfile scope=block:{blockId}
    │     └── loadInitialTerminalData(blockId)
    └── ✅ Block 恢复为本地终端，daemon 继续运行
```

### 6.4 删除

```
wsh session delete dev
    │
    ├── TerminateAndDetachJob(job-xyz)
    ├── 遍历 AttachedBlocks:
    │     Block.Meta["session:daemonid"] = ""
    │     通知前端 → 显示 "Session Ended"
    ├── DB: SessionDaemon{status:"done"}
    └── ✅ 从 SessionDaemonManager 移除
```

### 6.5 WaveTerm 重启恢复

```
WaveTerm 重启
    │
    ├── SessionDaemonManager.InitFromDB()
    │
    ├── for each daemon (status = running | disconnected):
    │     1. 创建内存 daemon 对象
    │     2. ReconnectJob(jobId) → 重连远端 JobManager
    │        ├── PrepareConnect(seq = job/term 当前大小)
    │        ├── 新 StreamReader + 新 runOutputLoop
    │        └── 新 InputSessionId
    │
    └── 有 daemonid 的 block 在渲染时自动读取 job 文件
           显示 "reconnecting..." → 重连完成后正常显示
```

### 6.6 远端意外终止

```
远端 shell 退出 / 机器重启
    │
    ├── 本地 StreamReader 读到 EOF/error
    ├── runOutputLoop 退出
    ├── DB: SessionDaemon{status:"done"}
    └── 通知所有 attached block → 显示 "Session Ended"
```

## 7. Migration（一次性，启动时执行）

### 7.1 旧模型

```
Block { JobId: "job-xyz", Meta: { "term:durable": true } }
Job   { OID: "job-xyz", AttachedBlockId: "block-A" }
```

输出同时写 `job:job-xyz/term` 和 `block:block-A/term`。

### 7.2 迁移目标

```
Block         { Meta: { "session:daemonid": "sd-abc" }, JobId: "" }
SessionDaemon { OID: "sd-abc", JobId: "job-xyz" }
Job           { OID: "job-xyz", AttachedBlockId: "" }
```

### 7.3 流程

```
WaveTerm 启动，SchemaVersion 检测到需要迁移
    │
    └── 扫描 DB 中所有 Block.JobId != "" 的记录
        │
        for each block:
            ├── 创建 SessionDaemon 记录
            │     OID: uuid.new("sd-*")
            │     Name: 自动生成（"ssh:user@host:timestamp"）
            │     JobId: block.JobId（复用）
            │     Status: 根据 Job.JobManagerStatus 映射
            │     Connection: block.Meta["connection"]
            │
            ├── Block: Meta["session:daemonid"] = daemonId, JobId = ""
            ├── Job: AttachedBlockId = ""
            │
            └── 输出连续性：将 block:blockId/term 内容追加到 job:jobId/term
                 完成后删除 block:blockId/term
    │
    └── 迁移完成，更新 SchemaVersion
```

### 7.4 不兼容警告

- 迁移**不可逆**。回退后旧版本无法识别这些 block。
- 迁移前建议备份 DB。

## 8. WSH Commands

```
wsh session create --name <name> --connection <conn>    # 创建 daemon
wsh session delete <name|id>                             # 删除 daemon
wsh session list                                         # 列出所有 daemon
wsh session attach <name|id> --block <block-id>          # block 加入 daemon
wsh session detach --block <block-id>                    # block 离开 daemon
wsh session info <name|id>                               # daemon 详情
```

## 9. Frontend

### 9.1 Block 状态显示

| 状态 | Header 显示 | 内容区 |
|------|------------|--------|
| No Session | 无 daemon 标识 | 本地 shell |
| Attached (running) | `dev ●` (绿) | session 输出 |
| Attached (disconnected) | `dev ◌` (黄) | "Reconnecting..." |
| Session Ended | `dev ✗` (灰) | "Session Ended" |

### 9.2 Attach/Detach 入口

- Block header 下拉菜单
- 右键菜单
- 命令面板

### 9.3 TermWrap 切换 zoneId

当前 TermWrap 构造时绑定 `blockId` 作为 zoneId，从 `block:{blockId}/term` 读取。attach/detach 时动态切换数据源：

```
TermWrap.attachToDaemon(jobId):
    1. unsubscribe WPS blockfile scope=block:{blockId}
    2. subscribe WPS blockfile scope=job:{jobId}
    3. loadInitialTerminalData(jobId)          // raw data，全量历史

TermWrap.detachFromDaemon():
    1. unsubscribe WPS blockfile scope=job:{jobId}
    2. subscribe WPS blockfile scope=block:{blockId}
    3. loadInitialTerminalData(blockId)         // 本地 shell
```
