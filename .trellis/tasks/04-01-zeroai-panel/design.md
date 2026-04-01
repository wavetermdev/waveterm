# ZeroAI 技术设计 v2.0

> 基于 AIONUi Agent 架构深度分析，优化模块解耦设计，支持并行开发

---

## 架构原则

### 核心原则

1. **协议层与业务层分离** - JSON-RPC 2.0 协议独立实现
2. **连接层与逻辑层分离** - Connection 只管通信，不管业务
3. **适配器模式** - ACP 消息与内部消息的转换独立
4. **接口隔离** - 每层有清晰的公共接口
5. **类型驱动** - 先定义类型，再实现功能

### 参考 AIONUi 架构

```
AIONUi Agent 架构:
├── acp/                    # ACP 核心协议层 (独立)
│   ├── AcpConnection        # JSON-RPC 连接
│   ├── AcpAdapter           # 消息适配器
│   ├── AcpDetector          # CLI 检测器
│   ├── constants            # 后端配置
│   └── modelInfo            # 模型信息
├── codex/                  # Codex 专用实现
│   ├── connection/          # 连接层
│   ├── core/                # 核心逻辑
│   ├── handlers/            # 处理器
│   └── messaging/           # 消息处理
├── gemini/                 # Gemini 专用实现
├── openclaw/               # OpenClaw Gateway
└── nanobot/                # 轻量级实现
```

---

## ZeroAI 架构设计

### 分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  frontend/app/zeroai/                                            │
│  ├── components/           - 可独立开发的 UI 组件               │
│  ├── models/               - Jotai 状态管理                       │
│  └── store/                - API client 和 store                │
└─────────────────────────────────────────────────────────────────┘
                           ↓ WSH RPC
┌─────────────────────────────────────────────────────────────────┐
│                        Service Layer                             │
│  pkg/zeroai/service/                                            │
│  ├── session-service.go    - 会话管理 (独立)                   │
│  ├── message-service.go    - 消息管理 (独立)                   │
│  └── agent-service.go      - Agent 协调 (依赖下层)             │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Layer                               │
│  pkg/zeroai/agent/                                               │
│  ├── agent-interface.go    - Agent 接口定义 (类型层)           │
│  ├── agent-manager.go      - Agent 管理器                       │
│  └── adapters/              - 各 Agent 适配器 (独立可并行)     │
│      ├── claude/       - Claude 适配器                         │
│      ├── qwen/         - Qwen 适配器                           │
│      ├── codex/        - Codex 适配器                          │
│      └── opencode/     - OpenCode 适配器                       │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Protocol Layer                            │
│  pkg/zeroai/protocol/                                            │
│  ├── acp-types.go          - ACP 类型定义 (先定义)             │
│  ├── acp-connection.go     - ACP 连接 (完全独立)              │
│  ├── acp-message.go        - ACP 消息解析 (完全独立)           │
│  ├── acp-adapter.go        - ACP 适配器 (完全独立)            │
│  └── acp-config.go         - ACP 配置 (完全独立)              │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Process Layer                             │
│  pkg/zeroai/process/                                             │
│  ├── process-manager.go    - 进程管理 (独立)                   │
│  └── process-spawner.go    - 进程生成 (依赖 WSH)              │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Storage Layer                             │
│  pkg/zeroai/store/                                               │
│  ├── session-store.go     - 会话存储 (独立)                     │
│  ├── message-store.go     - 消息存储 (独立)                     │
│  └── db-migrations.go     - 迁移脚本 (独立)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 模块解耦设计

### 1. Protocol Layer - 协议层 (完全独立)

**职责**: JSON-RPC 2.0 协议实现，与具体 Agent 无关

**接口定义** (`pkg/zeroai/protocol/acp-types.go`):

