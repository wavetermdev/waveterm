<p align="center">
  <a href="https://www.waveterm.dev">
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="./assets/wave-dark.png">
		<source media="(prefers-color-scheme: light)" srcset="./assets/wave-light.png">
		<img alt="Wave Terminal Logo" src="./assets/wave-light.png" width="240">
	</picture>
  </a>
  <br/>
</p>

# Wave Terminal

<div align="center">

[English](README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md)

</div>

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm?ref=badge_shield)

> 本文档为社区简体中文翻译版本。最新原文请参阅 [README.md](README.md)。

Wave 是一款开源、集成 AI 的终端应用，支持 macOS、Linux 与 Windows。它可以搭配任何 AI 模型使用——自行提供 OpenAI、Claude 或 Gemini 的 API 密钥，或通过 Ollama 与 LM Studio 运行本地模型，完全无需注册账号。

Wave 同时支持**持久化 SSH 连接**，即使网络中断或应用重启，连接也会自动恢复。你可以使用内置的图形化编辑器直接编辑远程文件，也能在不离开终端的情况下实时预览文件内容。

![WaveTerm Screenshot](./assets/wave-screenshot.webp)

## 主要功能

### 🤖 Wave AI — 上下文感知的终端助手

Wave AI 不只是一个聊天机器人——它能直接读取你的终端输出、分析当前打开的小组件（Widget），还能执行文件操作。当你在调试时，AI 能看到你的错误信息并给出针对性的建议，而不是泛泛的回答。

- **终端上下文感知**：自动读取终端输出与滚动缓冲区（Scrollback），用于调试与分析
- **文件操作**：可读取、写入、编辑文件，配套自动备份机制与用户审核确认
- **CLI 集成**：通过 `wsh ai` 命令，直接在命令行中将输出导入 AI 或附加文件
- **BYOK（自带密钥）**：支持 OpenAI、Claude、Gemini、Azure 等多家提供商的 API 密钥
- **本地模型**：通过 Ollama、LM Studio 及其他 OpenAI 兼容提供商运行本地模型，数据完全不离开你的电脑
- **免费 Beta**：体验优化期间提供免费 AI 额度
- **即将推出**：命令执行功能（需用户授权）

详细说明请参阅 [Wave AI 文档](https://docs.waveterm.dev/waveai) 与 [Wave AI Modes 文档](https://docs.waveterm.dev/waveai-modes)。

### 🔗 持久化 SSH 连接

传统的 SSH 连接在网络不稳时就会断开，你得重新连接、重新切换目录、重新启动程序。Wave 的持久化 SSH 连接彻底解决了这个痛点——连接中断后会自动重新建立，你的会话（Session）完整保留，就像什么都没发生过一样。

- 连接中断、网络切换、Wave 重启后自动重连
- 会话状态完整保留
- 一键即可连接远程服务器，完整访问终端与文件系统

### 🧩 灵活的拖放界面

Wave 的界面由可自由排列的「区块（Block）」组成。你可以将终端、编辑器、网页浏览器、AI 助手像拼图一样排列在同一个画面中，打造最适合你工作流的布局。每个区块都能一键切换全屏，放大查看后立即返回多区块视图。

### ✏️ 内置编辑器

无需额外打开 VS Code 或 Vim——Wave 内置的图形化编辑器支持语法高亮和现代编辑功能，可以直接编辑本地或远程文件。对于需要快速修改配置文件或代码的场景特别方便。

### 📄 丰富的文件预览系统

直接在终端内预览各种格式的远程文件，无需下载：

- Markdown 文档（渲染后呈现）
- 图片、视频
- PDF 文档
- CSV 表格
- 目录结构

### 💬 AI 聊天小组件

支持多种 AI 模型的聊天界面，可同时打开多个 AI 对话窗口：

- OpenAI（GPT 系列）
- Anthropic Claude
- Azure OpenAI
- Perplexity
- Ollama（本地模型）

### 📦 Command Blocks（命令区块）

每个执行的命令都会被独立封装在一个区块中，你可以：

- 清晰区分不同命令的输出结果
- 单独监控长时间运行的命令
- 轻松回顾历史命令的输出

### 🔐 安全的密钥存储

使用操作系统原生的安全存储后端（如 macOS Keychain、Windows Credential Manager）来保存 API 密钥和登录凭证。密钥保存在本地，并可在不同的 SSH 连接间共享使用。

### 🎨 丰富的自定义选项

- 标签页主题配色
- 终端样式调整
- 背景图片设置
- 打造专属于你的工作环境

### 🛠️ `wsh` 命令系统

`wsh` 是 Wave 提供的强大 CLI 工具，让你从命令行管理整个工作区：

- 在不同终端连接间共享数据
- 通过 `wsh file` 在本地与远程 SSH 主机之间无缝复制和同步文件
- 从命令行直接控制 Wave 的界面布局

## 安装

Wave Terminal 支持 macOS、Linux 与 Windows。

各平台的安装说明请参阅[此处](https://docs.waveterm.dev/gettingstarted)。

你也可以直接从官方下载页面安装：[www.waveterm.dev/download](https://www.waveterm.dev/download)。

### 最低系统要求

Wave Terminal 支持以下平台：

- macOS 11 或更新版本（arm64、x64）
- Windows 10 1809 或更新版本（x64）
- 基于 glibc-2.28 或更新版本的 Linux（Debian 10、RHEL 8、Ubuntu 20.04 等）（arm64、x64）

WSH 辅助程序支持以下平台：

- macOS 11 或更新版本（arm64、x64）
- Windows 10 或更新版本（x64）
- Linux Kernel 2.6.32 或更新版本（x64）、Linux Kernel 3.1 或更新版本（arm64）

## 发展路线图

Wave 持续进化中！路线图会随每次发布版本持续更新，请至[此处](./ROADMAP.md)查阅。

想为未来版本提供建议？欢迎加入 [Discord](https://discord.gg/XfvZ334gwU) 社区，或提交 [Feature Request](https://github.com/wavetermdev/waveterm/issues/new/choose)！

## 链接

- 官方网站 &mdash; https://www.waveterm.dev
- 下载页面 &mdash; https://www.waveterm.dev/download
- 技术文档 &mdash; https://docs.waveterm.dev
- X（Twitter）&mdash; https://x.com/wavetermdev
- Discord 社区 &mdash; https://discord.gg/XfvZ334gwU

## 从源码构建

请参阅 [Building Wave Terminal](BUILD.md)。

## 贡献

Wave 使用 GitHub Issues 进行问题追踪。

更多信息请参阅[贡献指南](CONTRIBUTING.md)，其中包含：

- [贡献方式](CONTRIBUTING.md#contributing-to-wave-terminal)
- [贡献规范](CONTRIBUTING.md#before-you-start)

### 赞助 Wave ❤️

如果 Wave Terminal 对你或你的公司有帮助，欢迎赞助开发工作。

赞助有助于支持项目的开发与维护投入的时间。

- https://github.com/sponsors/wavetermdev

## 授权许可

Wave Terminal 采用 Apache-2.0 许可证。依赖信息请参阅[此处](./ACKNOWLEDGEMENTS.md)。
