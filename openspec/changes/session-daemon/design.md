## Context

当前 Wave 使用 `DurableShellController` + `JobController` 管理远端 SSH session，采用 1 block ↔ 1 job 的 1:1 模型。不支持多 block 共享会话、会话命名、空闲超时回收等能力。

已有设计文档 `docs/design/session-daemon-design-v2.md` 包含完整架构图和数据流。

### 现有架构

```
Block → DurableShellController → JobController → Remote JobManager
        1:1                    函数库            每个 job 一个
```

### 目标架构

```
Block → SessionDaemonController → SessionDaemon → JobController → Remote
        N:1 桥接                命名/超时/attach  函数库 (不动)
```

## Goals / Non-Goals

**Goals:**
- SSH block 启动时自动创建匿名 daemon（`IdleTimeout=1h`），行为与当前一致
- 用户可通过 `wsh session create` 创建命名 daemon（`IdleTimeout=24h`）
- 多个 block 可 attach 到同一 daemon，共享输出、各自可输入
- daemon 空闲超时自动回收
- 网络重连后的 TerminateOnReconnect 机制保持不变
- 前端显示 daemon 名称和状态

**Non-Goals:**
- 本地/WSL block 不受影响（继续用 ShellController）
- runOutputLoop 不搬（留在 JobController 内部）
- SessionDaemon 不做进程管理，只做 session 管理

## Decisions

### 1. runOutputLoop 保持原位（vs 迁入 SessionDaemon）

详见 `docs/design/session-daemon-design-v2.md#44-runoutputloop-保持原位与-v1-的关键差异`。

理由：JobController 的 `currentStreamId != streamId` 自毁机制已能处理重连流切换，无需 SessionDaemon 介入。不破坏 `StartJob()` 的现有返回值契约。

### 2. 匿名 daemon vs 命名 daemon 区分

匿名 daemon：
- SSH block 启动时自动创建，`Name=""`, `IsAnonymous=true`
- `IdleTimeout=1h`
- 用户无感知，不能 attach 其他 block（除非先命名）
- 可通过 `wsh session tag sd-xxx --name dev` 转为命名

命名 daemon：
- 通过 `wsh session create --name dev` 创建
- `IsAnonymous=false`, `IdleTimeout=24h`
- 可被多个 block attach

### 3. DurableShellController 完全移除

SessionDaemon + 匿名 daemon 覆盖了 DurableShellController 的全部能力（持久化、自动重连），同时新增多 block attach 和空闲超时。

### 4. ControllerResync 调度

```
if block.Meta["session:daemonid"] != "":
    → SessionDaemonController
else if connType == SSH:
    → 创建匿名 daemon → Block.Meta 写入 daemonId → 下一轮进入 SessionDaemonController
else:
    → ShellController
```

### 5. 输出流共享

所有 attached block 读同一份 `job:jobId/term`。现有 WPS `scope=job:{jobId}` 发布机制已支持多订阅者。前端 TermWrap 在 attach/detach 时切换 zoneId。

### 6. 输入汇聚

所有 attached block 的输入使用同一个 `InputSessionId`，远端 QuickReorderQueue 按 sessionId 排序去重。

## Risks / Trade-offs

- **远端 jobmanager 无心跳超时**：如果网络永远不恢复且 shell 进程不退出，jobmanager 会一直存在。可接受——1h 内无 block attach 则本地 daemon 标记为 done，但远端进程不受影响。远端侧可后续加 `wsh session prune` 命令手动清理。
- **迁移不可逆**：从 DurableShellController 迁移后，回退到旧版本无法识别 `session:daemonid`。建议迁移前备份 DB。