```go
// ACP Backend 类型
type AcpBackend string

const (
    AcpBackendClaude    AcpBackend = "claude"
    AcpBackendGemini    AcpBackend = "gemini"
    AcpBackendQwen      AcpBackend = "qwen"
    AcpBackendCodex     AcpBackend = "codex"
    AcpBackendOpenCode  AcpBackend = "opencode"
    AcpBackendCustom    AcpBackend = "custom"
)

// JSON-RPC 2.0 Request
type AcpRequest struct {
    JSONRPC string                 `json:"jsonrpc"`
    ID      int                    `json:"id,omitempty"`
    Method  string                 `json:"method"`
    Params  map[string]interface{} `json:"params,omitempty"`
}

// JSON-RPC 2.0 Response
type AcpResponse struct {
    JSONRPC string      `json:"jsonrpc"`
    ID      int         `json:"id,omitempty"`
    Result  interface{} `json:"result,omitempty"`
    Error   *AcpError   `json:"error,omitempty"`
}

// JSON-RPC 2.0 Notification (无 ID)
type AcpNotification struct {
    JSONRPC string                 `json:"jsonrpc"`
    Method  string                 `json:"method"`
    Params  map[string]interface{} `json:"params,omitempty"`
}

// ACP Session Update
type AcpSessionUpdate struct {
    SessionUpdate   string                           `json:"sessionUpdate"`
    Content         string                           `json:"content,omitempty"`
    Metadata        map[string]interface{}          `json:"metadata,omitempty"`
    ToolCall        *AcpToolCall                     `json:"toolCall,omitempty"`
    Permission      *AcpPermissionRequest            `json:"permission,omitempty"`
}

// ACP Permission Request
type AcpPermissionRequest struct {
    CallID      string      `json:"callId"`
    ToolName    string      `json:"toolName"`
    Description string      `json:"description"`
    Options     []AcpOption `json:"options"`
}

type AcpOption struct {
    ID          string `json:"id"`
    Label       string `json:"label"`
    Description string `json:"description"`
}

// ACP Config Options
type AcpSessionConfigOption struct {
    ID          string      `json:"id"`
    Type        string      `json:"type"`
    Label       string      `json:"label"`
    Value       interface{} `json:"value"`
    Options     []AcpOption `json:"options,omitempty"`
}

// ACP Models
type AcpSessionModels struct {
    DefaultModel string            `json:"defaultModel"`
    Models       []AcpModelInfo    `json:"models"`
}

type AcpModelInfo struct {
    ID   string `json:"id"`
    Name string `json:"name"`
}

// ACP Backend Config
type AcpBackendConfig struct {
    ID              AcpBackend           `json:"id"`
    Name            string               `json:"name"`
    CliCommand      string               `json:"cliCommand"`
    DefaultCliPath  string               `json:"defaultCliPath,omitempty"`
    AuthRequired    bool                 `json:"authRequired"`
    Enabled         bool                 `json:"enabled"`
    SupportsStreaming bool              `json:"supportsStreaming"`
    AcpArgs         []string             `json:"acpArgs"`
    Env             map[string]string    `json:"env,omitempty"`
}

// Session Mode 常量 (参考 AIONUi constants)
const (
    ClaudeYoloSessionMode    = "bypassPermissions"
    QwenYoloSessionMode       = "yolo"
    CodebuddyYoloSessionMode  = "bypassPermissions"
    GooseYoloEnvVar          = "GOOSE_MODE"
    GooseYoloEnvValue        = "auto"
)
```

**连接接口** (`pkg/zeroai/protocol/acp-connection.go`):

