# ZeroAI 项目开发索引

> ZeroAI - 独立 AI 面板，Agent CLI 集成与多会话管理

---

## 项目概述

基于 WaveTerm 项目实现一个独立的 ZeroAI AI 面板，实现 Agent CLI 集成、多会话管理、可扩展的 LLM 配置以及 Agent 团队协作能力。

**核心目标**:

1. 支持 ACP (Agent Communication Protocol) 协议
2. 支持多种 Agent CLI (claude-code, opencode, codex, qwen, gemini)
3. 多会话管理 (按 Agent 类型分组)
4. 可调整大小的输入框
5. LLM 配置管理 (复用现有 Provider 后端)
6. Agent 团队协作 (Go 实现)
7. 数据库持久化

---

## 文档导航

### 核心文档

| 文档                         | 描述          | 状态      |
| ---------------------------- | ------------- | --------- |
| **[prd.md](./prd.md)**       | 产品需求文档  | ✅ 已完成 |
| **[design.md](./design.md)** | 技术设计 v2.0 | ✅ 已完成 |
| **[tasks.md](./tasks.md)**   | 任务分解 v2.0 | ✅ 已完成 |

### 阅读顺序

1. **首先阅读**: `prd.md` - 了解需求和功能范围
2. **然后阅读**: `design.md` - 理解架构和技术方案
3. **最终参考**: `tasks.md` - 获取详细任务列表

---

## 快速开始

### 开发环境初始化

```bash
# 进入项目目录
cd /home/zero/zero/cliterm

# 启动开发服务器
task dev
```

### 数据库迁移

```bash
# ZeroAI 会自动创建数据库表
# 首次启动时会执行 db-migrations.go 中的迁移
```

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  frontend/app/zeroai/                                            │
│  ├── components/ - UI 组件                                       │
│  ├── models/ - Jotai 状态管理                                   │
│  └── store/ - API client                                         │
└─────────────────────────────────────────────────────────────────┘
                           ↓ WSH RPC
┌─────────────────────────────────────────────────────────────────┐
│                        Service Layer                             │
│  pkg/zeroai/service/                                            │
│  ├── session-service.go                                          │
│  ├── message-service.go                                          │
│  └── agent-service.go                                            │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Layer                               │
│  pkg/zeroai/agent/                                               │
│  ├── agent-interface.go  (接口定义)                             │
│  ├── acp-agent.go         (ACP Agent 实现)                       │
│  └── adapters/           (各 Agent 适配器)                       │
│      ├── claude/                                                   │
│      ├── qwen/                                                     │
│      ├── codex/                                                    │
│      └── opencode/                                                 │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Protocol Layer                            │
│  pkg/zeroai/protocol/                                            │
│  ├── acp-types.go         (类型定义 - 优先)                     │
│  ├── acp-connection.go    (ACP 连接 - 完全独立)                 │
│  ├── acp-adapter.go       (ACP 适配器 - 完全独立)               │
│  ├── acp-message.go       (JSON-RPC 编解码)                     │
│  └── acp-config.go        (后端配置 - 完全独立)                 │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Process Layer                             │
│  pkg/zeroai/process/                                             │
│  ├── process-manager.go  (完全独立)                             │
│  └── process-spawner.go  (完全独立)                             │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Storage Layer                             │
│  pkg/zeroai/store/                                               │
│  ├── store-interface.go  (接口定义)                             │
│  ├── session-store.go     (会话存储 - 完全独立)                 │
│  ├── message-store.go     (消息存储 - 完全独立)                 │
│  └── db-migrations.go     (迁移脚本 - 完全独立)                 │
└─────────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Agent CLI Processes (外部)                       │
│  - claude-code --stdio                                          │
│  - opencode --stdio                                             │
│  - qwen --acp                                                   │
│  - codex (via codex-acp)                                        │
└─────────────────────────────────────────────────────────────────┘
                           ↓ 复用现有
