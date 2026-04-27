# waveattach 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一个独立 CLI 工具 `waveattach`，从外部终端 attach 到 Wave Terminal 中正在运行的 term block，实现双向终端 I/O。

**Architecture:** 通过直读 Wave SQLite 数据库（WAL 模式，read-only）获取 Ed25519 JWT 私钥，自签 JWT 后通过 Unix domain socket 连接到 wavesrv。输出采用「先订阅 WPS `blockfile` 事件 → 读历史快照 → 用 file offset 去重 → 进入稳态」的双管齐下策略避免漏字节。输入在 raw mode 下逐字节读取，含 `Ctrl+A D` detach 前缀键状态机，通过 `ControllerInputCommand` 转发。

**Tech Stack:** Go, sqlx + go-sqlite3, golang.org/x/term（raw mode），Wave 现有 `pkg/wshrpc`、`pkg/wshutil`、`pkg/wavejwt`、`pkg/wps` 包。

**设计文档：** `aiprompts/waveattach-design.md`

---

## 文件结构

| 路径 | 职责 |
|------|------|
| `pkg/waveattach/auth.go` | 数据目录定位、DB 直读 JWT 私钥、JWT 签发、socket 连接与认证 |
| `pkg/waveattach/auth_test.go` | 数据目录解析逻辑单元测试 |
| `pkg/waveattach/output.go` | snapshot 读取 + WPS `blockfile` 事件订阅 + offset 去重 |
| `pkg/waveattach/output_test.go` | offset 去重逻辑单元测试 |
| `pkg/waveattach/selector.go` | block 列表获取、过滤、交互式选择 UI |
| `pkg/waveattach/attach.go` | 终端 raw mode、Ctrl+A D 状态机、SIGWINCH、goroutine 编排 |
| `pkg/waveattach/attach_test.go` | Ctrl+A D 前缀键状态机单元测试 |
| `cmd/waveattach/main-waveattach.go` | CLI 入口、参数解析、顶层流程编排 |

---

## Task 1：pkg/waveattach/auth.go — 认证与连接

**Files:**
- Create: `pkg/waveattach/auth.go`
- Create: `pkg/waveattach/auth_test.go`

**Responsibility:** 定位数据目录 → 读 SQLite 取 JWT 私钥 → 生成 JWT → 建立 socket 连接 → 调用 AuthenticateCommand。

- [ ] **Step 1: 写数据目录解析的失败测试**

创建 `pkg/waveattach/auth_test.go`：

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveDataDir_EnvOverride(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("WAVETERM_DATA_HOME", tmp)
	got, err := ResolveDataDir()
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != tmp {
		t.Errorf("want %q, got %q", tmp, got)
	}
}

func TestResolveDataDir_FallbackProd(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("WAVETERM_DATA_HOME", "")
	prod := filepath.Join(home, ".waveterm")
	if err := os.MkdirAll(prod, 0700); err != nil {
		t.Fatal(err)
	}
	got, err := ResolveDataDir()
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != prod {
		t.Errorf("want %q, got %q", prod, got)
	}
}

func TestResolveDataDir_FallbackDev(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("WAVETERM_DATA_HOME", "")
	dev := filepath.Join(home, ".waveterm-dev")
	if err := os.MkdirAll(dev, 0700); err != nil {
		t.Fatal(err)
	}
	got, err := ResolveDataDir()
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != dev {
		t.Errorf("want %q, got %q", dev, got)
	}
}