```go
// AcpConnection 完全独立，可单独开发和测试
type AcpConnection struct {
    backend       AcpBackend
    config        AcpSessionConfig
    process       *AgentProcess
    stdin         io.WriteCloser
    stdout        io.Reader
    stderr        io.Reader

    // Pending request 管理
    pendingRequests map[int]*PendingRequest
    nextRequestId  int
    requestMu      sync.Mutex

    // 缓存的会话信息
    sessionId      string
    configOptions  []AcpSessionConfigOption
    models         *AcpSessionModels

    // 回调 (通过接口注入，不直接依赖)
    callbacks      *AcpCallbacks

    // 状态
    isInitialized bool
    isConnected   bool
}

type AcpCallbacks struct {
    OnSessionUpdate     func(AcpSessionUpdate)
    OnPermissionRequest func(*AcpPermissionRequest) (string, error)
    OnMessage           func(string, interface{})
    OnError             func(error)
    OnDisconnect        func(*AcpDisconnectInfo)
}

type PendingRequest struct {
    Resolve chan interface{}
    Reject  chan error
    Timeout time.Duration
    Method  string
    Created int64
}

type AcpDisconnectInfo struct {
    Code   int
    Signal string
}

// 公共接口
type Connection interface {
    // 基础操作
    Initialize(ctx context.Context) error
    SendMessage(ctx context.Context, method string, params map[string]interface{}) (interface{}, error)
    SendNotification(method string, params map[string]interface{}) error
    Close() error

    // 会话操作
    NewSession(ctx context.Context, opts AcpSessionOptions) (string, []AcpSessionConfigOption, *AcpSessionModels, error)
    LoadSession(ctx context.Context, sessionId string) error
    SetSessionMode(ctx context.Context, mode string) error
    SetModel(ctx context.Context, model string) error

    // 流式操作
    StreamPrompt(ctx context.Context, prompt string, opts AcpPromptOptions) (<-chan string, error)

    // 状态
    IsConnected() bool
    HasSession() bool
    GetSessionID() string
}

type AcpSessionOptions struct {
    Cwd            string
    ResumeSessionID string
    ForkSession    bool
}

type AcpPromptOptions struct {
    Files           []string
    ModelOverride   string
}

// 工厂函数 (不同后端有不同的连接参数)
type ConnectionFactory func(config AcpSessionConfig, callbacks *AcpCallbacks) Connection

// 后端特定的工厂
func NewClaudeConnection(config AcpSessionConfig, callbacks *AcpCallbacks) Connection
func NewQwenConnection(config AcpSessionConfig, callbacks *AcpCallbacks) Connection
func NewCodexConnection(config AcpSessionConfig, callbacks *AcpCallbacks) Connection
func NewOpenCodeConnection(config AcpSessionConfig, callbacks *AcpCallbacks) Connection
```

**适配器** (`pkg/zeroai/protocol/acp-adapter.go`):

```go
// AcpAdapter 完全独立的纯函数转换
type AcpAdapter struct{}

// 消息转换 (纯函数，无副作用)
func (a *AcpAdapter) ConvertSessionUpdate(update AcpSessionUpdate) []*ZeroAiEvent

func (a *AcpAdapter) ConvertSessionUpdateChunk(update AcpSessionUpdate) *ZeroAiEvent {
    return &ZeroAiEvent{
        Type:    EventContent,
        Content: update.Content,
    }
}

func (a *AcpAdapter) ConvertToolCall(update AcpSessionUpdate) *ZeroAiEvent {
    return &ZeroAiEvent{
        Type: EventToolCall,
        Data:  ZeroAiToolCallData{
            ToolName:    update.ToolCall.ToolName,
            CallID:      update.ToolCall.CallID,
            Description: update.ToolCall.Description,
        },
    }
}

func (a *AcpAdapter) ConvertPermission(update AcpSessionUpdate) *ZeroAiEvent {
    return &ZeroAiEvent{
        Type: EventPermission,
        Data: ZeroAiPermissionData{
            CallID:      update.Permission.CallID,
            ToolName:    update.Permission.ToolName,
            Description: update.Permission.Description,
            Options:     convertAcpOptions(update.Permission.Options),
        },
    }
}

func convertAcpOptions(opts []AcpOption) []PermissionOption {
    result := make([]PermissionOption, len(opts))
    for i, opt := range opts {
        result[i] = PermissionOption{
            ID:          opt.ID,
            Label:       opt.Label,
            Description: opt.Description,
        }
    }
    return result
}
```

### 2. Agent Layer - Agent 层 (接口隔离)

**Agent 接口定义** (`pkg/zeroai/agent/agent-interface.go`):

