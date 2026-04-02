# ZeroAI Agent Team Collaboration - Phase 3

## Goal

实现 ZeroAI Agent 团队协作功能，支持多 Agent 并发连接、消息转发、任务分配和团队状态管理。参考 ClawTeam 协议的 Go 版本实现，使用 WSH (Wave Shell) 进行进程生命周期管理。

## Overview

基于已完成的 Sprint 1-6 (Phase 1-2)，实现 Agent 团队协作层。这是 ZeroAI 的核心协作特性，允许用户使用多个 ACP Agent 并行工作，并通过统一的团队协调器管理所有 Agent。

## Architecture

```
pkg/zeroai/
├── team/
│   ├── team-types.go          # Team, TeamMember, Task 相关类型定义
│   ├── team-coordinator.go    # TeamCoordinator - 核心协调器
│   ├── team-store.go          # TeamState 数据库存储
│   └── message-router.go      # Agent-to-Agent 消息路由
├── rpc/
│   └── wshserver-team.go      # WSH RPC server for team operations
└── store/
    └── team-store.go          # Team 数据库表和查询
```

## Requirements

### Phase 3.1: Team Types & Data Model

**文件**: `pkg/zeroai/team/team-types.go`

**职责**:

- 定义 Team 结构体
  - `TeamID`: 唯一标识
  - `Name`: 团队名称
  - `Created`: 创建时间
  - `Status`: 活跃/空闲/错误

- 定义 TeamMember 结构体
  - `AgentID`: 关联的 Agent ID
  - `Role`: 角色 (leader, worker, specialist)
  - `Status`: 在线/离线/忙碌
  - `JoinedAt`: 加入时间

- 定义 Task 结构体
  - `TaskID`: 唯一标识
  - `TeamID`: 所属团队
  - `AssignedAgentID`: 分配给哪个 Agent
  - `Status`: pending/running/completed/failed
  - `Description`: 任务描述
  - `CreatedAt`, `CompletedAt`: 时间戳

**参考**: `pkg/zeroai/types/types.go`

---

### Phase 3.2: Team Store - 数据库持久化

**文件**: `pkg/zeroai/store/team-store.go`

**职责**:

- Team CRUD 操作
  - `CreateTeam()`
  - `GetTeam()`
  - `ListTeams()`
  - `DeleteTeam()`
  - `UpdateTeamStatus()`

- TeamMember 管理
  - `AddTeamMember()`
  - `RemoveTeamMember()`
  - `ListTeamMembers()`
  - `UpdateMemberStatus()`

- Task 管理
  - `CreateTask()`
  - `GetTask()`
  - `ListTasks()`
  - `AssignTaskToAgent()`
  - `UpdateTaskStatus()`

- 数据库表设计
  - `teams`: 团队表
  - `team_members`: 成员表
  - `team_tasks`: 任务表

**参考**: `pkg/zeroai/store/session-store.go`, `pkg/zeroai/store/db-migrations.go`

---

### Phase 3.3: Team Coordinator - 核心协调器

**文件**: `pkg/zeroai/team/team-coordinator.go`

**职责**:

- 多 Agent 并发连接管理
  - 使用 `sync.Map` 或 `map[AgentID]*AgentConnection`
  - 每个连接独立管理生命周期
  - 支持添加/移除 Agent

- Agent 间消息转发
  - 实现消息队列 channel
  - `RouteMessage(fromAgentID, toAgentID, message)`
  - 支持广播消息 (所有成员)

- 简单任务分配
  - `AssignTask(teamID, agentID, taskDescription)`
  - 跟踪任务状态 (pending -> running -> completed/failed)
  - 任务超时和重试机制

- 团队状态同步
  - 定期同步所有 Agent 状态
  - 使用 `time.Ticker` 或事件驱动
  - 状态变化通知

- WSH 进程管理集成
  - 利用现有 `ProcessManager` 管理 Agent 进程
  - 进程崩溃自动重启
  - 优雅关闭所有 Agent

**技术细节**:

- 使用 goroutine 处理并发消息
- 使用 `context.Context` 进行生命周期控制
- 错误处理: 不会因为一个 Agent 错误而影响整个团队

---

### Phase 3.4: Message Router - 消息路由系统

**文件**: `pkg/zeroai/team/message-router.go`

**职责**:

- Agent-to-Agent 消息路由
  - 点对点消息: `SendToAgent()`
  - 广播消息: `Broadcast()`
  - 基于角色的消息转发

- 消息队列管理
  - 每个 Agent 独立的 message channel
  - 缓冲队列防止阻塞
  - 消息持久化 (可选，暂不实现)

- 消息类型定义
  - `AgentToAgentMessage`: 标准消息格式
  - `TaskAssignment`: 任务分配消息
  - `StatusUpdate`: 状态更新消息

---

### Phase 3.5: WSH RPC Server - 团队协作 API

**文件**: `pkg/zeroai/rpc/wshserver-team.go`

**职责**:

- 实现以下 RPC 方法 (参考 `wshserver-zeroai.go` 模式):

  ```go
  // Team 管理
  func CreateTeamCommand(ctx context.Context, req *CreateTeamRequest) (*CreateTeamResponse, error)
  func GetTeamCommand(ctx context.Context, req *GetTeamRequest) (*GetTeamResponse, error)
  func ListTeamsCommand(ctx context.Context, req *ListTeamsRequest) (*ListTeamsResponse, error)
  func DeleteTeamCommand(ctx context.Context, req *DeleteTeamRequest) (*DeleteTeamResponse, error)

  // TeamMember 管理
  func JoinTeamCommand(ctx context.Context, req *JoinTeamRequest) (*JoinTeamResponse, error)
  func LeaveTeamCommand(ctx context.Context, req *LeaveTeamRequest) (*LeaveTeamResponse, error)
  func ListTeamMembersCommand(ctx context.Context, req *ListTeamMembersRequest) (*ListTeamMembersResponse, error)

  // Task 管理
  func CreateTaskCommand(ctx context.Context, req *CreateTaskRequest) (*CreateTaskResponse, error)
  func AssignTaskCommand(ctx context.Context, req *AssignTaskRequest) (*AssignTaskResponse, error)
  func ListTasksCommand(ctx context.Context, req *ListTasksRequest) (*ListTasksResponse, error)
  func GetTaskStatusCommand(ctx context.Context, req *GetTaskStatusRequest) (*GetTaskStatusResponse, error)

  // 消息路由
  func SendToAgentCommand(ctx context.Context, req *SendToAgentRequest) (*SendToAgentResponse, error)
  func BroadcastCommand(ctx context.Context, req *BroadcastRequest) (*BroadcastResponse, error)
  ```

- RPC 类型定义: 在 `pkg/wshrpc/wshrpctypes_zeroai.go` 中添加

**参考**:

- `pkg/zeroai/rpc/wshserver-zeroai.go` - ZeroAI RPC 模式
- `pkg/zeroai/rpc/wshrpc-zeroai.go` - ZeroAI RPC 类型定义

---

## Acceptance Criteria

- [ ] **Phase 3.1**: Team types 定义完成，包含 Team, TeamMember, Task 结构体
- [ ] **Phase 3.2**: Team store 完成，CRUD 操作和数据库表创建
- [ ] **Phase 3.3**: TeamCoordinator 实现，支持多 Agent 并发连接
- [ ] **Phase 3.3**: TeamCoordinator 实现消息转发机制
- [ ] **Phase 3.3**: TeamCoordinator 实现任务分配和状态跟踪
- [ ] **Phase 3.3**: TeamCoordinator 集成 WSH ProcessManager
- [ ] **Phase 3.4**: MessageRouter 实现，支持点对点和广播消息
- [ ] **Phase 3.5**: WSH RPC server 实现，所有 RPC 方法可用
- [ ] **Phase 3.5**: WSH RPC types 定义完整
- [ ] **测试**: `go test ./pkg/zeroai/team/...` 通过
- [ ] **测试**: `go test ./pkg/zeroai/rpc/...` 通过 (包含新 RPC)
- [ ] **代码质量**: 遵循 WaveTerm Go 后端规范
- [ ] **错误处理**: 所有错误处理符合 `error-handling.md` 规范

---

## Technical Notes

### 依赖关系