func TestResolveDataDir_NoneFound(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("WAVETERM_DATA_HOME", "")
	if _, err := ResolveDataDir(); err == nil {
		t.Fatal("expected error when no data dir exists")
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

```
go test ./pkg/waveattach/...
```
预期：编译失败（`ResolveDataDir` 未定义）。

- [ ] **Step 3: 实现 auth.go**

创建 `pkg/waveattach/auth.go`：

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	dbSubdir       = "db"
	dbFileName     = "waveterm.db"
	socketFileName = "wave.sock"
)

func ResolveDataDir() (string, error) {
	if v := os.Getenv("WAVETERM_DATA_HOME"); v != "" {
		return v, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home dir: %w", err)
	}
	for _, name := range []string{".waveterm", ".waveterm-dev"} {
		candidate := filepath.Join(home, name)
		if st, err := os.Stat(candidate); err == nil && st.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("Wave data directory not found (tried $WAVETERM_DATA_HOME, ~/.waveterm, ~/.waveterm-dev). Is Wave running?")
}

func loadJwtPrivateKey(dataDir string) (ed25519.PrivateKey, error) {
	dbPath := filepath.Join(dataDir, dbSubdir, dbFileName)
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("Wave database not found at %s: %w", dbPath, err)
	}
	dsn := fmt.Sprintf("file:%s?mode=ro&_journal_mode=WAL&_busy_timeout=5000", dbPath)
	db, err := sqlx.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening wave db: %w", err)
	}
	defer db.Close()

	var rawJSON string
	if err := db.Get(&rawJSON, "SELECT data FROM db_mainserver LIMIT 1"); err != nil {
		return nil, fmt.Errorf("querying db_mainserver (Wave schema may have changed): %w", err)
	}
	var ms struct {
		JwtPrivateKey string `json:"jwtprivatekey"`
	}
	if err := json.Unmarshal([]byte(rawJSON), &ms); err != nil {
		return nil, fmt.Errorf("parsing mainserver JSON: %w", err)
	}
	if ms.JwtPrivateKey == "" {
		return nil, fmt.Errorf("jwtprivatekey is empty in db_mainserver")
	}
	keyBytes, err := base64.StdEncoding.DecodeString(ms.JwtPrivateKey)
	if err != nil {
		return nil, fmt.Errorf("base64 decoding jwt private key: %w", err)
	}
	if len(keyBytes) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("jwt private key has wrong length: got %d, want %d", len(keyBytes), ed25519.PrivateKeySize)
	}
	return ed25519.PrivateKey(keyBytes), nil
}