```go
// Agent 接口 - 所有 Agent 实现必须满足
type Agent interface {
    // 生命周期
    Start(ctx context.Context) error
    Stop() error
    IsRunning() bool

    // 会话管理
    CreateSession(ctx context.Context, opts AgentSessionOptions) (*AgentSession, error)
    LoadSession(ctx context.Context, sessionID string) (*AgentSession, error)
    DeleteSession(sessionID string) error
    ListSessions() ([]*AgentSession, error)

    // 消息处理
    SendMessage(ctx context.Context, sessionID string, message SendMessageInput) (<-chan AgentEvent, error)
    ConfirmPermission(ctx context.Context, sessionID string, callID string, optionID string) error

    // 状态
    GetStatus() AgentStatus
    GetSession(sessionID string) (*AgentSession, error)
}

// AgentSession 表示一个对话会话
type AgentSession struct {
    ID            string
    Backend       string
    WorkDir       string
    Model         string
    Provider      string
    ThinkingLevel string
    CreatedAt     int64
    UpdatedAt     int64
    Metadata      map[string]interface{}
}

type SendMessageInput struct {
    Content string
    Files   []string
    Metadata map[string]interface{}
}

type AgentEvent struct {
    Type    EventType
    Session string
    Data    interface{}
}

type EventType string

const (
    EventContent    EventType = "content"
    EventToolCall   EventType = "tool_call"
    EventPermission EventType = "permission"
    EventError      EventType = "error"
    EventEndTurn    EventType = "end_turn"
)

type AgentStatus struct {
    IsConnected    bool
    HasSession     bool
    IsStreaming    bool
    LastError      error
}

// AgentFactory - Agent 工厂接口
type AgentFactory interface {
    CreateAgent(config AgentConfig) (Agent, error)
    GetSupportedBackends() []AcpBackend
}
```

**ACP Agent 实现** (`pkg/zeroai/agent/acp-agent.go`):

```go
// AcpAgent 使用 AcpConnection 实现 Agent 接口
type AcpAgent struct {
    backend       string
    connection    Connection
    currentSession *AgentSession
    sessionMu     sync.RWMutex
    eventChannels  map[string]chan AgentEvent
}

func NewAcpAgent(config AgentConfig, connFactory ConnectionFactory) (*AcpAgent, error) {
    // 创建 ACP 连接
    callbacks := &AcpCallbacks{
        OnSessionUpdate: func(update AcpSessionUpdate) {
            // 转换为事件并通过通道发送
        },
        OnPermissionRequest: func(req *AcpPermissionRequest) (string, error) {
            // 通过事件请求权限
            return "", nil
        },
        // ...
    }

    conn := connFactory(config.SessionConfig, callbacks)

    return &AcpAgent{
        backend:      string(config.Backend),
        connection:   conn,
        eventChannels: make(map[string]chan AgentEvent),
    }, nil
}

// 实现 Agent 接口
func (a *AcpAgent) Start(ctx context.Context) error {
    return a.connection.Initialize(ctx)
}

func (a *AcpAgent) Stop() error {
    return a.connection.Close()
}

func (a *AcpAgent) CreateSession(ctx context.Context, opts AgentSessionOptions) (*AgentSession, error) {
    sessionId, configOpts, models, err := a.connection.NewSession(ctx, AcpSessionOptions{
        Cwd:            opts.WorkDir,
        ResumeSessionID: opts.ResumeSessionID,
    })
    if err != nil {
        return nil, err
    }

    session := &AgentSession{
        ID:            sessionId,
        Backend:       a.backend,
        WorkDir:       opts.WorkDir,
        Model:         models.DefaultModel,
        CreatedAt:     time.Now().Unix(),
        UpdatedAt:     time.Now().Unix(),
    }

    return session, nil
}

func (a *AcpAgent) SendMessage(ctx context.Context, sessionID string, input SendMessageInput) (<-chan AgentEvent, error) {
    eventChan := make(chan AgentEvent, 100)
    a.sessionMu.Lock()
    a.eventChannels[sessionID] = eventChan
    a.sessionMu.Unlock()

    go func() {
        defer close(eventChan)

        // 流式发送
        contentChan, err := a.connection.StreamPrompt(ctx, input.Content, AcpPromptOptions{
            Files:         input.Files,
            ModelOverride: input.Model,
        })
        if err != nil {
            eventChan <- AgentEvent{Type: EventError, Data: err}
            return
        }

        for content := range contentChan {
            eventChan <- AgentEvent{Type: EventContent, Data: content}
        }
    }()

    return eventChan, nil
}
```

