# ZeroAI 任务分解 v2.0

> 基于 AIONUi 架构分析，优化任务拆分，支持多人并行开发

---

## 开发组织

### 团队划分 (建议)

| 团队 | 职责 | 规模 | 工期 |
|------|------|------|------|
| **类型定义组** | 类型定义、Schema | 1 人 | 1 天 |
| **协议层组** | ACP 连接、适配器、配置 | 2 人 | 4 天 |
| **存储层组** | 数据库、存储接口 | 1-2 人 | 2 天 |
| **进程层组** | 进程管理、WSH 集成 | 1 人 | 2 天 |
| **Agent 适配器组** | 各 Agent 实现 | 4 人 (每人 1-2 个) | 3 天 |
| **服务层组** | Service 层逻辑 | 2 人 | 2 天 |
| **RPC 层组** | WSH RPC 接口 | 1 人 | 2 天 |
| **前端组** | UI 组件、状态管理 | 2-3 人 | 4 天 |
| **集成测试组** | E2E 测试 | 1-2 人 | 2 天 |

---

## Phase 1: MVP 任务拆分

### Sprint 1: 基础设施 (Day 1-2)

#### 1.1 类型定义 (🟢 完全独立，优先)

**负责**: 类型定义组
**工期**: 1 天
**前置条件**: 无

**任务**:

- [ ] **1.1.1 ACP 类型定义** (`pkg/zeroai/protocol/acp-types.go`)
  - 定义 `AcpBackend` 类型
  - 定义 `AcpRequest`, `AcpResponse`, `AcpNotification`
  - 定义 `AcpSessionUpdate` 类型层次
  - 定义 `AcpPermissionRequest`, `AcpOption`
  - 定义 `AcpSessionConfigOption`, `AcpSessionModels`, `AcpModelInfo`
  - 定义 `AcpBackendConfig`
  - 定义 session mode 常量 (ClaudeYoloSessionMode 等)
  - 定义 `AcpError` 类型体系
  - **验收**: 类型定义完整，通过编译测试

- [ ] **1.1.2 Agent 接口定义** (`pkg/zeroai/agent/agent-interface.go`)
  - 定义 `Agent` 接口
  - 定义 `AgentSession`, `SendMessageInput`, `AgentEvent`
  - 定义 `EventType` 常量
  - 定义 `AgentStatus`
  - 定义 `AgentFactory` 接口
  - **验收**: 接口定义清晰，无循环依赖

- [ ] **1.1.3 存储接口定义** (`pkg/zeroai/store/store-interface.go`)
  - 定义 `SessionStore` 接口
  - 定义 `MessageStore` 接口
  - 定义 `ListOptions`
  - **验收**: 接口定义清晰，易于实现

- [ ] **1.1.4 内部类型定义** (`pkg/zeroai/types/types.go`)
  - 定义 `ZeroAiSession`, `ZeroAiMessage`
  - 定义 `ZeroAiEvent`, `PermissionOption`
  - 定义内部消息类型
  - **验收**: 类型完整覆盖所有需求

---

#### 1.2 数据库设计 (🟢 完全独立)

**负责**: 存储层组
**工期**: 1 天
**前置条件**: 1.1.1 完成

**任务**:

- [ ] **1.2.1 数据库迁移脚本** (`pkg/zeroai/store/db-migrations.go`)
  - 设计 `zeroai_sessions` 表结构
  - 设计 `zeroai_messages` 表结构
  - 编写迁移 SQL (CREATE TABLE + INDEX)
  - 实现迁移执行逻辑
  - **验收**: 迁移脚本可执行，表结构正确

- [ ] **1.2.2 Session Store 实现** (`pkg/zeroai/store/session-store.go`)
  - 实现 `Create()` - 创建会话
  - 实现 `Get()` - 获取会话
  - 实现 `Update()` - 更新会话
  - 实现 `Delete()` - 删除会话
  - 实现 `List()` - 列出会话 (支持过滤)
  - **验收**: 单元测试通过，CRUD 完整

- [ ] **1.2.3 Message Store 实现** (`pkg/zeroai/store/message-store.go`)
  - 实现 `Add()` - 添加消息
  - 实现 `GetSessionMessages()` - 获取会话消息
  - 实现 `Delete()` - 删除会话消息 (级联)
  - **验收**: 单元测试通过