// Connect opens an authenticated wshrpc client to the running Wave daemon.
// Returns the rpc client and the route id assigned to this client by the server.
func Connect() (*wshutil.WshRpc, string, error) {
	dataDir, err := ResolveDataDir()
	if err != nil {
		return nil, "", err
	}
	sockPath := filepath.Join(dataDir, socketFileName)
	if _, err := os.Stat(sockPath); err != nil {
		return nil, "", fmt.Errorf("Wave socket not found at %s: %w", sockPath, err)
	}

	privKey, err := loadJwtPrivateKey(dataDir)
	if err != nil {
		return nil, "", err
	}
	if err := wavejwt.SetPrivateKey(privKey); err != nil {
		return nil, "", fmt.Errorf("setting jwt private key: %w", err)
	}

	routeId := "waveattach-" + uuid.NewString()
	rpcCtx := wshrpc.RpcContext{
		SockName:  sockPath,
		RouteId:   routeId,
		ProcRoute: false,
	}
	jwtToken, err := wshutil.MakeClientJWTToken(rpcCtx)
	if err != nil {
		return nil, "", fmt.Errorf("creating jwt: %w", err)
	}
	rpcClient, err := wshutil.SetupDomainSocketRpcClient(sockPath, nil, "waveattach")
	if err != nil {
		return nil, "", fmt.Errorf("connecting to %s: %w", sockPath, err)
	}
	authData := wshrpc.CommandAuthenticateData{Token: jwtToken}
	if _, err := wshclient.AuthenticateCommand(rpcClient, authData, nil); err != nil {
		return nil, "", fmt.Errorf("authenticating: %w", err)
	}
	return rpcClient, routeId, nil
}
```

- [ ] **Step 4: 运行测试，确认通过**

```
go test ./pkg/waveattach/...
```
预期：4 个测试全部 PASS。

- [ ] **Step 5: 校验编译（VSCode 错误面板）**

打开 `auth.go`，确认 VSCode 没有红色错误标记。如果有 import path 报错（特别是 `wshclient.AuthenticateCommand` 的签名或 `wshrpc.CommandAuthenticateData` 类型名），用 `grep` 在 `pkg/wshrpc/wshclient/wshclient.go` 中搜索 `AuthenticateCommand` 找到正确签名后调整。

- [ ] **Step 6: 提交**

```bash
git add pkg/waveattach/auth.go pkg/waveattach/auth_test.go
git commit -m "feat(waveattach): add auth package (data dir, db jwt key read, socket connect)"
```

---

## Task 2：pkg/waveattach/output.go — 输出合成

**Files:**
- Create: `pkg/waveattach/output.go`
- Create: `pkg/waveattach/output_test.go`

**Responsibility:** 实现「先订阅 WPS `blockfile` 事件 → 读历史快照 → 用 offset 去重 → 进入稳态」的输出处理逻辑。

> **关键事实回顾：**
> - `WaveFileReadStreamCommand` 只返回快照
> - 实时增量来自 `wps.Event_BlockFile` 事件，payload 是 `wps.WSFileEventData{ZoneId, FileName, FileOp, Data64}`
> - 但 `WSFileEventData` **不含 file offset 字段** —— offset 需要由 waveattach 自己累计追踪

> **澄清：去重设计**
> 既然事件 payload 没有 offset，那么"按 offset 去重"的实际做法是：
> 1. 订阅事件后开始累计接收的 append 字节数（这是事件流的本地 offset）
> 2. 调 snapshot 拿到的字节就是当时的文件全量
> 3. 在 snapshot 调用前后到达的事件无法靠 offset 区分 —— 折中策略：丢弃 snapshot 调用 **之前** 缓存的事件（被快照包含），处理 snapshot 调用 **之后** 到达的事件（不被快照包含）
> 4. 边界由"调用 snapshot 的时间戳"区分：在 snapshot 调用返回前缓存的事件，认为已包含在 snapshot 里
>
> 这有少量重复风险（snapshot 调用过程中追加的字节可能既出现在快照里又出现在事件里）。**接受此重复**，因为 term 输出多 1-2 行重复对用户体验影响很小，但少 1 行就可能丢失关键信息。

- [ ] **Step 1: 写边界判定逻辑的失败测试**

创建 `pkg/waveattach/output_test.go`：

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"bytes"
	"testing"
	"time"
)

func TestEventBuffer_ReplayAfterCutoff(t *testing.T) {
	buf := newEventBuffer()
	t0 := time.Now()
	buf.add(t0, []byte("A"))
	buf.add(t0.Add(10*time.Millisecond), []byte("B"))
	cutoff := t0.Add(20 * time.Millisecond)
	buf.add(cutoff.Add(time.Millisecond), []byte("C"))

	var out bytes.Buffer
	buf.flush(cutoff, &out)
	if got := out.String(); got != "C" {
		t.Errorf("want %q, got %q", "C", got)
	}
}

func TestEventBuffer_StreamModeAfterFlush(t *testing.T) {
	buf := newEventBuffer()
	cutoff := time.Now()
	buf.flush(cutoff, &bytes.Buffer{})

	var out bytes.Buffer
	buf.write(cutoff.Add(time.Second), []byte("hello"), &out)
	if got := out.String(); got != "hello" {
		t.Errorf("want %q, got %q", "hello", got)
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

```
go test ./pkg/waveattach/... -run TestEventBuffer
```
预期：编译失败（`newEventBuffer` 等未定义）。

- [ ] **Step 3: 实现 output.go**

创建 `pkg/waveattach/output.go`：

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

// pendingEvent records an append-event arrival time and its decoded bytes.
type pendingEvent struct {
	at   time.Time
	data []byte
}

// eventBuffer holds pre-snapshot append events, then switches to streaming mode.
type eventBuffer struct {
	mu      sync.Mutex
	pending []pendingEvent
	flushed bool
}

func newEventBuffer() *eventBuffer {
	return &eventBuffer{}
}

// add buffers an event arriving before snapshot completes.
func (b *eventBuffer) add(at time.Time, data []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.flushed {
		return
	}
	b.pending = append(b.pending, pendingEvent{at: at, data: data})
}

// flush writes all events that arrived strictly after `cutoff` to w, then
// switches to stream mode. Pre-cutoff events are assumed to be covered by the snapshot.
func (b *eventBuffer) flush(cutoff time.Time, w io.Writer) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, ev := range b.pending {
		if ev.at.After(cutoff) {
			if _, err := w.Write(ev.data); err != nil {
				return err
			}
		}
	}
	b.pending = nil
	b.flushed = true
	return nil
}

// write delivers a post-flush event directly. Must be called only after flush.
func (b *eventBuffer) write(at time.Time, data []byte, w io.Writer) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.flushed {
		b.pending = append(b.pending, pendingEvent{at: at, data: data})
		return nil
	}
	_, err := w.Write(data)
	return err
}

// StreamOutput subscribes to blockfile events for the given block, then reads the
// term file snapshot, then forwards live appends to w. Returns when the context is
// cancelled, the block is closed (truncate), or a fatal error occurs.
func StreamOutput(ctx context.Context, rpcClient *wshutil.WshRpc, blockId string, w io.Writer) error {
	buf := newEventBuffer()
	blockRef := waveobj.MakeORef(waveobj.OType_Block, blockId).String()

	rpcClient.EventListener.On(wps.Event_BlockFile, func(ev *wps.WaveEvent) {
		fed, ok := ev.Data.(*wps.WSFileEventData)
		if !ok {
			return
		}
		if fed.ZoneId != blockId || fed.FileName != wavebase.BlockFile_Term {
			return
		}
		switch fed.FileOp {
		case wps.FileOp_Append:
			data, err := base64.StdEncoding.DecodeString(fed.Data64)
			if err != nil {
				return
			}
			_ = buf.write(time.Now(), data, w)
		case wps.FileOp_Truncate, wps.FileOp_Delete:
			// Block closed or cleared — let main loop notice via separate channel.
		}
	})

	subReq := wps.SubscriptionRequest{
		Event:  wps.Event_BlockFile,
		Scopes: []string{blockRef},
	}
	if err := wshclient.EventSubCommand(rpcClient, subReq, nil); err != nil {
		return fmt.Errorf("subscribing to blockfile events: %w", err)
	}

	if err := readSnapshot(rpcClient, blockId, w); err != nil {
		return fmt.Errorf("reading snapshot: %w", err)
	}
	cutoff := time.Now()
	if err := buf.flush(cutoff, w); err != nil {
		return err
	}

	<-ctx.Done()
	return nil
}

func readSnapshot(rpcClient *wshutil.WshRpc, blockId string, w io.Writer) error {
	broker := rpcClient.StreamBroker
	if broker == nil {
		return fmt.Errorf("stream broker not available")
	}
	readerRouteId, err := wshclient.ControlGetRouteIdCommand(rpcClient, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
	if err != nil {
		return fmt.Errorf("getting route id: %w", err)
	}
	if readerRouteId == "" {
		return fmt.Errorf("no route to receive data")
	}
	reader, streamMeta := broker.CreateStreamReader(readerRouteId, "", 64*1024)
	defer reader.Close()
	data := wshrpc.CommandWaveFileReadStreamData{
		ZoneId:     blockId,
		Name:       wavebase.BlockFile_Term,
		StreamMeta: *streamMeta,
	}
	if _, err := wshclient.WaveFileReadStreamCommand(rpcClient, data, nil); err != nil {
		return fmt.Errorf("starting stream read: %w", err)
	}
	if _, err := io.Copy(w, reader); err != nil {
		return fmt.Errorf("copying snapshot: %w", err)
	}
	return nil
}
```

