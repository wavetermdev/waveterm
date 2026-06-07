## Why

Term block 的启动命令目前只能在创建时通过分片 meta 继承，或在 CLI 中用 `wsh run` 设置，运行时无法查看或修改。右键菜单 Advanced 里仅有 `cmd:runonstart` 的 On/Off 开关，不能编辑命令本身。用户需要一个图形界面来随时修改启动命令、环境变量等配置，并能立即重启验证。

## What Changes

- 右键菜单 Advanced 中原 "Run On Startup" 替换为 "Configure Command..."，点击打开编辑器对话框
- 对话框可编辑 Command（多行 textarea）、Run on startup（checkbox）、Clear output on start（checkbox）、Environment variables（key=value textarea）
- "Save & Restart" 按钮一次写入 meta 并重启 block
- 命令执行失败时 block 进入错误状态（header 红色警告），但仍保留右键编辑入口

## Capabilities

### New Capabilities
- `command-config-modal`: 命令配置对话框，支持编辑 command、环境变量、运行/清屏开关
- `save-and-restart`: 保存 meta 配置后销毁并重建 block controller 以应用新配置
- `command-error-state`: 命令执行失败时显示错误状态，header 变色

### Modified Capabilities
<!-- No existing specs are modified by this change -->

## Impact

- `frontend/app/view/term/term-model.ts` — 替换菜单项，添加弹窗逻辑
- `frontend/app/view/term/command-config-modal.tsx` — 新增对话框组件
- `frontend/app/view/term/command-config-modal.scss` — 新增对话框样式
- `pkg/blockcontroller/shellcontroller.go` — 添加命令失败的错误状态处理
- `frontend/` — 可能需要新增错误状态显示组件