### 3. Process Layer - 进程层 (独立)

**进程管理器** (`pkg/zeroai/process/process-manager.go`):

```go
// ProcessManager 单独负责进程生命周期
// 不依赖 ACP 协议细节
type ProcessManager interface {
    SpawnProcess(ctx context.Context, spec ProcessSpec) (*AgentProcess, error)
    KillProcess(pid int) error
    GetProcessInfo(pid int) (*ProcessInfo, error)
    ListProcesses() ([]*AgentProcess, error)
}

type ProcessSpec struct {
    Command     string
    Args        []string
    Env         map[string]string
    WorkingDir  string
}

type AgentProcess struct {
    Pid      int
    Command  string
    State    ProcessState
    StartedAt int64
}

type ProcessState string

const (
    ProcessStarting ProcessState = "starting"
    ProcessRunning  ProcessState = "running"
    ProcessStopped  ProcessState = "stopped"
    ProcessError    ProcessState = "error"
)

type ProcessInfo struct {
    Pid       int
    Command   string
    State     ProcessState
    WorkingDir string
    Env       map[string]string
}

// WSHProcessManager 使用 WSH ShellProcessController
type WSHProcessManager struct {
    connClient genconn.ShellClient
}

func (m *WSHProcessManager) SpawnProcess(ctx context.Context, spec ProcessSpec) (*AgentProcess, error) {
    cmdSpec := genconn.CommandSpec{
        Cmd: spec.Command,
        Env: spec.Env,
        Cwd: spec.WorkingDir,
    }

    controller, err := m.connClient.MakeProcessController(cmdSpec)
    if err != nil {
        return nil, err
    }

    if err := controller.Start(); err != nil {
        return nil, err
    }

    return &AgentProcess{
        Pid:       controller.Pid(), // 假设有 Pid() 方法
        Command:   spec.Command,
        State:     ProcessRunning,
        StartedAt: time.Now().Unix(),
    }, nil
}

func (m *WSHProcessManager) KillProcess(pid int) error {
    // 通过 WSH 终止进程
    return nil
}
```

### 4. Storage Layer - 存储层 (完全独立)

**存储接口** (`pkg/zeroai/store/store-interface.go`):

```go
// SessionStore 会话存储接口
type SessionStore interface {
    Create(session *ZeroAiSession) error
    Get(sessionID string) (*ZeroAiSession, error)
    Update(session *ZeroAiSession) error
    Delete(sessionID string) error
    List(opts ListOptions) ([]*ZeroAiSession, error)
}

type ListOptions struct {
    Backend  string
    Limit    int
    Offset   int
}

// MessageStore 消息存储接口
type MessageStore interface {
    Add(msg *ZeroAiMessage) error
    GetSessionMessages(sessionID string) ([]*ZeroAiMessage, error)
    Delete(sessionID string) error
}
```

---

## 并行开发映射

### 可独立开发的模块