- [ ] **Step 4: 运行测试，确认通过**

```
go test ./pkg/waveattach/... -run TestEventBuffer
```
预期：2 个测试 PASS。

- [ ] **Step 5: 校验编译**

VSCode 错误面板检查。重点核对：
- `wshclient.ControlGetRouteIdCommand` 签名（参考 `cmd/wsh/cmd/wshcmd-readfile.go:42`）
- `RpcClient.EventListener.On` 签名（参考 `cmd/wsh/cmd/wshcmd-editor.go:83`）
- `RpcClient.StreamBroker.CreateStreamReader` 签名

- [ ] **Step 6: 提交**

```bash
git add pkg/waveattach/output.go pkg/waveattach/output_test.go
git commit -m "feat(waveattach): add output streaming (snapshot + wps event subscription)"
```

---

## Task 3：pkg/waveattach/selector.go — Block 选择 UI

**Files:**
- Create: `pkg/waveattach/selector.go`

**Responsibility:** 列出所有 term block，过滤后展示交互式选择 UI，返回选定的 blockId。

- [ ] **Step 1: 实现 selector.go**

创建 `pkg/waveattach/selector.go`：

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"fmt"
	"io"
	"os"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"golang.org/x/term"
)

// blockEntry holds the display info for one term block.
type blockEntry struct {
	BlockId   string
	Workspace string
	Tab       string
	Cwd       string
}

// ListTermBlocks returns all blocks with view="term", with workspace/tab names resolved.
func ListTermBlocks(rpcClient *wshutil.WshRpc) ([]blockEntry, error) {
	req := wshrpc.CommandBlocksListData{}
	rawList, err := wshclient.BlocksListCommand(rpcClient, req, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return nil, fmt.Errorf("listing blocks: %w", err)
	}
	var rtn []blockEntry
	wsCache := map[string]string{}
	tabCache := map[string]string{}
	for _, b := range rawList {
		if v, _ := b.Meta.GetString(waveobj.MetaKey_View, ""); v != "term" {
			continue
		}
		entry := blockEntry{
			BlockId:   b.BlockId,
			Workspace: resolveName(rpcClient, waveobj.OType_Workspace, b.WorkspaceId, wsCache),
			Tab:       resolveName(rpcClient, waveobj.OType_Tab, b.TabId, tabCache),
			Cwd:       trim(b.Meta.GetString(waveobj.MetaKey_CmdCwd, ""), 40),
		}
		rtn = append(rtn, entry)
	}
	return rtn, nil
}

