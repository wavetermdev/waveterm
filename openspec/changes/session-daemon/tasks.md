## 1. Data Model — SessionDaemon DB 记录

- [x] 1.1 在 `pkg/waveobj/` 新增 `SessionDaemon` struct（OID, Name, Connection, JobId, IsAnonymous, Status, Cwd, CreatedAt, IdleTimeout, Meta）
- [x] 1.2 在 DB 创建 `sessiondaemon` 表（或扩展现有 schema）
- [x] 1.3 新增 `MetaKey_SessionDaemonId = "session:daemonid"` 常量
- [x] 1.4 在 `MetaTSType` 新增 `SessionDaemonId string` 字段

## 2. SessionDaemon + SessionDaemonManager

- [x] 2.1 新建 `pkg/sessiondaemon/` 包
- [x] 2.2 实现 `SessionDaemon` struct（daemonId, name, jobId, InputSessionId, seqNum, blocks, status）
- [x] 2.3 实现 `SessionDaemon.Start()` → `jobcontroller.StartJob()`
- [x] 2.4 实现 `SessionDaemon.Reconnect()` → `jobcontroller.ReconnectJob()`
- [x] 2.5 实现 `SessionDaemon.Stop()` → `jobcontroller.TerminateJob()`
- [x] 2.6 实现 `SessionDaemon.SendInput()` → `jobcontroller.SendInput()`
- [x] 2.7 实现 `SessionDaemonManager`（map, GetOrCreate, Get, Remove, InitFromDB）
- [x] 2.8 实现 AttachBlock / DetachBlock / GetBlocksForDaemon
- [x] 2.9 实现空闲超时回收 goroutine（检查 IdleTimeout，定时扫描）

## 3. SessionDaemonController

- [x] 3.1 新建 `pkg/blockcontroller/sessiondaemoncontroller.go`
- [x] 3.2 实现 `SessionDaemonController` struct + Controller 接口方法（Start, SendInput, Stop, GetRuntimeStatus, Resync）
- [x] 3.3 修改 `ResyncController` 调度：检测 `session:daemonid` 走 SessionDaemonController
- [x] 3.4 修改 ResyncController：SSH block + 无 daemonid 时自动创建匿名 daemon

## 4. DurableShellController 移除

- [x] 4.1 删除 `pkg/blockcontroller/durableshellcontroller.go`
- [x] 4.2 移除 `ResyncController` 中的 DurableShellController 分支
- [x] 4.3 移除 `IsBlockIdTermDurable` 调用（不再需要）

## 5. 输出流修改

- [x] 5.1 `runOutputLoop` 中的 `handleAppendJobFile` 不再写 `block:blockId/term`（只写 `job:jobId/term`）
- [x] 5.2 前端 TermWrap 支持动态切换 zoneId（block ↔ job）

## 6. wsh CLI 命令

- [x] 6.1 新建 `cmd/wsh/cmd/wshcmd-session.go`
- [x] 6.2 实现 `wsh session create`（支持 --name, --connection, --idle-timeout）
- [x] 6.3 实现 `wsh session delete`
- [x] 6.4 实现 `wsh session list`（支持 --all 显示匿名 daemon）
- [x] 6.5 实现 `wsh session attach`
- [x] 6.6 实现 `wsh session detach`
- [x] 6.7 实现 `wsh session info`
- [x] 6.8 实现 `wsh session tag`（匿名转命名）

## 7. 前端

- [ ] 7.1 Block header 显示 daemon 名称和状态（dev ● / dev ◌ / dev ✗）
- [ ] 7.2 右键菜单 / header 下拉添加 attach/detach 入口
- [ ] 7.3 TermWrap 实现 `attachToDaemon(jobId)` 和 `detachFromDaemon()`

## 8. Migration

- [x] 8.1 编写 DB migration：创建 sessiondaemon 表
- [x] 8.2 扫描所有 Block.JobId != "" 的记录，迁移到 SessionDaemon
- [x] 8.3 迁移完成后清理旧 block:blockId/term 文件（数据已合并到 job:jobId/term）

## 9. Build & Verify

- [x] 9.1 编译通过（`go build ./...`）
- [x] 9.2 前端 build 通过（`npm run build:prod`）
- [x] 9.3 `task package` 构建成功