- [ ] **1.2.4 Schema 定义** (`schema/zeroai.json`)
  - 定义 JSON Schema
  - 添加验证规则
  - **验收**: 通过 schema 验证工具

---

### Sprint 2: 协议层 (Day 2-5, 并行)

#### 2.1 ACP 连接实现 (🟢 完全独立)

**负责**: 协议层组
**工期**: 2 天
**前置条件**: 1.1.1 完成

**任务**:

- [ ] **2.1.1 JSON-RPC 编解码** (`pkg/zeroai/protocol/acp-message.go`)
  - 实现 `EncodeRequest()` - 编码请求
  - 实现 `EncodeNotification()` - 编码通知
  - 实现 `DecodeResponse()` - 解码响应
  - 实现 `DecodeNotification()` - 解码通知
  - 实现批量消息处理
  - **验收**: 通过互操作性测试

- [ ] **2.1.2 ACP Connection 基础结构** (`pkg/zeroai/protocol/acp-connection.go`)
  - 定义 `AcpConnection` 结构体
  - 定义 `AcpCallbacks` 结构体
  - 定义 `PendingRequest` 结构体
  - 实现 `Connection` 接口方法签名
  - 实现 `IsConnected()`, `HasSession()`, `GetSessionID()`
  - **验收**: 结构体完整，编译通过

- [ ] **2.1.3 进程通信管理** (继续 acp-connection.go)
  - 实现 `Initialize()` - 初始化连接
  - 实现 `Close()` - 清理资源
  - 实现进程启动 (调用进程层接口)
  - 实现进程终止
  - 实现 stdio 管道管理
  - **验收**: 进程可以启动和终止

- [ ] **2.1.4 JSON-RPC 请求处理** (继续 acp-connection.go)
  - 实现 `SendMessage()` - 发送请求
  - 实现 `SendNotification()` - 发送通知
  - 实现 `PendingRequest` 管理 (添加/移除/超时)
  - 实现请求映射 (ID ↔ channel)
  - **验收**: 请求可以发送和等待响应

- [ ] **2.1.5 响应解析和处理** (继续 acp-connection.go)
  - 实现 stdout 流读取
  - 实现 JSON 解析
  - 实现 response 路由 (PendingRequest 或回调)
  - 实现错误处理
  - **验收**: 响应可以正确路由

- [ ] **2.1.6 会话管理** (继续 acp-connection.go)
  - 实现 `NewSession()` - JSON-RPC session/new
  - 实现 `LoadSession()` - JSON-RPC session/load
  - 实现会话状态缓存
  - 实现会话模式设置 (`SetSessionMode()`)
  - **验收**: 会话可以创建和加载

- [ ] **2.1.7 流式处理** (继续 acp-connection.go)
  - 实现 `StreamPrompt()` - JSON-RPC prompt/stream
  - 实现流式数据回调
  - 实现内容块处理
  - **验收**: 流式数据可以接收

- [ ] **2.1.8 权限验证** (继续 acp-connection.go)
  - 实现权限请求路由
  - 实现权限回调调用
  - **验收**: 权限请求可以正确路由

- [ ] **2.1.9 连接工厂函数**
  - 实现 `NewClaudeConnection()`
  - 实现 `NewQwenConnection()`
  - 实现 `NewCodexConnection()`
  - 实现 `NewOpenCodeConnection()`
  - **验收**: 各后端连接可以创建

---

#### 2.2 ACP 适配器实现 (🟢 完全独立)

**负责**: 协议层组
**工期**: 1 天
**前置条件**: 1.1.1, 1.1.4 完成

**任务**:

- [ ] **2.2.1 AcpAdapter 基础结构** (`pkg/zeroai/protocol/acp-adapter.go`)
  - 定义 `AcpAdapter` 结构体
  - 定义转换结果类型
  - **验收**: 结构体完整

- [ ] **2.2.2 Session Update 转换** (继续 acp-adapter.go)
  - 实现 `ConvertSessionUpdate()` - 分发转换
  - 实现 `ConvertSessionUpdateChunk()` - 内容块
  - **验收**: 内容转换正确