func resolveName(rpcClient *wshutil.WshRpc, otype string, oid string, cache map[string]string) string {
	if oid == "" {
		return ""
	}
	if v, ok := cache[oid]; ok {
		return v
	}
	oref := waveobj.MakeORef(otype, oid).String()
	meta, err := wshclient.GetMetaCommand(rpcClient, wshrpc.CommandGetMetaData{ORef: oref}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		short := oid
		if len(short) > 8 {
			short = short[:8]
		}
		cache[oid] = short
		return short
	}
	name, _ := meta.GetString(waveobj.MetaKey_Name, "")
	if name == "" {
		name = oid[:8]
	}
	cache[oid] = name
	return name
}

func trim(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max-1] + "…"
}

// SelectBlock decides which block to attach to:
//   - 0 entries: error
//   - 1 entry:   auto-select
//   - >1:        run interactive UI
func SelectBlock(rpcClient *wshutil.WshRpc) (string, error) {
	entries, err := ListTermBlocks(rpcClient)
	if err != nil {
		return "", err
	}
	if len(entries) == 0 {
		return "", fmt.Errorf("no running term blocks found")
	}
	if len(entries) == 1 {
		return entries[0].BlockId, nil
	}
	return runInteractiveSelector(entries)
}

func runInteractiveSelector(entries []blockEntry) (string, error) {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return "", fmt.Errorf("multiple blocks found but stdin is not a terminal — pass blockid explicitly")
	}
	oldState, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		return "", fmt.Errorf("entering raw mode for selector: %w", err)
	}
	defer term.Restore(int(os.Stdin.Fd()), oldState)

	cursor := 0
	render := func() {
		fmt.Fprint(os.Stderr, "\x1b[2J\x1b[H") // clear screen, home
		fmt.Fprintln(os.Stderr, "选择要 attach 的 Block：\r")
		fmt.Fprintln(os.Stderr, "\r")
		for i, e := range entries {
			marker := "  "
			if i == cursor {
				marker = "▶ "
			}
			fmt.Fprintf(os.Stderr, "%s[%d] term  │ workspace: %-12s │ tab: %-10s │ cwd: %s\r\n",
				marker, i+1, e.Workspace, e.Tab, e.Cwd)
		}
		fmt.Fprintln(os.Stderr, "\r")
		fmt.Fprintf(os.Stderr, "↑/↓ 选择  Enter 确认  q 退出  │ block: %s\r", entries[cursor].BlockId)
	}

	render()
	buf := make([]byte, 8)
	for {
		n, err := os.Stdin.Read(buf)
		if err != nil {
			if err == io.EOF {
				return "", fmt.Errorf("stdin closed")
			}
			return "", err
		}
		s := string(buf[:n])
		switch {
		case s == "q" || s == "\x03": // q or Ctrl+C
			fmt.Fprint(os.Stderr, "\x1b[2J\x1b[H")
			return "", fmt.Errorf("cancelled")
		case s == "\r" || s == "\n":
			fmt.Fprint(os.Stderr, "\x1b[2J\x1b[H")
			return entries[cursor].BlockId, nil
		case s == "\x1b[A" && cursor > 0: // up arrow
			cursor--
			render()
		case s == "\x1b[B" && cursor < len(entries)-1: // down arrow
			cursor++
			render()
		}
	}
}
```

- [ ] **Step 2: 校验编译**

VSCode 错误面板检查。重点核对：
- `wshclient.BlocksListCommand` 的参数类型（参考 `cmd/wsh/cmd/wshcmd-blocks.go:154` ——  注意可能叫 `CommandBlocksListData` 或类似，要按实际签名调整）
- `wshclient.GetMetaCommand` 的参数类型
- `b.Meta.GetString` 是否存在（`waveobj.MetaMapType` 的方法）；如果不存在，用 `b.Meta[waveobj.MetaKey_View]` 配合类型断言
- `waveobj.OType_Workspace`、`OType_Tab` 常量名
- `waveobj.MetaKey_View`、`MetaKey_Name`、`MetaKey_CmdCwd` 常量名

如有任何 API 不匹配，**先用 grep 在 `pkg/waveobj/` 和 `pkg/wshrpc/wshclient/` 中找到准确签名后再调整代码**。

- [ ] **Step 3: 提交**

```bash
git add pkg/waveattach/selector.go
git commit -m "feat(waveattach): add interactive block selector"
```

---

## Task 4：pkg/waveattach/attach.go — 主循环

**Files:**
- Create: `pkg/waveattach/attach.go`
- Create: `pkg/waveattach/attach_test.go`

**Responsibility:** 终端 raw mode、Ctrl+A D 状态机、SIGWINCH、协调 Output goroutine 和 Input goroutine、退出原因判定。

- [ ] **Step 1: 写 Ctrl+A D 状态机的失败测试**

创建 `pkg/waveattach/attach_test.go`：

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"bytes"
	"testing"
)

func TestPrefixKeyMachine_PlainBytesPassThrough(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	det, err := m.feed([]byte("hello"), &out)
	if err != nil || det {
		t.Fatalf("unexpected: detach=%v err=%v", det, err)
	}
	if out.String() != "hello" {
		t.Errorf("want 'hello', got %q", out.String())
	}
}

func TestPrefixKeyMachine_DetachOnCtrlAD(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	det, _ := m.feed([]byte{0x01, 'd'}, &out)
	if !det {
		t.Fatal("expected detach")
	}
	if out.Len() != 0 {
		t.Errorf("expected nothing forwarded, got %q", out.String())
	}
}

func TestPrefixKeyMachine_DetachOnCtrlACapitalD(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	det, _ := m.feed([]byte{0x01, 'D'}, &out)
	if !det {
		t.Fatal("expected detach")
	}
}

func TestPrefixKeyMachine_LiteralCtrlAByDoubling(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	det, _ := m.feed([]byte{0x01, 0x01}, &out)
	if det {
		t.Fatal("did not expect detach")
	}
	if !bytes.Equal(out.Bytes(), []byte{0x01}) {
		t.Errorf("want 0x01, got %v", out.Bytes())
	}
}

func TestPrefixKeyMachine_PrefixThenOtherKey(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	det, _ := m.feed([]byte{0x01, 'x'}, &out)
	if det {
		t.Fatal("did not expect detach")
	}
	if !bytes.Equal(out.Bytes(), []byte{0x01, 'x'}) {
		t.Errorf("want [0x01 'x'], got %v", out.Bytes())
	}
}

func TestPrefixKeyMachine_PrefixSplitAcrossReads(t *testing.T) {
	m := newPrefixKey()
	var out bytes.Buffer
	if det, _ := m.feed([]byte{0x01}, &out); det {
		t.Fatal("did not expect detach yet")
	}
	if out.Len() != 0 {
		t.Errorf("expected buffered, got %q", out.String())
	}
	det, _ := m.feed([]byte{'d'}, &out)
	if !det {
		t.Fatal("expected detach on second feed")
	}
}
```

