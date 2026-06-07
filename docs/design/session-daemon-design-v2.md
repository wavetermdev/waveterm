# Session Daemon — Design Document V2

## 1. Overview

Session Daemon 是一个持久的远程终端 session 模型。与当前 "一个 block 对应一个远程 job" 的 1:1 架构不同，Session Daemon 将**远端连接**与**block 视图**解耦。Session Daemon 独立于任何 block 存在，多个 block 可以 attach/detach 到同一个 daemon，所有 block 共享同一份 raw 输出数据，各自独立渲染。

**核心目标**：持久化（跨重启保持）、多视图镜像、所有 block 均可输入。

### 与 V1 的关键差异

V2 在 V1 的基础上做了简化：**runOutputLoop 不动，留在 JobController 内部**。SessionDaemon 只做命名、多 block 追踪、空闲超时，不管理 PTY、不管理输出流。详见 4.4 节。

## 2. Architecture

```
┌── Local WaveTerm ──────────────────────────────────────────────────┐
│                                                                     │
│  ┌── SessionDaemon ────────────────────────────────────────────┐   │
│  │  id:        "sd-abc"            name: "dev"                 │   │
│  │  jobId:     "job-xyz"                                       │   │
│  │  connName:  "ssh:user@host"                                 │   │
│  │  status:    "running"                                       │   │
│  │                                                              │   │
│  │  AttachedBlocks: [block-A, block-B]                         │   │
│  │                                                              │   │
│  │  ─── 不管理 PTY、不管理输出流 ───                             │   │
│  │  runOutputLoop → JobController 内部管理                      │   │
│  │  InputSessionId → SessionDaemon 持有，用于输入排序           │   │
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
│  ┌────────── JobController ───────────────────────────────┐        │
│  │  runOutputLoop (goroutine, 内部管理)                     │        │
│  │  StartJob() → 启动 runOutputLoop                        │        │
│  │  ReconnectJob() → 新流取代旧流 (自毁机制)                │        │
│  │  SendInput() / TerminateJob() / connReconcileWorker     │        │
│  └─────────────────────────────────────────────────────────┘        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. Data Model

### 3.1 SessionDaemon（DB 持久化）

```
SessionDaemon {
    OID:          string         // "sd-abc"，内部标识
    Name:         string         // "dev"，用户别名。空 = 匿名 daemon
    Connection:   string         // "ssh:user@host"
    JobId:        string         // "job-xyz"
    IsAnonymous:  bool           // true = 自动创建，无 name
    Status:       string         // "init" | "running" | "disconnected" | "done"
    Cwd:          string         // 创建时的 CWD
    CreatedAt:    int64
    IdleTimeout:  int64          // 超时回收（秒）
    Meta:         MetaMapType
}
```

- **命名 daemon**：通过 `wsh session create --name dev` 创建，`Name` 全局唯一。冲突时自动追加时间后缀（`dev` → `dev-150623`）。
- **匿名 daemon**：SSH block 启动时自动创建，`Name=""`，`IsAnonymous=true`。
- **空闲回收**：无 block attach 超过 `IdleTimeout` 后自动回收。默认值按类型区分：
  - 匿名 daemon：**1h**（`3600` 秒）
  - 命名 daemon：**24h**（`86400` 秒）

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

现有结构完全保留。`Job.AttachedBlockId` 仍为单值，指向 daemon（不直接指向 block）。

### 3.5 DurableShellController 被 SessionDaemon 取代

SessionDaemon 覆盖了 DurableShellController 的全部职责，且支持多 block attach：

- 移除 `pkg/blockcontroller/durableshellcontroller.go`
- 移除 `ResyncController` 中的 `DurableShellController` 分支
- `IsBlockIdTermDurable` 不再需要
- SSH block 启动时自动创建匿名 daemon，行为与之前一致（持久化、自动重连），同时获得多 block 共享能力
- `handleAppendJobFile` 不再同时写 `block:blockId/term`，只写 `job:jobId/term`

## 4. Backend Design

### 4.1 Controller 调度（ResyncController）

```
if block.Meta["session:daemonid"] != "" {
    → SessionDaemonController    // 桥接到 daemon
} else if connType == SSH {
    → 创建匿名 SessionDaemon
      Block.Meta["session:daemonid"] = newDaemonId
      ControllerResync（下一轮进入 SessionDaemonController）
} else {
    → ShellController            // 本地 / WSL
}
```

SSH block 启动时自动创建匿名 daemon（`IsAnonymous=true`，`IdleTimeout=1h`），后续交互全通过 `SessionDaemonController`。daemon 的创建对用户透明——用户打开 SSH block 的体验与之前一致。

只有当用户主动 `wsh session create --name` 时，才会产生命名 daemon。命名 daemon 可被多个 block attach，空闲超时 24h。

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
 session 管理              原子操作                 远端执行
  Name → jobId 映射          StartJob()              RemoteStartJob
  多 block attach/detach     ReconnectJob()          RemoteReconnect
  空闲超时回收               SendInput()             RemoteTerminate
  wsh CLI 入口              TerminateJob()
                             runOutputLoop (goroutine)
                             connReconcileWorker
                             jobPruningWorker
                             handleAppendJobFile()
```