┌─────────────────────────────────────────────────────────────────┐
│          LLM Providers (pkg/waveai/*backend.go)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 模块解耦矩阵

| 模块                | 依赖               | 解耦程度 | 可独立开发 |
| ------------------- | ------------------ | -------- | ---------- |
| **acp-types**       | 无                 | 🔴 高    | ✅ 是      |
| **acp-connection**  | acp-types, process | 🟡 中    | ✅ 是      |
| **acp-adapter**     | acp-types          | 🔴 高    | ✅ 是      |
| **acp-config**      | acp-types          | 🔴 高    | ✅ 是      |
| **session-store**   | acp-types          | 🔴 高    | ✅ 是      |
| **message-store**   | acp-types          | 🔴 高    | ✅ 是      |
| **process-manager** | WSH                | 🟡 中    | ✅ 是      |
| **acp-agent**       | protocol + store   | 🟢 低    | ❌ 否      |
| **claude 适配器**   | acp-types          | 🔴 高    | ✅ 是      |
| **qwen 适配器**     | acp-types          | 🔴 高    | ✅ 是      |
| **codex 适配器**    | acp-types          | 🔴 高    | ✅ 是      |
| **opencode 适配器** | acp-types          | 🔴 高    | ✅ 是      |

---

## 并行开发能力

### 可完全并行的模块

| 模块                | 开发者 | Day |
| ------------------- | ------ | --- |
| **acp-types**       | A      | 1   |
| **session-store**   | B      | 1   |
| **message-store**   | B      | 1   |
| **acp-adapter**     | A      | 2   |
| **acp-config**      | A      | 2   |
| **process-manager** | C      | 3   |
| **claude 适配器**   | D      | 6   |
| **qwen 适配器**     | E      | 6   |
| **codex 适配器**    | F      | 6   |
| **opencode 适配器** | G      | 7   |

### 开发时间线

```
Day 1:       [类型定义组] → acp-types, agent-interface, store-interface
Day 1-2:     [存储层组]   → session-store, message-store, db-migrations
Day 2-3:     [协议层组]   → acp-connection, acp-adapter, acp-config
Day 3:       [进程层组]   → process-manager, process-spawner
Day 4-5:     [Agent 组]   → acp-agent 实现
Day 6:       [各适配器组] → claude (并行) qwen codex opencode
Day 6-7:     [服务层组]   → session-service, message-service, agent-service
Day 8-9:     [RPC 组]     → wshserver-zeroai, http-handlers
Day 10-13:   [前端组]     → UI 组件
Day 12-13:   [测试组]     → 集成测试
```

---

## 配置示例

### 启用 ZeroAI

在 `schema/settings.json` 中添加：

```json
{
  "zeroai:enabled": true,
  "zeroai:default": "claude-code"
}
```

### Agent 配置 (schema/zeroai.json)

```json
{
  "claude-code": {
    "display:name": "Claude Code",
    "backend": "claude",
    "cli:command": "claude-code",
    "cli:args": ["--stdio"],
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "thinking_level": "high"
  },
  "qwen-code": {
    "display:name": "Qwen Code",
    "backend": "qwen",
    "cli:command": "npx @qwen-code/qwen-code",
    "cli:args": ["--acp"],
    "provider": "qwen",
    "model": "qwen-max",
    "thinking_level": "medium"
  }
}
```

---

## 关键技术决策

| 决策            | 选择              |
| --------------- | ----------------- |
| Agent Team 协作 | 基础协作 (简化版) |
| Session Resume  | 完整支持          |
| 工作目录        | 按 Session 级别   |
| 实施策略        | 分阶段 MVP 先行   |
| 架构参考        | AIONUi Agent      |

---

## 参考

- **AIONUi 参考**: `/home/zero/work/uptream/ai-dev/mutil-agents-pre/AionUi/src/agent`
- **WaveAI 现有架构**: `pkg/aiusechat/`, `frontend/app/aipanel/`
- **WSH RPC**: `pkg/wshrpc/`

---

## 实施计划

### Phase 1: MVP (13 天)

- ✅ 基础设施: 类型定义、数据库、进程管理
- ✅ 协议层: ACP 连接、适配器、配置
- ✅ Agent 层: Agent 实现、后端适配器
- ✅ 服务层: Session/Message/Agent 服务
- ✅ RPC 层: WSH 接口
- ✅ 前端: UI 组件
- ✅ 测试: 集成测试

### Phase 2: 多会话管理 ✅ 已完成 (commit: 00ee731e)

- ✅ UI 增强 (SessionList)
- ✅ 会话切换
- ✅ 会话恢复

### Phase 3: Agent 团队协作 ✅ 已完成 (commit: a562f0b2)

- ✅ 多 Agent 并发
- ✅ 消息路由
- ✅ 任务分配

### Phase 4: 自定义 LLM 配置 ✅ 已完成 (commit: 64e0b9d9)

- ✅ Provider CRUD 后端 (list/save/delete/test)
- ✅ 4 个新 WSH RPC 命令
- ✅ 自定义 Backend 注册到 ACP 系统
- ✅ 动态 Backend 查找 (不再硬编码)
- ✅ Provider 管理 UI (添加/编辑/删除/测试)
- ✅ Jotai 状态管理 (provider-model.ts)

### Phase 5: 下一步 (待规划)

- 🔲 配置文件生成 (`task generate` + TS 绑定更新)
- 🔲 Provider 设置页面入口集成到主 UI
- 🔲 集成测试补充

---

## 联系

- **项目**: ZeroAI
- **状态**: Active
- **最后更新**: 2026-04-03