- [ ] **2.2.3 Tool Call 转换** (继续 acp-adapter.go)
  - 实现 `ConvertToolCall()` - 工具调用
  - 实现工具状态转换
  - **验收**: 工具调用转换正确

- [ ] **2.2.4 Permission 转换** (继续 acp-adapter.go)
  - 实现 `ConvertPermission()` - 权限请求
  - 实现 `convertAcpOptions()` - 选项转换
  - **验收**: 权限转换正确

- [ ] **2.2.5 其他消息类型转换** (继续 acp-adapter.go)
  - Plan update 转换
  - 其他 notification 转换
  - **验收**: 所有消息类型都有转换

---

#### 2.3 ACP 配置实现 (🟢 完全独立)

**负责**: 协议层组
**工期**: 1 天
**前置条件**: 1.1.1 完成

**任务**:

- [ ] **2.3.1 ACP 配置管理** (`pkg/zeroai/protocol/acp-config.go`)
  - 定义后端配置常量
  - 实现 `GetBackendConfig()` - 获取后端配置
  - 实现配置验证
  - **验收**: 配置可以正确加载

- [ ] **2.3.2 CLI 检测器** (`pkg/zeroai/protocol/acp-detector.go`)
  - 实现 `DetectCLIs()` - 检测可用 CLI
  - 实现平台兼容检测 (`which`/`Get-Command`)
  - **验收**: CLI 检测正确

---

### Sprint 3: 进程层 (Day 3-4, 独立)

**负责**: 进程层组
**工期**: 2 天
**前置条件**: WSH 接口可用

**任务**:

- [ ] **3.1 进程管理器接口** (`pkg/zeroai/process/process-manager.go`)
  - 定义 `ProcessManager` 接口
  - 定义 `ProcessSpec`, `AgentProcess`, `ProcessState`
  - 定义 `ProcessInfo`
  - **验收**: 接口定义完整

- [ ] **3.2 WSH 进程管理器** (继续 process-manager.go)
  - 实现 `WSHProcessManager`
  - 实现 `SpawnProcess()` - 使用 WSH ShellProcessController
  - 实现 `KillProcess()` - 终止进程
  - 实现 `GetProcessInfo()` - 获取进程信息
  - 实现 `ListProcesses()` - 列出进程
  - **验收**: 进程可以启动和终止

- [ ] **3.3 进程生成器** (`pkg/zeroai/process/process-spawner.go`)
  - 实现 `buildAcpCommand()` - 构建 ACP 命令
  - 实现 `buildAgentEnv()` - 构建环境变量
  - 实现平台兼容 (Unix/Windows)
  - **验收**: 命令和环境变量正确

---

### Sprint 4: Agent 适配器 (Day 4-7, 并行)

#### 4.1 ACP Agent 实现 (依赖协议层)

**负责**: Agent 适配器组
**工期**: 2 天
**前置条件**: 2.1, 2.2, 3.2 完成

**任务**:

- [ ] **4.1.1 AcpAgent 结构体** (`pkg/zeroai/agent/acp-agent.go`)
  - 定义 `AcpAgent` 结构体
  - 实现 `NewAcpAgent()` 构造函数
  - 实现 Connection 集成
  - **验收**: AcpAgent 可以创建

- [ ] **4.1.2 Agent 接口实现 - 生命周期** (继续 acp-agent.go)
  - 实现 `Start()` - 初始化连接
  - 实现 `Stop()` - 关闭连接
  - 实现 `IsRunning()` - 状态查询
  - **验收**: 生命周期管理正确

- [ ] **4.1.3 Agent 接口实现 - 会话管理** (继续 acp-agent.go)
  - 实现 `CreateSession()` - 创建会话
  - 实现 `LoadSession()` - 加载会话
  - 实现 `DeleteSession()` - 删除会话
  - 实现 `ListSessions()` - 列出会话
  - **验收**: 会话管理完整

- [ ] **4.1.4 Agent 接口实现 - 消息处理** (继续 acp-agent.go)
  - 实现 `SendMessage()` - 发送消息
  - 实现事件通道管理
  - 实现流式事件转发
  - **验收**: 消息可以发送和接收

- [ ] **4.1.5 Agent 接口实现 - 权限** (继续 acp-agent.go)
  - 实现 `ConfirmPermission()` - 确认权限
  - 实现权限回调处理
  - **验收**: 权限确认正确

