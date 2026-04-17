always response in '简体中文'.

# Waveterm 仓库工作约定

本文件作用域覆盖整个仓库。

## 默认工作流

1. 先读 `.harness/progress.md`
2. 再读 `.harness/feature-list.json`
3. 再读当前任务包 `.harness/task-packets/TASK-001.md`
4. 只推进一个最小闭环，再更新 `.harness` 工件

## 变更边界

- 优先复用现有 `Electron + frontend + block/view/widget` 机制
- 不做无关重构、不批量重命名、不全仓格式化
- UI/行为改动尽量收敛到当前任务直接相关文件
- 如果涉及登录态、分区、持久化或主进程能力，优先在已有 IPC / preload / view model 链路上扩展

## 验证

- 默认验证命令：`scripts/verify.ps1`
- 如果需要更强验证，再执行当前任务包里列出的额外 smoke 步骤
- 遇到外部账号、环境差异或站点策略限制，要把阻塞写进 `.harness/unknowns.md`

## 汇报要求

每轮实质性修改后，至少同步：

- 修改文件
- 根因或设计判断
- 修复/实现方式
- 验证结果
- 剩余风险
