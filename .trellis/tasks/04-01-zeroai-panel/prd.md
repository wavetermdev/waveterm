# ZeroAI - 独立 AI 面板

## Goal

基于 WaveTerm 项目实现一个独立的 ZeroAI AI 面板，实现 Agent CLI 集成、多会话管理、可扩展的 LLM 配置以及 Agent 团队协作能力。

## Requirements

### 功能需求

1. **Agent CLI 支持**
   - 支持 ACP (Agent Communication Protocol) 协议
   - 支持 Direct stdio JSON-RPC 直接接入
   - 参考实现：`/home/zero/work/uptream/ai-dev/mutil-agents-pre/AionUi/src/agent`
   - 支持的 CLI：claude-code, opencode, codex, qwen, gemini 等

2. **多会话列表**
   - 按照每个 CLI/Agent 类型分组
   - 每个会话独立管理
   - 数据库持久化存储

3. **输入框增强**
   - 可自由拉伸高度和宽度
   - 支持多行编辑

4. **状态栏显示**
   - LLM 提供商 (Provider)
   - 模型名称 (Model)
   - 思考度 (Thinking Level)
   - 工作目录 (Working Directory)

5. **LLM 配置入口**
   - 自定义 LLM 配置界面
   - 复用现有的 Provider 后端 (OpenAI, Anthropic, Google, Azure 等)

6. **Agent 团队协作**
   - 复刻 Clawteam 协作能力 (Go 实现，不使用 Python)
   - 利用 WSH (Wave Shell) 替代 tmux 进程管理
   - 支持多 Agent 并发工作

7. **数据持久化**
   - 会话数据保存到数据库
   - 支持自唤醒和不间断工作功能

### 技术需求

1. **架构隔离**
   - ZeroAI 面板与 WaveAI 面面完全独立
   - 避免与上游代码交叉
   - 配置驱动，支持在 waveai.json 中自定义替换

2. **通信协议**
   - ACP 协议支持
   - stdio JSON-RPC 支持
   - WSH RPC 扩展

### 非功能需求

1. **性能**
   - 流式响应支持
   - 低延迟通信
   - 资源占用可控

2. **可扩展性**
   - 模块化设计
   - 易于添加新的 Agent CLI 支持

3. **兼容性**
   - 与现有 WaveTerm 架构兼容
   - 配置系统兼容

## Technical Notes

### 参考代码

- **ACP 实现**: `/home/zero/work/uptream/ai-dev/mutil-agents-pre/AionUi/src/agent/acp/`
  - `AcpConnection.ts` - ACP 连接管理
  - `AcpAdapter.ts` - ACP 适配器
  - `acpTypes.ts` - ACP 类型定义

- **WaveAI 现有架构**:
  - `pkg/aiusechat/usechat.go` - AI 聊天后端
  - `frontend/app/aipanel/` - AI 面板前端
  - `pkg/wshrpc/wshserver/wshserver.go` - RPC 服务器

### ACP 后端支持列表

根据 AionUi 实现，支持的 ACP 后端：
- `claude` - Claude ACP
- `gemini` - Google Gemini ACP
- `qwen` - Qwen Code ACP
- `iflow` - iFlow CLI ACP
- `codex` - OpenAI Codex ACP
- `codebuddy` - Tencent CodeBuddy
- `goose` - Block's Goose CLI
- `opencode` - OpenCode CLI
- `custom` - 用户自定义

### 架构设计思路

```
┌─────────────────────────────────────────────────────────┐
│              ZeroAI Panel (Frontend)                   │
├─────────────────────────────────────────────────────────┤
│  - SessionList (按 Agent 分组)                         │
│  - ChatArea (消息显示)                                  │
│  - ResizableInput (可调整大小输入框)                    │
│  - StatusBar (Provider|Model|Thinking|WorkDir)          │
└─────────────────────────────────────────────────────────┘
                           ↓ WSH RPC
┌─────────────────────────────────────────────────────────┐
│           ZeroAI Backend (Go)                           │
├─────────────────────────────────────────────────────────┤
│  - pkg/zeroai/acp/ (ACP 协议实现)                      │
│  - pkg/zeroai/agent/ (Agent 管理)                       │
│  - pkg/zeroai/team/ (团队协作，复刻 clawteam)          │
│  - pkg/zeroai/store/ (数据库存储)                       │
│  - pkg/zeroai/rpc/ (WSH RPC 接口)                       │
└─────────────────────────────────────────────────────────┘
                         ↓ spawn + monitor
┌─────────────────────────────────────────────────────────┐
│         Agent CLIs (外部进程，通过 WSH 管理)            │
├─────────────────────────────────────────────────────────┤
│  - claude-code --stdio                                 │
│  - opencode --stdio                                     │
│  - qwen --acp                                           │
│  - codex (via codex-acp bridge)                         │
└─────────────────────────────────────────────────────────┘
                         ↓ 复用现有后端
┌─────────────────────────────────────────────────────────┐
│          LLM Providers (OpenAI, Anthropic...)           │
└─────────────────────────────────────────────────────────┘
```

## 实施决策

### 已确认需求

1. **Agent Team 协作: 基础协作**
   - 多个 Agent 可以同时连接
   - 消息可以在 Agent 之间转发
   - 简单的任务分配
   - 不需要完整的 PlanManager/LifecycleManager/MailboxManager

2. **ACP Session Resume: 完整支持**
   - 保存 session ID
   - 支持跨启动的会话恢复
   - 恢复 Agent 的内部状态
   - 保存完整的对话历史

3. **工作目录策略: 按 Session 级别**
   - 每个 Session 可以独立配置工作目录
   - 第一次创建时设置，后续可以修改
   - 支持快捷选择项目目录

### 实施阶段

#### Phase 1: MVP (核心功能)

**目标**: 实现基本的 ACP 连接和聊天功能

**功能**:
- ✅ ACP 连接管理 (基于 AionUi 实现)
- ✅ 单会话聊天
- ✅ 基础 UI (可调整大小输入框 + 消息显示)
- ✅ 状态栏显示 (Provider/Model/Thinking/WorkDir)
- ✅ Session 级别工作目录配置

**技术**:
- `pkg/zeroai/acp/` - ACP 协议实现
- `pkg/zeroai/agent/` - Agent 管理
- `frontend/app/zeroai/` - 基础 UI
- WSH RPC 接口

---

#### Phase 2: 多会话管理

**目标**: 支持多会话列表和持久化

**功能**:
- ✅ 多会话列表 (按 Agent 类型分组)
- ✅ 会话创建/删除/切换
- ✅ 数据库持久化
- ✅ Session resume 支持

**技术**:
- `pkg/zeroai/store/` - 数据库存储层
- 会话管理状态机
- Session ID 恢复逻辑

---

#### Phase 3: Agent 团队协作

**目标**: 基础多 Agent 协作能力

**功能**:
- ✅ 多 Agent 并发连接
- ✅ Agent 间消息转发
- ✅ 简单任务分配机制
- ✅ WSH 进程管理 (替代 tmux)

**技术**:
- `pkg/zeroai/team/` - 团队协调层
- Agent 状态同步
- 消息路由机制

---

#### Phase 4: 自定义 LLM 配置

**目标**: 扩展 LLM Provider 配置

**功能**:
- ✅ 自定义 LLM 配置界面
- ✅ 复用现有 Provider 后端
- ✅ 动态添加新的 Provider
- ✅ 配置验证和测试

**技术**:
- `pkg/zeroai/provider/` - Provider 管理层
- 配置 UI 组件
- Provider 适配器

---

### 待确认问题

无 - 已确认。