- [ ] **4.1.6 Agent 接口实现 - 状态** (继续 acp-agent.go)
  - 实现 `GetStatus()` - 获取状态
  - 实现 `GetSession()` - 获取会话
  - **验收**: 状态查询正确

---

#### 4.2 各后端适配器 (完全并行)

**负责**: Agent 适配器组 (每人 1-2 个后端)
**工期**: 每个后端 1 天
**前置条件**: 4.1 完成

**任务**:

- [ ] **4.2.1 Claude 适配器** (`pkg/zeroai/agent/adapters/claude/`)
  - 实现 Claude 特定参数
  - 实现 Claude 连接工厂
  - 测试 claude-code CLI
  - **验收**: CLAUDE 通过测试

- [ ] **4.2.2 Qwen 适配器** (`pkg/zeroai/agent/adapters/qwen/`)
  - 实现 Qwen 特定参数
  - 实现 Qwen 连接工厂
  - 测试 qwen CLI
  - **验收**: QWEN 通过测试

- [ ] **4.2.3 Codex 适配器** (`pkg/zeroai/agent/adapters/codex/`)
  - 实现 Codex 特定参数
  - 实现 Codex 连接工厂
  - 测试 codex CLI (通过 codex-acp)
  - **验收**: CODEX 通过测试

- [ ] **4.2.4 OpenCode 适配器** (`pkg/zeroai/agent/adapters/opencode/`)
  - 实现 OpenCode 特定参数
  - 实现 OpenCode 连接工厂
  - 测试 opencode CLI
  - **验收**: OPENCODE 通过测试

---

### Sprint 5: 服务层 (Day 6-7)

**负责**: 服务层组
**工期**: 2 天
**前置条件**: 4.1, 1.2 完成

**任务**:

- [ ] **5.1 Session Service** (`pkg/zeroai/service/session-service.go`)
  - 定义 `SessionService` 结构体
  - 实现 `CreateSession()` - 创建会话 (协调 Agent + Store)
  - 实现 `GetSession()` - 获取会话
  - 实现 `ListSessions()` - 列出会话
  - 实现 `DeleteSession()` - 删除会话
  - 实现 `SetWorkDir()` - 设置工作目录
  - **验收**: 单元测试通过

- [ ] **5.2 Message Service** (`pkg/zeroai/service/message-service.go`)
  - 定义 `MessageService` 结构体
  - 实现 `SendMessage()` - 发送消息 (协调 Agent + Store)
  - 实现 `GetMessages()` - 获取消息
  - 实现流式处理
  - **验收**: 单元测试通过

- [ ] **5.3 Agent Service** (`pkg/zeroai/service/agent-service.go`)
  - 定义 `AgentService` 结构体
  - 实现 `GetAgent()` - 获取 Agent (缓存管理)
  - 实现 `ListAgents()` - 列出可用 Agent
  - 实现 `AgentFactory` 实现
  - **验收**: Agent 可以管理

---

### Sprint 6: RPC 层 (Day 8-9)

**负责**: RPC 层组
**工期**: 2 天
**前置条件**: 5.1, 5.2, 5.3 完成

**任务**:

- [ ] **6.1 RPC 类型定义** (`pkg/zeroai/rpc/wshrpc-zeroai.go`)
  - 定义 `ZeroAiSession` 类型
  - 定义 `ZeroAiMessage` 类型
  - 定义请求/响应类型
  - **验收**: TypeScript 生成正确

- [ ] **6.2 WSH Server 实现** (`pkg/zeroai/rpc/wshserver-zeroai.go`)
  - 实现 `ZeroAiCreateSession` RPC
  - 实现 `ZeroAiSendMessage` RPC
  - 实现 `ZeroAiSendStreamMessage` RPC (流式)
  - 实现 `ZeroAiGetSessions` RPC
  - 实现 `ZeroAiDeleteSession` RPC
  - 实现 `ZeroAiSetWorkDir` RPC
  - **验收**: RPC 可调用

- [ ] **6.3 HTTP 处理器** (`pkg/zeroai/rpc/http-handlers.go`)
  - 实现 HTTP SSE 端点
  - 实现与 SSE 集成
  - 实现流式响应
  - **验收**: HTTP 可访问

