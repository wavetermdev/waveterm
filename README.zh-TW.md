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

[English](README.md) | [한국어](README.ko.md) | [繁體中文](README.zh-TW.md)

</div>

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm?ref=badge_shield)

> 本文件為社群繁體中文翻譯版本。最新原文請參閱 [README.md](README.md)。

Wave 是一款開源、整合 AI 的終端機應用程式，支援 macOS、Linux 與 Windows。它可以搭配任何 AI 模型使用——自行提供 OpenAI、Claude 或 Gemini 的 API 金鑰，或透過 Ollama 與 LM Studio 執行本地模型，完全不需要註冊帳號。

Wave 同時支援**持久化 SSH 連線**，即使網路中斷或應用程式重新啟動，連線也會自動恢復。你可以使用內建的圖形化編輯器直接編輯遠端檔案，也能在不離開終端機的情況下即時預覽檔案內容。

![WaveTerm Screenshot](./assets/wave-screenshot.webp)

## 主要功能

### 🤖 Wave AI — 情境感知終端機助手

Wave AI 不只是一個聊天機器人——它能直接讀取你的終端機輸出、分析目前開啟的小工具（Widget），還能執行檔案操作。當你在 Debug 時，AI 能看到你的錯誤訊息並給予針對性的建議，而不是泛泛的回答。

- **終端機情境感知**：自動讀取終端機輸出與捲動緩衝區（Scrollback），用於除錯與分析
- **檔案操作**：可讀取、寫入、編輯檔案，搭配自動備份機制與使用者審核確認
- **CLI 整合**：透過 `wsh ai` 命令，直接在命令列中將輸出導入 AI 或附加檔案
- **BYOK（自帶金鑰）**：支援 OpenAI、Claude、Gemini、Azure 等多家供應商的 API 金鑰
- **本地模型**：透過 Ollama、LM Studio 及其他 OpenAI 相容供應商執行本地模型，資料完全不離開你的電腦
- **免費 Beta**：體驗優化期間提供免費 AI 額度
- **即將推出**：命令執行功能（需使用者核准）

詳細說明請參閱 [Wave AI 文件](https://docs.waveterm.dev/waveai) 與 [Wave AI Modes 文件](https://docs.waveterm.dev/waveai-modes)。

### 🔗 持久化 SSH 連線

傳統的 SSH 連線在網路不穩時就會斷開，你得重新連線、重新切換目錄、重新啟動程式。Wave 的持久化 SSH 連線徹底解決了這個痛點——連線中斷後會自動重新建立，你的工作階段（Session）完整保留，就像什麼都沒發生過一樣。

- 連線中斷、網路切換、Wave 重啟後自動重新連線
- 工作階段狀態完整保留
- 一鍵即可連線遠端伺服器，完整存取終端機與檔案系統

### 🧩 彈性拖放介面

Wave 的介面由可自由排列的「區塊（Block）」組成。你可以將終端機、編輯器、網頁瀏覽器、AI 助手像拼圖一樣排列在同一個畫面中，打造最適合你工作流程的佈局。每個區塊都能一鍵切換全螢幕，放大查看後立即回到多區塊視圖。

### ✏️ 內建編輯器

不需要額外開啟 VS Code 或 Vim——Wave 內建的圖形化編輯器支援語法高亮與現代編輯功能，可以直接編輯本地或遠端檔案。對於需要快速修改設定檔或程式碼的場景特別方便。

### 📄 豐富的檔案預覽系統

直接在終端機內預覽各種格式的遠端檔案，無需下載：

- Markdown 文件（渲染後呈現）
- 圖片、影片
- PDF 文件
- CSV 試算表
- 目錄結構

### 💬 AI 聊天小工具

支援多種 AI 模型的聊天介面，可同時開啟多個 AI 對話視窗：

- OpenAI（GPT 系列）
- Anthropic Claude
- Azure OpenAI
- Perplexity
- Ollama（本地模型）

### 📦 Command Blocks（命令區塊）

每個執行的命令都會被獨立封裝在一個區塊中，你可以：

- 清楚分隔不同命令的輸出結果
- 個別監控長時間執行的命令
- 輕鬆回顧歷史命令的輸出

### 🔐 安全的密鑰儲存

使用作業系統原生的安全儲存後端（如 macOS Keychain、Windows Credential Manager）來保存 API 金鑰和登入憑證。密鑰儲存在本地，並可在不同的 SSH 連線間共享使用。

### 🎨 豐富的自訂選項

- 分頁主題配色
- 終端機樣式調整
- 背景圖片設定
- 打造專屬於你的工作環境

### 🛠️ `wsh` 命令系統

`wsh` 是 Wave 提供的強大 CLI 工具，讓你從命令列管理整個工作空間：

- 在不同終端機連線間共享資料
- 透過 `wsh file` 在本地與遠端 SSH 主機之間無縫複製和同步檔案
- 從命令列直接控制 Wave 的介面佈局

## 安裝

Wave Terminal 支援 macOS、Linux 與 Windows。

各平台的安裝說明請參閱[此處](https://docs.waveterm.dev/gettingstarted)。

你也可以直接從官方下載頁面安裝：[www.waveterm.dev/download](https://www.waveterm.dev/download)。

### 最低系統需求

Wave Terminal 支援以下平台：

- macOS 11 或更新版本（arm64、x64）
- Windows 10 1809 或更新版本（x64）
- 基於 glibc-2.28 或更新版本的 Linux（Debian 10、RHEL 8、Ubuntu 20.04 等）（arm64、x64）

WSH 輔助程式支援以下平台：

- macOS 11 或更新版本（arm64、x64）
- Windows 10 或更新版本（x64）
- Linux Kernel 2.6.32 或更新版本（x64）、Linux Kernel 3.1 或更新版本（arm64）

## 發展藍圖

Wave 持續進化中！發展藍圖會隨每次發行版本持續更新，請至[此處](./ROADMAP.md)查閱。

想為未來版本提供建議？歡迎加入 [Discord](https://discord.gg/XfvZ334gwU) 社群，或提交 [Feature Request](https://github.com/wavetermdev/waveterm/issues/new/choose)！

## 連結

- 官方網站 &mdash; https://www.waveterm.dev
- 下載頁面 &mdash; https://www.waveterm.dev/download
- 技術文件 &mdash; https://docs.waveterm.dev
- X（Twitter）&mdash; https://x.com/wavetermdev
- Discord 社群 &mdash; https://discord.gg/XfvZ334gwU

## 從原始碼建置

請參閱 [Building Wave Terminal](BUILD.md)。

## 貢獻

Wave 使用 GitHub Issues 進行問題追蹤。

更多資訊請參閱[貢獻指南](CONTRIBUTING.md)，其中包含：

- [貢獻方式](CONTRIBUTING.md#contributing-to-wave-terminal)
- [貢獻規範](CONTRIBUTING.md#before-you-start)

### 贊助 Wave ❤️

如果 Wave Terminal 對你或你的公司有幫助，歡迎贊助開發工作。

贊助有助於支持專案的建置與維護所投入的時間。

- https://github.com/sponsors/wavetermdev

## 授權條款

Wave Terminal 採用 Apache-2.0 授權條款。相依性資訊請參閱[此處](./ACKNOWLEDGEMENTS.md)。