```
Phase 3.1 (Team Types) ──────────────┐
                                   │
Phase 3.2 (Team Store) ─────────────┼───┐
                                   │   │
Phase 3.3 (Team Coordinator) ───────┼───┼───┐
     ├─ 依赖 Phase 3.1 (types)      │   │   │
     ├─ 依赖 Phase 3.2 (store)      │   │   │
     └─ 依赖 ProcessManager ────────┘   │   │
                                       │   │
Phase 3.4 (Message Router) ───────────┘   │
     ├─ 依赖 Phase 3.1 (types)              │
     └─ 依赖 Phase 3.3 (coordinator) ──────┤
                                           │
Phase 3.5 (WSH RPC Server) ───────────────┘
     ├─ 依赖 Phase 3.1 (types)
     ├─ 依赖 Phase 3.2 (store)
     ├─ 依赖 Phase 3.3 (coordinator)
     └─ 依赖 Phase 3.4 (router)
```

### 并发处理

- 使用 `sync.Map` 或带锁的 map 管理 Agent 连接
- 每个 Agent 使用独立的 goroutine 处理消息
- 使用 channel 进行消息通信，避免共享内存竞争
- 使用 `context.Context` 进行优雅关闭

### 参考 ZeroAI 现有服务

- **SessionService** (`pkg/zeroai/service/session-service.go`)
  - 服务层设计模式
  - 事务处理模式
  - 错误处理模式

- **AgentService** (`pkg/zeroai/service/agent-service.go`)
  - Agent 管理模式
  - 缓存策略

- **AcpAgent** (`pkg/zeroai/agent/acp-agent.go`)
  - ACP 连接管理
  - 消息处理模式

### WSH RPC 模式

参考 `pkg/zeroai/rpc/wshserver-zeroai.go`:

1. RPC 方法命名: `XxxCommand()`
2. 所有 RPC 方法接收 `context.Context` 作为第一个参数
3. 使用 `WshRpcServer` 注册方法
4. 返回值使用指针类型 (避免值拷贝)
5. 错误处理: 返回自定义错误类型，包含错误码和消息

### ProcessManager 集成

参考 `pkg/zeroai/process/process-manager.go`:

- 使用 `ProcessManager.SpawnProcess()` 启动 Agent 进程
- 使用 `ProcessManager.MonitorProcess()` 监控进程状态
- 进程关闭时调用 `ProcessManager.KillProcess()`
- 注册回调处理进程崩溃事件

### 数据库迁移

在 `pkg/zeroai/store/db-migrations.go` 中添加:

```go
// Create teams table
CREATE TABLE IF NOT EXISTS teams (
    team_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
);

// Create team_members table
CREATE TABLE IF NOT EXISTS team_members (
    member_id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE CASCADE
);

// Create team_tasks table
CREATE TABLE IF NOT EXISTS team_tasks (
    task_id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    assigned_agent_id TEXT,
    status TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE CASCADE
);

// Indexes
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_tasks_team_id ON team_tasks(team_id);
CREATE INDEX IF NOT EXISTS idx_team_tasks_assigned_agent ON team_tasks(assigned_agent_id);
```

---

## Out of Scope

- **高级团队协作功能** (如计划管理、依赖管理、复杂工作流)
- **Agent 之间的实时协作编辑** (如代码协作)
- **复杂的任务调度算法** (负载均衡、优先级队列)
- **多团队协作** (跨团队消息、团队联邦)
- **团队 UI** (前端团队管理界面，这是前端任务)
- **持久化消息队列** (暂时只在内存中)
- **消息加密和安全认证** (基础实现即可)

---

## Tasks Breakdown

此 PRD 将分解为以下 ClawTeam 团队：

| Team                        | 任务                               | 依赖             |
| --------------------------- | ---------------------------------- | ---------------- |
| **zeroai-team-types**       | Phase 3.1: Team Types & Data Model | 无（优先级最高） |
| **zeroai-team-store**       | Phase 3.2: Team Store & Migrations | Phase 3.1        |
| **zeroai-team-coordinator** | Phase 3.3: Team Coordinator        | Phase 3.1 + 3.2  |
| **zeroai-message-router**   | Phase 3.4: Message Router          | Phase 3.1 + 3.3  |
| **zeroai-team-rpc**         | Phase 3.5: WSH RPC Server          | Phase 3.1-3.4    |

**并行开发策略**:

1. **Team 1** (types) - 完成后解锁其他所有团队
2. **Team 2** (store) - 依赖 types，可以与 Team 3 并行
3. **Team 3** (coordinator) - 依赖 types + store
4. **Team 4** (router) - 依赖 types + coordinator
5. **Team 5** (rpc) - 依赖所有前置任务，最后整合