- [ ] **6.4 事件发布** (`pkg/zeroai/rpc/events.go`)
  - 注册 WPS 事件
  - 实现 Session 更新事件
  - 实现消息事件
  - **验收**: 事件可以订阅

---

### Sprint 7-8: 前端 (Day 8-12, 并行)

**负责**: 前端组
**工期**: 4 天
**前置条件**: 6.1, 6.2 完成

**任务**:

- [ ] **7.1 TypeScript 类型绑定**
  - 生成 gotypes.d.ts
  - 更新 wshclientapi.ts
  - **验收**: 类型正确

- [ ] **7.2 ZeroAI Model** (`frontend/app/zeroai/models/zeroai-model.tsx`)
  - 定义 `ZeroAiModel` 单例
  - 定义 Jotai atoms
  - 实现 createSession()
  - 实现 sendMessage()
  - 实现 setWorkDir()
  - **验收**: 状态管理正确

- [ ] **7.3 API Client** (`frontend/app/zeroai/store/zeroai-api.ts`)
  - 定义 WSH RPC client
  - 实现 SSE 订阅
  - **验收**: API 可调用

- [ ] **7.4 ZeroAI Panel** (`frontend/app/zeroai/components/zeroai-panel.tsx`)
  - 实现主面板容器
  - 集成子组件
  - **验收**: 面板显示正确

- [ ] **7.5 Session List** (`frontend/app/zeroai/components/session-list.tsx`)
  - 实现会话列表
  - 实现分组显示
  - 实现会话切换
  - **验收**: 会话列表正确

- [ ] **7.6 Chat Area** (`frontend/app/zeroai/components/chat-area.tsx`)
  - 实现消息列表
  - 实现流式渲染
  - 实现错误显示
  - **验收**: 消息显示正确

- [ ] **7.7 ZeroAI Input** (`frontend/app/zeroai/components/zeroai-input.tsx`)
  - 实现输入框
  - 实现高度自动调整
  - 实现宽度拖拽调整
  - **验收**: 输入框功能完整

- [ ] **7.8 Status Bar** (`frontend/app/zeroai/components/status-bar.tsx`)
  - 显示 Provider
  - 显示 Model
  - 显示 Thinking Level
  - 显示 WorkDir
  - **验收**: 状态栏正确

- [ ] **7.9 WorkDir Select** (`frontend/app/zeroai/components/workdir-select.tsx`)
  - 实现目录选择
  - 显示当前路径
  - 支持快捷选择
  - **验收**: 目录选择正确

---

### Sprint 9: 集成测试 (Day 12-13)

**负责**: 集成测试组
**工期**: 2 天
**前置条件**: 所有功能完成

**任务**:

- [ ] **9.1 后端集成测试**
  - 测试 ACP 连接 (claude, qwen)
  - 测试会话管理
  - 测试消息发送/接收
  - 测试数据库操作
  - **验收**: 所有测试通过

- [ ] **9.2 RPC 集成测试**
  - 测试 WSH RPC 调用
  - 测试 SSE 流式响应
  - **验收**: RPC 功能正常

- [ ] **9.3 前端集成测试**
  - 测试 UI 交互
  - 测试消息流显示
  - 测试状态更新
  - **验收**: UI 功能正常

- [ ] **9.4 E2E 测试**
  - 使用 claude-code 测试完整流程
  - 使用 qwen 测试 ACP 协议
  - 测试 Session resume
  - **验收**: E2E 流程正常

---

### Sprint 10: 文档和清理 (Day 13)

**负责**: 所有组
**工期**: 1 天
**前置条件**: 测试通过

**任务**:

- [ ] **10.1 API 文档**
  - 编写 RPC API 文档
  - 编写 ACP 协议文档
  - **验收**: 文档完整

- [ ] **10.2 配置文档**
  - 编写配置示例
  - 编写配置说明
  - **验收**: 配置文档完整

- [ ] **10.3 代码清理**
  - 移除调试代码
  - 优化代码质量
  - **验收**: 代码审查通过

---

## 并行开发示例

### Day 2 场景: 协议层 + 存储层 + 前端

