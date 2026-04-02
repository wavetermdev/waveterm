# ZeroAI Frontend UI - Sprint 7

## Goal

实现 ZeroAI 面板的完整前端 UI，整合所有已完成的后端功能（Sprint 1-6），提供流畅的用户体验。

## Overview

基于已完成的后端 API（Sprint 1-6），实现前端面板 UI。参考 `frontend/app/aipanel/` 架构，使用 Tailwind v4 样式，遵循 WaveTerm 前端规范。

## Architecture

```
frontend/app/zeroai/
├── components/
│   ├── SessionList.tsx      # 会话列表（按 Agent 分组）
│   ├── ChatArea.tsx         # 聊天区域（消息流）
│   ├── ResizableInput.tsx   # 可调整输入框
│   └── StatusBar.tsx        # 状态栏
├── models/
│   ├── session-model.ts     # Session 状态管理
│   ├── message-model.ts     # Message 状态管理
│   └── ui-model.ts          # UI 状态管理
├── store/
│   └── zeroai-client.ts     # WSH RPC client
└── index.tsx                # ZeroAI 主面板
```

## Requirements

### Phase 1: 基础层（阻塞其他组件）

#### 1.1 Jotai Models - 状态管理

**文件**: `frontend/app/zeroai/models/`

**职责**:

- `session-model.ts`: Session 状态管理
  - `sessionsAtom`: 所有 session 列表
  - `activeSessionAtom`: 当前活跃 session
  - `sessionsByAgentAtom`: 按 Agent 类型分组的 sessions
  - Actions: `createSession`, `deleteSession`, `switchSession`, `resumeSession`

- `message-model.ts`: Message 状态管理
  - `messagesAtom`: Map<sessionId, Message[]>
  - `streamingMessageAtom`: 当前流式消息
  - Actions: `sendMessage`, `appendStreamChunk`, `finalizeStream`

- `ui-model.ts`: UI 状态管理
  - `inputHeightAtom`: 输入框高度
  - `inputWidthAtom`: 输入框宽度
  - `statusBarInfoAtom`: Provider/Model/Thinking/WorkDir

**参考**: `frontend/app/aipanel/models/`

#### 1.2 WSH RPC Client - 后端通信

**文件**: `frontend/app/zeroai/store/zeroai-client.ts`

**职责**:

- 实现 `pkg/zeroai/rpc/wshserver-zeroai.go` 的 TypeScript 客户端
- Session RPC: `CreateSession`, `GetSession`, `ListSessions`, `DeleteSession`
- Message RPC: `SendMessage`, `GetMessages`, `StreamMessage` (SSE)
- Agent RPC: `GetAgent`, `ListAgents`
- 错误处理和重试逻辑

**参考**: `frontend/app/store/wshclientapi.ts`

---

### Phase 2: UI 组件层（可并行开发）

#### 2.1 SessionList 组件

**文件**: `frontend/app/zeroai/components/SessionList.tsx`

**功能**:

- 按 Agent 类型分组显示 sessions
- 点击切换 session
- 右键菜单：创建新 session、删除 session、重命名 session
- 显示 session 状态（活跃、暂停、错误）
- 高亮当前活跃 session

**Props**:

```typescript
interface SessionListProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: (agentId: string) => void;
  onDeleteSession: (id: string) => void;
}
```

**样式**: Tailwind v4，参考 WaveTerm session list

---

#### 2.2 ChatArea 组件

**文件**: `frontend/app/zeroai/components/ChatArea.tsx`

**功能**:

- 显示消息流（user/assistant 消息）
- 支持流式消息（SSE）实时更新
- Markdown 渲染（使用现有的 markdown 组件）
- 代码块高亮
- 自动滚动到底部
- 消息时间戳

**Props**:

```typescript
interface ChatAreaProps {
  messages: Message[];
  streamingMessage: string | null;
}
```

**参考**: `frontend/app/aipanel/components/ChatArea.tsx`

---

#### 2.3 ResizableInput 组件

**文件**: `frontend/app/zeroai/components/ResizableInput.tsx`

**功能**:

- 多行文本输入
- 自由拉伸高度和宽度（拖拽边缘）
- 最小/最大尺寸限制
- 发送按钮（支持 Ctrl+Enter 快捷键）
- 粘贴文件/代码提示

**Props**:

```typescript
interface ResizableInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  minHeight?: number;
  maxHeight?: number;
  minWidth?: number;
  maxWidth?: number;
}
```

**实现细节**:

- 使用 CSS `resize` 属性或拖拽手柄
- 保存尺寸到 Jotai atom（持久化）

---

#### 2.4 StatusBar 组件

**文件**: `frontend/app/zeroai/components/StatusBar.tsx`

**功能**:

- 显示 Provider（LLM 提供商）
- 显示 Model（模型名称）
- 显示 Thinking Level（思考度）
- 显示 WorkDir（工作目录）
- 点击 WorkDir 可更改目录

**Props**:

```typescript
interface StatusBarProps {
  agentInfo: {
    provider: string;
    model: string;
    thinkingLevel: string;
    workDir: string;
  };
  onChangeWorkDir: () => void;
}
```