### 4.4 runOutputLoop 保持原位（与 V1 的关键差异）

V1 提议将 runOutputLoop 从 `StartJob()` 内部迁入 SessionDaemon，使 daemon 获得输出流的生命周期控制权。V2 决定不迁移，理由如下：

**1. 现有自毁机制足够**

JobController 的 `RestartStreaming()` 在重连时创建新 StreamReader，新的 `runOutputLoop` 通过 `currentStreamId != streamId` 自毁检查自动取代旧 loop。SessionDaemon 无需感知或干预这个过程。

重连流程完全在 JobController 内部闭环：

```
ReconnectJob(jobId)
  → PrepareConnect() → 新 StreamReader + 新 streamId
  → go runOutputLoop(ctx, jobId, newStreamId, newReader)
      → 每次循环检查 currentStreamId == streamId?
      → 旧 runOutputLoop 检测到 streamId 不匹配 → break
```

**2. 避免破坏已有契约**

`StartJob()` 当前返回 `(string, error)`，内部启动 goroutine。将 runOutputLoop 迁出需要改为返回 `(string, *streamclient.Reader, *StreamMeta, error)`，影响所有现有调用方。V2 认为不值得为这个改动破坏已有 API。

**3. 职责分离**

SessionDaemon 关注"有哪些 block 在看我"，不关注"字节流怎么读怎么写"。输出流的生命周期是 JobController 的内部实现细节，SessionDaemon 不需要知道 StreamReader 的存在。

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
    name           string
    jobId          string
    InputSessionId string   // 输入排序用，所有 attached block 共用
    seqNum         int      // 单调递增
    blocks         map[blockId] bool

    // 不管理 PTY / reader / runOutputLoop
    // 这些全部由 JobController 内部管理

    Start()        // → jobcontroller.StartJob()，委托
    Reconnect()    // → jobcontroller.ReconnectJob()
    Stop()         // → jobcontroller.TerminateJob()
    SendInput()    // → jobcontroller.SendInput()
    Status()       // → jobcontroller.GetJobManagerStatus()
}
```

## 5. Data Flow

### 5.1 Output（只写 job 文件）

当前 `handleAppendJobFile` 同时写 `job:jobId/term` 和 `block:blockId/term`。
改为只写 `job:jobId/term`，所有 block 读同一份 raw 数据：

```
runOutputLoop(job-xyz)  ← JobController 内部管理
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
    │     (JobController 内部启动 runOutputLoop)
    ├── DB: Update SessionDaemon{status:"running", jobId:"job-xyz"}
    ├── 注册到 SessionDaemonManager
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
    │     (JobController 终止进程 + 停止 runOutputLoop)
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
    │     2. JobController.ReconnectJob(jobId) → 内部管理新 runOutputLoop
    │     3. 新 InputSessionId
    │
    └── 有 daemonid 的 block 在渲染时自动读取 job 文件
           显示 "reconnecting..." → 重连完成后正常显示
```

### 6.6 远端意外终止

```
远端 shell 退出 / 机器重启
    │
    ├── 本地 StreamReader 读到 EOF/error (JobController 内部)
    ├── runOutputLoop 退出 (JobController 内部)
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