| 团队 | 任务 | 状态 |
|------|------|------|
| **协议层 A** | AcpConnection 基础结构 | 进行中 |
| **协议层 B** | JSON-RPC 编解码 | 进行中 |
| **存储层** | Session Store | 进行中 |
| **前端** | TypeScript 类型规划 | 进行中 |

### Day 4 场景: Agent 适配器并行

```bash
# 每个开发者独立开发一个适配器
git checkout -b feature/agent-claude    # 开发者 A
git checkout -b feature/agent-qwen      # 开发者 B
git checkout -b feature/agent-codex     # 开发者 C
git checkout -b feature/agent-opencode  # 开发者 D
```

---

## 依赖关系图

```
acp-types (Day 1)
  ├─ acp-connection (Day 2-3)
  ├─ acp-adapter (Day 2)
  ├─ acp-config (Day 2)
  ├─ db-migrations (Day 1)
  │   ├─ session-store (Day 2)
  │   └─ message-store (Day 2)
  └─ agent-interface (Day 1)
      └─ acp-agent (Day 4-5)
          └─ adapters/* (Day 5-6)

process-manager (Day 3)
  └─ acp-connection 使用

store (Day 2)
  └─ service (Day 6-7)
      └─ rpc (Day 8-9)
          └─ 前端 (Day 8-12)
```

---

## 里程碑

| 里程碑 | 日期 | 内容 |
|--------|------|------|
| **M1: 基础设施** | Day 2 | 类型定义、数据库、进程管理 |
| **M2: 协议层完成** | Day 5 | ACP 连接、适配器、配置 |
| **M3: Agent 完成** | Day 7 | ACP Agent + 各后端适配器 |
| **M4: 后端完成** | Day 9 | Service + RPC |
| **M5: 前端完成** | Day 12 | UI 组件完整 |
| **M6: MVP 完成** | Day 13 | 测试通过 + 文档 |

---

## 文件清单 (Phase 1 MVP)

### 后端文件 (27 个)

```
pkg/zeroai/
├── protocol/
│   ├── acp-types.go          [1.1.1]
│   ├── acp-connection.go     [2.1.1-2.1.9]
│   ├── acp-message.go        [2.1.1]
│   ├── acp-adapter.go        [2.2.1-2.2.5]
│   ├── acp-config.go         [2.3.1]
│   └── acp-detector.go       [2.3.2]
├── agent/
│   ├── agent-interface.go    [1.1.2]
│   └── acp-agent.go          [4.1.1-4.1.6]
├── adapters/
│   ├── claude/adapter.go     [4.2.1]
│   ├── qwen/adapter.go       [4.2.2]
│   ├── codex/adapter.go      [4.2.3]
│   └── opencode/adapter.go   [4.2.4]
├── service/
│   ├── session-service.go    [5.1]
│   ├── message-service.go    [5.2]
│   └── agent-service.go      [5.3]
├── store/
│   ├── store-interface.go    [1.1.3]
│   ├── session-store.go      [1.2.2]
│   ├── message-store.go      [1.2.3]
│   └── db-migrations.go      [1.2.1]
├── process/
│   ├── process-manager.go    [3.1-3.2]
│   └── process-spawner.go    [3.3]
├── rpc/
│   ├── wshrpc-zeroai.go      [6.1]
│   ├── wshserver-zeroai.go   [6.2]
│   ├── http-handlers.go      [6.3]
│   └── events.go            [6.4]
└── types/
    └── types.go             [1.1.4]
```

### 前端文件 (8 个)

```
frontend/app/zeroai/
├── models/
│   └── zeroai-model.tsx     [7.2]
├── store/
│   └── zeroai-api.ts         [7.3]
└── components/
    ├── zeroai-panel.tsx     [7.4]
    ├── session-list.tsx     [7.5]
    ├── chat-area.tsx        [7.6]
    ├── zeroai-input.tsx     [7.7]
    ├── status-bar.tsx       [7.8]
    └── workdir-select.tsx   [7.9]
```

### Schema (1 个)

```
schema/zeroai.json          [1.2.4]
```

---

## 总计

- **任务数量**: ~80 个子任务
- **总工期**: ~13 天
- **并行程度**: 高 (Day 2-9 最多 4 团队并行)
- **文件数量**: ~36 个 (后端 27 + 前端 8 + schema 1)
