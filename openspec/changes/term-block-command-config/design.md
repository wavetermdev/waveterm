## Context

用户无法在 Term Block 运行时查看或修改启动命令配置。右键菜单 Advanced 仅有 `cmd:runonstart` 的 On/Off 开关，而 `cmd`、`cmd:env`、`cmd:clearonstart` 等只能通过创建时的 fragment meta 继承。配置更改后需手动销毁/重建 controller 才能生效。

已有重启模式 `restartSessionWithDurability`：`SetMetaCommand` → `ControllerDestroyCommand` → `ControllerResyncCommand(forceRestart=true)`。此模式可直接复用。

## Goals / Non-Goals

**Goals:**
- 在右键菜单中提供 "Configure Command..." 入口，打开配置对话框
- 对话框可编辑 command、run-on-start、clear-on-start、环境变量
- 保存时批量写入 meta 并重启 block
- 命令执行失败时 block header 显示错误状态

**Non-Goals:**
- 不修改 Working Directory（可在命令体中使用 `cd`）
- 不添加 Close on Exit 配置（已有独立 meta key，可用 `wsh run` 设置）
- 不持久化 shell 运行时状态（cwd、shell variables）
- 不改动 ShellController.run() 的执行语义

## Decisions

### Decision 1: 复用 ModalModel + modalregistry 模式
- **选择**: 将 CommandConfigModal 注册到 `modalregistry.tsx`，通过 `ModalsModel.pushModal("CommandConfigModal", props)` 打开
- **理由**: 与 `UserInputModal`、`MessageModal` 等现有模态框一致的注册/渲染模式，自动获得 backdrop、Esc 关闭、portal 渲染
- **替代方案**: 在 term-model.tsx 内局部渲染 dialog → 需要管理自己的 open/close 状态，无法复用现有模态管理

### Decision 2: 一次 RPC 调用写入全部 meta
- **选择**: Save 时用一条 `SetMetaCommand` 同时写入 `cmd`、`cmd:runonstart`、`cmd:clearonstart`、`cmd:env` 以及清空 `cmd:lasterror`
- **理由**: 原子性写入，避免中间状态；当前 meta 更新接口已支持批量写入
- **替代方案**: 逐个 key 写入 → 多次 RPC，非原子

### Decision 3: Controller 销毁/重建使用已有模式
- **选择**: 保存 meta 后直接调用 `ControllerDestroyCommand` → `ControllerResyncCommand(forceRestart=true)`
- **理由**: 与 `restartSessionWithDurability` 完全一致，已验证可行
- **替代方案**: 热重载 command → 需大幅改造 shellcontroller，引入状态机复杂度

### Decision 4: 环境变量通过 `cmd:env` meta map 存储
- **选择**: 对话框将 `KEY=VALUE` 文本解析为 `{ key: value }` map，写入 `cmd:env`
- **理由**: 后端 `resolveEnvMap` 已支持读取 `cmd:env` string map；不需要新建文件或数据格式
- **替代方案**: 写入 `blockfile.env` 文件 → 需新增文件读写 RPC，复杂度高

### Decision 5: 错误状态使用 `cmd:lasterror` meta key
- **选择**: backend 在命令 exit code != 0 时将错误信息写入 `cmd:lasterror`；frontend 检查该 key 显示红色 header；Save & Restart 时清空
- **理由**: meta 是可持久化、可观察的键值存储；frontend 已通过 block update 订阅 meta 变更，无需新增状态通道
- **替代方案**: 新增 ProcExitCode 的 WS 事件通知 → 需改造 pubsub 机制

### Decision 6: 对话框内不显示 Working Directory
- **选择**: 对话框仅包含 command、env、run-on-start、clear-on-start 四个字段
- **理由**: wd 可通过 `cd` 在命令中设置；meta 已有 `cmd:cwd` 但使用场景少，不增加 UI 复杂度

## Risks / Trade-offs

- **重启打断当前操作**: Save & Restart 会销毁当前 terminal 进程 → 用户应预期到配置修改会重启
  - 缓解: 对话框内明确标注 "Save & **Restart**"，按钮文案强调重启行为
- **meta 写入并发**: 如果用户在对话框打开期间通过其他方式修改 meta，保存时会覆盖
  - 缓解: 对话框打开时读取当前 meta 作为初始值；此问题在单用户桌面应用中影响极低
- **错误状态的 meta 持久化**: `cmd:lasterror` 写入 meta 后即使 block 关闭/重启也保留
  - 缓解: Save & Restart 时始终清空；交互式 shell（无 cmd）不会写入
