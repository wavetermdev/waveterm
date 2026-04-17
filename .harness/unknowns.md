# Unknowns

## 未解决 / 待验证项

1. 飞书真实登录流程是否会在所有账号态下稳定走完
   - 当前证据：代码已支持本地 App 优先与同分区新窗口
   - 缺口：缺少真实账号登录 smoke

2. 飞书聊天页在 Electron `webview` 中是否存在站点策略变更风险
   - 当前证据：已能以网页容器方式接入，且有网页兜底
   - 缺口：缺少长时间运行与多页面跳转验证

3. 非 Windows 平台的本地 App 自动发现策略
   - 当前证据：协议方式跨平台更通用
   - 缺口：注册表 / 常见路径探测目前主要覆盖 Windows

4. 当前本地开发环境为何缺少可用的 `WCLOUD_ENDPOINT`
   - 当前证据：直接前台启动 Electron 时，日志显示 `invalid wcloud endpoint, WCLOUD_ENDPOINT not set or invalid`，随后 `wavesrv` 退出
   - 缺口：尚未确认这是开发机环境要求，还是仓库当前 dev 启动约束

## 建议补充信息

- 一组可用的飞书测试账号或用户自行登录后的验证反馈
- 目标发布平台范围：仅 Windows，还是包含 macOS / Linux