**样式**: 紧凑状态栏，使用图标和文字

---

### Phase 3: 集成层（依赖 Phase 1 & 2）

#### 3.1 ZeroAI 主面板

**文件**: `frontend/app/zeroai/index.tsx`

**功能**:

- 整合所有组件
- 布局：SessionList (左) + ChatArea (中) + Input (底) + StatusBar (顶)
- 响应式布局
- 初始化逻辑（加载 sessions，恢复活跃 session）
- 错误边界处理

**组件结构**:

```tsx
<ZeroAIPanel>
  <StatusBar />
  <SplitPane>
    <SessionList />
    <ChatArea />
  </SplitPane>
  <ResizableInput />
</ZeroAIPanel>
```

**参考**: `frontend/app/aipanel/index.tsx`

---

#### 3.2 路由集成

**文件**: `frontend/app/blockTypes.ts` 或相关路由文件

**功能**:

- 注册 ZeroAI view type
- 添加到主菜单
- 配置 view 权限和默认设置

---

## Acceptance Criteria

- [ ] **Phase 1.1**: Jotai Models 完成，所有 atoms 和 actions 可用
- [ ] **Phase 1.2**: WSH RPC Client 完成，所有 API 调用正常
- [ ] **Phase 2.1**: SessionList 显示、切换、创建、删除正常
- [ ] **Phase 2.2**: ChatArea 显示消息、流式更新正常
- [ ] **Phase 2.3**: ResizableInput 可调整大小、发送消息正常
- [ ] **Phase 2.4**: StatusBar 显示所有信息正常
- [ ] **Phase 3.1**: ZeroAI 主面板整合所有组件正常
- [ ] **Phase 3.2**: 路由集成，可从菜单打开 ZeroAI 面板
- [ ] **类型检查**: `task check:ts` 通过
- [ ] **样式**: 使用 Tailwind v4，符合 WaveTerm 设计规范

---

## Technical Notes

### 依赖关系

```
Phase 1 (基础层)
  ├─ 1.1 Jotai Models ────────┐
  └─ 1.2 WSH RPC Client ──────┤
                              │
                              ↓
Phase 2 (UI 组件层) ───────────┤
  ├─ 2.1 SessionList ─────────┤
  ├─ 2.2 ChatArea ────────────┤（依赖 Phase 1）
  ├─ 2.3 ResizableInput ──────┤
  └─ 2.4 StatusBar ───────────┤
                              │
                              ↓
Phase 3 (集成层) ──────────────┘
  ├─ 3.1 ZeroAI 主面板
  └─ 3.2 路由集成
```

### 并行开发策略

**Team 1: 基础层** (优先级最高，阻塞其他团队)

- 1.1 Jotai Models
- 1.2 WSH RPC Client

**Team 2: UI 组件组 A** (等待 Team 1 完成)

- 2.1 SessionList
- 2.4 StatusBar

**Team 3: UI 组件组 B** (等待 Team 1 完成)

- 2.2 ChatArea
- 2.3 ResizableInput

**Team 4: 集成层** (等待 Team 2 & 3 完成)

- 3.1 ZeroAI 主面板
- 3.2 路由集成

### 后端 API 参考

**SessionService** (`pkg/zeroai/service/session-service.go`):

- `CreateSession(agentId, workDir) -> Session`
- `GetSession(sessionId) -> Session`
- `ListSessions(agentId) -> []Session`
- `DeleteSession(sessionId) -> error`
- `ResumeSession(sessionId) -> error`

**MessageService** (`pkg/zeroai/service/message-service.go`):

- `SendMessage(sessionId, content) -> Message`
- `GetMessages(sessionId, limit) -> []Message`
- `StreamMessage(sessionId, content) -> SSE stream`

**AgentService** (`pkg/zeroai/service/agent-service.go`):

- `GetAgent(agentId) -> Agent`
- `ListAgents() -> []Agent`

### 参考 WaveAI 架构

- Models: `frontend/app/aipanel/models/`
- Components: `frontend/app/aipanel/components/`
- RPC Client: `frontend/app/store/wshclientapi.ts`
- Main Panel: `frontend/app/aipanel/index.tsx`

---

## Out of Scope

- Agent 团队协作 UI（Sprint 8）
- 自定义 LLM 配置 UI（Sprint 9）
- 高级功能（消息搜索、导出等）
- 性能优化（虚拟滚动、消息分页）
- 单元测试（可后续添加）

---

## Tasks Breakdown

此 PRD 将分解为以下 ClawTeam 团队：

| Team                            | 任务                                | 依赖             |
| ------------------------------- | ----------------------------------- | ---------------- |
| **zeroai-frontend-base**        | Phase 1: Models + RPC Client        | 无（优先级最高） |
| **zeroai-frontend-ui-a**        | Phase 2A: SessionList + StatusBar   | Phase 1          |
| **zeroai-frontend-ui-b**        | Phase 2B: ChatArea + ResizableInput | Phase 1          |
| **zeroai-frontend-integration** | Phase 3: 主面板 + 路由              | Phase 2A + 2B    |