| 模块 | 路径 | 依赖 | 可并行 |
|------|------|------|--------|
| **类型定义** | protocol/acp-types.go | 无 | ✅ 是 |
| **ACP 连接** | protocol/acp-connection.go | acp-types | ✅ 是 |
| **ACP 适配器** | protocol/acp-adapter.go | acp-types | ✅ 是 |
| **进程管理器** | process/process-manager.go | WSH | ✅ 是 |
| **会话存储** | store/session-store.go | acp-types | ✅ 是 |
| **消息存储** | store/message-store.go | acp-types | ✅ 是 |
| **Claude 适配器** | agent/adapters/claude/ | acp-types | ✅ 是 |
| **Qwen 适配器** | agent/adapters/qwen/ | acp-types | ✅ 是 |
| **Codex 适配器** | agent/adapters/codex/ | acp-types | ✅ 是 |
| **UI 组件** | frontend/app/zeroai/components/* | TypeScript | ✅ 是 |

### 开发依赖顺序

```
Day 1: 类型定义团队
  └─ acp-types.go

Day 2-3: 协议层团队 (并行)
  ├─ acp-connection.go (依赖 acp-types)
  ├─ acp-adapter.go (依赖 acp-types)
  └─ acp-config.go (依赖 acp-types)

Day 2-3: 存储层团队 (并行)
  ├─ session-store.go (依赖 acp-types)
  └─ message-store.go (依赖 acp-types)

Day 3-4: 进程层团队 (依赖 WSH)
  └─ process-manager.go

Day 4-6: Agent 适配器团队 (并行，每组负责一个)
  ├─ adapters/claude/
  ├─ adapters/qwen/
  ├─ adapters/codex/
  └─ adapters/opencode/

Day 5-7: Service 层团队 (依赖上层)
  ├─ session-service.go
  ├─ message-service.go
  └─ agent-service.go

Day 8: RPC 层团队 (依赖 service)
  └─ wshserver-zeroai.go

Day 9-12: 前端团队 (并行 UI 组件)
  ├─ components/zeroai-panel.tsx
  ├─ components/session-list.tsx
  ├─ components/chat-area.tsx
  ├─ components/zeroai-input.tsx
  └─ components/status-bar.tsx
```

---

## 配置设计

### ZeroAI Schema (`schema/zeroai.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$defs": {
    "ZeroAiAgentType": {
      "properties": {
        "display:name": { "type": "string" },
        "display:description": { "type": "string" },
        "backend": {
          "type": "string",
          "enum": ["claude", "qwen", "codex", "opencode", "custom"]
        },
        "cli:command": { "type": "string" },
        "cli:args": {
          "type": "array",
          "items": { "type": "string" }
        },
        "env": {
          "type": "object",
          "additionalProperties": { "type": "string" }
        },
        "provider": { "type": "string" },
        "model": { "type": "string" },
        "thinking_level": {
          "type": "string",
          "enum": ["low", "medium", "high"]
        },
        "yolo_mode": { "type": "boolean" },
        "api:key": { "type": "string" }
      },
      "required": ["display:name", "backend"]
    }
  },
  "type": "object",
  "additionalProperties": { "$ref": "#/$defs/ZeroAiAgentType" }
}
```

### 配置示例

```json
{
  "claude-code": {
    "display:name": "Claude Code",
    "backend": "claude",
    "cli:command": "claude-code",
    "cli:args": ["--stdio"],
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "thinking_level": "high",
    "yolo_mode": false,
    "env": {
      "ANTHROPIC_API_KEY": "${secret:claude-key}"
    }
  },
  "qwen-code": {
    "display:name": "Qwen Code",
    "backend": "qwen",
    "cli:command": "npx @qwen-code/qwen-code",
    "cli:args": ["--acp"],
    "provider": "qwen",
    "model": "qwen-max",
    "thinking_level": "medium",
    "yolo_mode": false
  }
}
```

---

## 错误处理

### 统一错误类型

```go
// ZeroAI 错误类型
type AcpErrorType string

const (
    ErrorConnection    AcpErrorType = "CONNECTION"
    ErrorAuth          AcpErrorType = "AUTH"
    ErrorSession       AcpErrorType = "SESSION"
    ErrorNetwork       AcpErrorType = "NETWORK"
    ErrorTimeout       AcpErrorType = "TIMEOUT"
    ErrorPermission    AcpErrorType = "PERMISSION"
    ErrorUnknown       AcpErrorType = "UNKNOWN"
)

type AcpError struct {
    Type    AcpErrorType
    Code    int
    Message string
    Data    map[string]interface{}
}

func (e *AcpError) Error() string {
    return e.Message
}

func (e *AcpError) IsRetryable() bool {
    return e.Type == ErrorNetwork || e.Type == ErrorTimeout
}
```

---

## 时序图

### 会话创建流程

```
Frontend → Service → Agent → Protocol → Process
    1      2        3        4         5

1: CreateSession(backend, workDir)
2: agent.CreateSession(opts)
3: connection.NewSession(opts)
4: process.SpawnProcess(spec)
5: JSON-RPC session/new
5: JSON-RPC response
4: parse response
3: return session
2: save to store
1: return ZeroAiSession
```

### 消息发送流程

```
Frontend → Service → Agent → Protocol
    1      2        3        4

1: SendMessage(sessionID, content)
2: agent.SendMessage(sessionID, input)
3: connection.StreamPrompt(prompt)
4: JSON-RPC prompt/stream
4: stream responses
3: forward via event channel
3: convert to AgentEvent
2: forward to handler
1: stream events to frontend
```

---

## 数据库设计

### 会话表

```sql
CREATE TABLE IF NOT EXISTS zeroai_sessions (
    session_id TEXT PRIMARY KEY,
    backend TEXT NOT NULL,
    work_dir TEXT NOT NULL,
    model TEXT,
    provider TEXT,
    thinking_level TEXT DEFAULT 'medium',
    yolo_mode INTEGER DEFAULT 0,
    agent_pid INTEGER,
    acp_session_id TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_zeroai_sessions_backend ON zeroai_sessions(backend);
CREATE INDEX IF NOT EXISTS idx_zeroai_sessions_created_at ON zeroai_sessions(created_at DESC);
```

### 消息表

```sql
CREATE TABLE IF NOT EXISTS zeroai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    event_type TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES zeroai_sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zeroai_messages_session_id ON zeroai_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_zeroai_messages_created_at ON zeroai_messages(created_at);
```

---

## 文件组织

```
pkg/zeroai/
├── protocol/              # 协议层 (完全独立)
│   ├── acp-types.go       # 类型定义 (先完成)
│   ├── acp-connection.go  # ACP 连接
│   ├── acp-message.go     # 消息解析
│   ├── acp-adapter.go     # 适配器
│   └── acp-config.go      # 配置
├── agent/                 # Agent 层
│   ├── agent-interface.go # Agent 接口
│   ├── acp-agent.go       # ACP Agent 实现
│   ├── agent-manager.go   # Agent 管理器
│   └── adapters/          # 各 Agent 适配器 (并行)
│       ├── claude/
│       ├── qwen/
│       ├── codex/
│       └── opencode/
├── service/               # 服务层
│   ├── session-service.go
│   ├── message-service.go
│   └── agent-service.go
├── store/                 # 存储层 (独立)
│   ├── store-interface.go # 存储接口
│   ├── session-store.go
│   ├── message-store.go
│   └── db-migrations.go
├── process/               # 进程层 (独立)
│   ├── process-manager.go
│   └── process-spawner.go
└── rpc/                   # RPC 层
    ├── wshrpc-zeroai.go
    wshserver-zeroai.go
    └── http-handlers.go
```

---

## 测试策略

### 单元测试 (可并行)

```go
// protocol/acp-connection_test.go
func TestAcpConnection_Initialize(t *testing.T)
func TestAcpConnection_SendMessage(t *testing.T)
func TestAcpConnection_StreamPrompt(t *testing.T)

// protocol/acp-adapter_test.go
func TestAcpAdapter_ConvertSessionUpdate(t *testing.T)
func TestAcpAdapter_ConvertToolCall(t *testing.T)

// store/session-store_test.go
func TestSessionStore_Create(t *testing.T)
func TestSessionStore_Get(t *testing.T)
```

### 集成测试

```go
// agent/acp-agent-integration_test.go
func TestAcpAgent_CreateSession(t *testing.T)
func TestAcpAgent_SendMessage(t *testing.T)
```