- [ ] **Step 2: 运行测试，确认失败**

```
go test ./pkg/waveattach/... -run TestPrefixKey
```
预期：编译失败（`newPrefixKey` 未定义）。

- [ ] **Step 3: 实现 attach.go**

创建 `pkg/waveattach/attach.go`：

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"golang.org/x/term"
)

const ctrlA = 0x01

// prefixKey is a state machine implementing the Ctrl+A D detach prefix.
type prefixKey struct {
	gotPrefix bool
}

func newPrefixKey() *prefixKey { return &prefixKey{} }

// feed processes b. Forwards bytes that should go to the block to w.
// Returns detach=true when Ctrl+A D was seen.
func (p *prefixKey) feed(b []byte, w io.Writer) (detach bool, err error) {
	for _, c := range b {
		if !p.gotPrefix {
			if c == ctrlA {
				p.gotPrefix = true
				continue
			}
			if _, err := w.Write([]byte{c}); err != nil {
				return false, err
			}
			continue
		}
		// gotPrefix == true
		switch c {
		case 'd', 'D':
			return true, nil
		case ctrlA:
			if _, err := w.Write([]byte{ctrlA}); err != nil {
				return false, err
			}
			// stay in gotPrefix
		default:
			if _, err := w.Write([]byte{ctrlA, c}); err != nil {
				return false, err
			}
			p.gotPrefix = false
		}
	}
	return false, nil
}

// ErrDetached is returned when the user pressed Ctrl+A D.
var ErrDetached = errors.New("detached")

// ErrBlockClosed is returned when the block's controller exited.
var ErrBlockClosed = errors.New("block closed")

