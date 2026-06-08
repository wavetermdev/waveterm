## Why

当前 Wave 的远端 SSH session 模型是 "一个 block 对应一个远程 job" 的 1:1 架构。无法实现多个 block 共享同一个远端会话、会话跨重启持久保持、以及会话有名称可管理。Session Daemon 将**远端连接**与**block 视图**解耦，允许用户创建命名的持久 session，多个 block 可以 attach/detach 到同一个 session。

## What Changes

- **SessionDaemon** — 新增持久化实体（DB 记录），每个 SSH block 启动时自动创建匿名 daemon，用户也可通过 `wsh session create` 创建命名 daemon
- **SessionDaemonController** — 新增 Controller 类型，桥接到 daemon，不管理进程。取代现有 `DurableShellController`
- **DurableShellController** — 移除，功能由 SessionDaemon 覆盖
- **空闲超时** — 匿名 daemon 默认 1h 超时回收，命名 daemon 默认 24h
- **wsh 命令** — 新增 `wsh session create/delete/list/attach/detach/info` 一组 CLI 命令
- **前端** — block header 显示 daemon 名称和状态（`dev ●`），支持 attach/detach 操作
- TermWrap 支持动态切换数据源 zoneId（block ↔ job）

## Capabilities

### New Capabilities
- `session-create-delete`: 创建和删除 SessionDaemon（命名 daemon 和匿名 daemon）
- `session-attach-detach`: Block attach/detach 到 daemon，前端切换 zoneId
- `session-idle-timeout`: 空闲超时回收，区分匿名 daemon（1h）和命名 daemon（24h）
- `session-auto-create`: SSH block 启动时自动创建匿名 daemon，IdleTimeout=1h
- `session-reconnect`: 网络重连后恢复，TerminateOnReconnect 机制确保关闭的 block 的远端 job 被清理
- `session-wsh-cli`: `wsh session` 命令组（create/delete/list/attach/detach/info）

### Modified Capabilities
- （无现有 spec 变更）

## Impact

- **新增** `pkg/sessiondaemon/` 包（SessionDaemon + SessionDaemonManager）
- **新增** `pkg/blockcontroller/sessiondaemoncontroller.go`（Controller 实现）
- **移除** `pkg/blockcontroller/durableshellcontroller.go`
- **修改** `pkg/blockcontroller/blockcontroller.go`（ResyncController 调度分支）
- **修改** `pkg/jobcontroller/jobcontroller.go`（runOutputLoop 不变，IsBlockTermDurable 不再需要）
- **新增** `cmd/wsh/cmd/wshcmd-session.go`（wsh CLI 命令）
- **新增** DB migration（创建 session_daemon 表，迁移旧 Job 记录）
- 前端新增 attach/detach 逻辑