// Attach runs the bidirectional attach loop until detach, block close, or error.
func Attach(rpcClient *wshutil.WshRpc, blockId string) error {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return fmt.Errorf("stdin is not a terminal")
	}
	oldState, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		return fmt.Errorf("entering raw mode: %w", err)
	}
	defer term.Restore(int(os.Stdin.Fd()), oldState)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// SIGWINCH → send TermSize
	winchCh := make(chan os.Signal, 1)
	signal.Notify(winchCh, syscall.SIGWINCH)
	defer signal.Stop(winchCh)
	sendTermSize := func() {
		w, h, err := term.GetSize(int(os.Stdout.Fd()))
		if err != nil {
			return
		}
		_ = wshclient.ControllerInputCommand(rpcClient, wshrpc.CommandBlockInputData{
			BlockId:  blockId,
			TermSize: &waveobj.TermSize{Rows: h, Cols: w},
		}, nil)
	}
	sendTermSize()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-winchCh:
				sendTermSize()
			}
		}
	}()

	// Listen for controller status = done → quit
	exitCh := make(chan error, 2)
	rpcClient.EventListener.On(wps.Event_ControllerStatus, func(ev *wps.WaveEvent) {
		// Payload is *blockcontroller.BlockControllerRuntimeStatus. Avoid hard-importing
		// blockcontroller (circular risk); decode through map[string]any check on Status.
		m, ok := ev.Data.(map[string]any)
		if !ok {
			// Some serializers deliver the typed pointer; fall back to JSON re-marshal if needed.
			return
		}
		bid, _ := m["blockid"].(string)
		if bid != blockId {
			return
		}
		status, _ := m["shellprocstatus"].(string)
		if status == "done" {
			exitCh <- ErrBlockClosed
		}
	})
	subReq := wps.SubscriptionRequest{
		Event:  wps.Event_ControllerStatus,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, blockId).String()},
	}
	_ = wshclient.EventSubCommand(rpcClient, subReq, nil)

	// Output goroutine
	go func() {
		if err := StreamOutput(ctx, rpcClient, blockId, os.Stdout); err != nil {
			exitCh <- fmt.Errorf("output: %w", err)
		}
	}()

	// Input loop (this goroutine)
	go func() {
		exitCh <- inputLoop(ctx, rpcClient, blockId)
	}()

	err = <-exitCh
	cancel()
	if errors.Is(err, ErrDetached) {
		fmt.Fprintln(os.Stderr, "\r\n[detached]")
		return nil
	}
	if errors.Is(err, ErrBlockClosed) {
		fmt.Fprintln(os.Stderr, "\r\n[block closed]")
		return nil
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "\r\n[error] %v\n", err)
		return err
	}
	return nil
}

func inputLoop(ctx context.Context, rpcClient *wshutil.WshRpc, blockId string) error {
	pk := newPrefixKey()
	buf := make([]byte, 4096)
	for {
		n, err := os.Stdin.Read(buf)
		if err != nil {
			return err
		}
		var forward bytes.Buffer
		detach, err := pk.feed(buf[:n], &forward)
		if err != nil {
			return err
		}
		if forward.Len() > 0 {
			data := wshrpc.CommandBlockInputData{
				BlockId:     blockId,
				InputData64: base64.StdEncoding.EncodeToString(forward.Bytes()),
			}
			if err := wshclient.ControllerInputCommand(rpcClient, data, nil); err != nil {
				return fmt.Errorf("sending input: %w", err)
			}
		}
		if detach {
			return ErrDetached
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
	}
}

```

- [ ] **Step 4: 运行测试，确认通过**

```
go test ./pkg/waveattach/... -run TestPrefixKey
```
预期：6 个 PrefixKey 测试 PASS。再跑一次全量：

```
go test ./pkg/waveattach/...
```
预期：全部 PASS。

- [ ] **Step 5: 校验编译**

VSCode 错误面板检查。重点核对：
- `wshclient.ControllerInputCommand` 签名（参考 `pkg/wshrpc/wshclient/wshclient.go`）
- `waveobj.TermSize` 字段名（应该是 `Rows` 和 `Cols`）
- `wps.Event_ControllerStatus` 在 `pkg/wps/wpstypes.go` 中已确认存在
- 控制器事件 payload 的实际字段名（"shellprocstatus" 还是别的）—— grep `BlockControllerRuntimeStatus` 类型定义确认
- `term.GetSize` 与 `term.MakeRaw` 来自 `golang.org/x/term`，确认 `go.mod` 已含此依赖

- [ ] **Step 6: 提交**

```bash
git add pkg/waveattach/attach.go pkg/waveattach/attach_test.go
git commit -m "feat(waveattach): add main attach loop with raw mode and ctrl+a d state machine"
```

---

## Task 5：cmd/waveattach/main-waveattach.go — 入口

**Files:**
- Create: `cmd/waveattach/main-waveattach.go`

**Responsibility:** CLI 参数解析、调用 auth/selector/attach、错误退出码。

- [ ] **Step 1: 实现 main**

创建 `cmd/waveattach/main-waveattach.go`：

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"os"

	"github.com/wavetermdev/waveterm/pkg/waveattach"
)

func usage() {
	fmt.Fprintln(os.Stderr, "usage: waveattach [blockid]")
	fmt.Fprintln(os.Stderr, "  Attach to a Wave Terminal block from an external terminal.")
	fmt.Fprintln(os.Stderr, "  Press Ctrl+A D to detach.")
}

func main() {
	if len(os.Args) > 2 {
		usage()
		os.Exit(2)
	}
	if len(os.Args) == 2 && (os.Args[1] == "-h" || os.Args[1] == "--help") {
		usage()
		os.Exit(0)
	}

	rpcClient, _, err := waveattach.Connect()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	var blockId string
	if len(os.Args) == 2 {
		blockId = os.Args[1]
	} else {
		blockId, err = waveattach.SelectBlock(rpcClient)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	}

	if err := waveattach.Attach(rpcClient, blockId); err != nil {
		os.Exit(1)
	}
}
```

- [ ] **Step 2: 校验编译**

VSCode 错误面板检查。

- [ ] **Step 3: 提交**

```bash
git add cmd/waveattach/main-waveattach.go
git commit -m "feat(waveattach): add cli entrypoint"
```

---

## Task 6：构建验证 + 手动集成测试

**Files:**
- 不修改源码，只是编译运行验证。

- [ ] **Step 1: 整体编译**

```
go build -o /tmp/waveattach ./cmd/waveattach
```
预期：无报错，生成 `/tmp/waveattach` 二进制。

如果失败：根据报错回到对应 Task 调整 import 或 API 调用。

- [ ] **Step 2: 跑全部 Wave 单元测试，确认没破坏其他包**

```
go test ./pkg/...
```
预期：包括 `pkg/waveattach/...` 在内的所有测试通过。

- [ ] **Step 3: 手动集成测试 —— 数据目录与连接**

启动 Wave Terminal（`task dev` 或运行已安装版本）。然后另开一个**外部终端**（iTerm/Terminal.app）：

```
/tmp/waveattach --help
```
预期：打印 usage。

```
/tmp/waveattach
```
预期：
- 如果 Wave 没运行：打印 `error: Wave data directory not found ...`
- 如果只有 1 个 term block：直接 attach
- 如果有多个：进入交互式选择 UI

- [ ] **Step 4: 手动集成测试 —— 输入输出**

在交互式选择 UI 中：
- ↑/↓ 切换光标，确认底部状态栏 UUID 更新
- Enter 选中

attach 后：
- 在外部终端键入 `ls` + Enter，确认 Wave 内对应 block 显示输入并执行
- 在 Wave 内对应 block 中键入 `echo hi`，确认外部终端实时回显
- 调整外部终端窗口大小，确认 Wave block 中 PTY 也跟着 resize（用 `stty size` 或 `tput cols/lines` 验证）

- [ ] **Step 5: 手动集成测试 —— 历史回放**

在 Wave block 中先运行多个命令产生输出，然后从外部终端 `/tmp/waveattach <blockid>` attach，确认能看到这些历史输出。

- [ ] **Step 6: 手动集成测试 —— Ctrl+A D detach**

attach 状态下：
- 按 `Ctrl+A` 然后 `d`，确认外部终端打印 `[detached]` 并退出，且 Wave 内 block 的 shell **没有终止**
- 重新 attach，确认能继续使用

- [ ] **Step 7: 手动集成测试 —— Ctrl+C 转发**

attach 状态下，先在 block 内运行 `sleep 100`，然后从外部终端按 `Ctrl+C`，确认 sleep 被中断（说明 Ctrl+C 转发到了 block，没有被工具吞掉）。

- [ ] **Step 8: 手动集成测试 —— Block 关闭检测**

attach 状态下，在 Wave UI 里关闭对应 block，确认外部终端打印 `[block closed]` 并干净退出。

- [ ] **Step 9: 提交集成测试通过的标记（可选）**

如果中间有任何小修补，一并提交：

```bash
git add -A
git commit -m "fix(waveattach): adjustments after manual integration testing"
```

---

## 完成

所有任务完成后：
- 5 个新源文件 + 3 个测试文件
- 通过单元测试覆盖纯逻辑（数据目录解析、事件去重、Ctrl+A D 状态机）
- 通过手动集成测试覆盖 RPC 路径、终端控制、信号处理

**最终提交结构（约 5-6 个 commit）：**
1. `feat(waveattach): add auth package ...`
2. `feat(waveattach): add output streaming ...`
3. `feat(waveattach): add interactive block selector`
4. `feat(waveattach): add main attach loop ...`
5. `feat(waveattach): add cli entrypoint`
6. `fix(waveattach): adjustments after manual integration testing`（可选）
