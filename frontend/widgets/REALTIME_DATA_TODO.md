# Real-Time Data Migration TODO

> **Goal**: Replace all `Math.random()` / `generateMock*()` simulation with real fetched,
> shared, and distributed data from live on-chain and off-chain sources.
> Work proceeds widget-by-widget, starting with the highest-value streams first.

---

## Architecture overview (target state)

```
┌─────────────────────────────────────────────────────────────────┐
│  External sources (WebSocket / REST / on-chain RPC)             │
│  Hyperliquid WS · Uniswap subgraph · Aave subgraph ·            │
│  CoinGecko · Alchemy/Infura RPC · Docker daemon API             │
└────────────────────┬────────────────────────────────────────────┘
                     │ Go backend (pkg/wshrpc / vdom / wshcmd)
┌────────────────────▼────────────────────────────────────────────┐
│  Shared data bus  (WPS pub/sub, wave_obj cache, Redis)          │
│  - price streams       pkg/databus/prices.go                    │
│  - lending rates       pkg/databus/lending.go                   │
│  - pool metrics        pkg/databus/amm.go                       │
│  - container state     pkg/databus/containers.go                │
│  - ML run artifacts    pkg/databus/mlartifacts.go               │
└────────────────────┬────────────────────────────────────────────┘
                     │ blockController RPC / wshcmd RPCs
┌────────────────────▼────────────────────────────────────────────┐
│  Frontend widget models  (replace generateMock* atoms)          │
│  - subscribe via useWshRpc / EventListener / WPS hooks          │
│  - persist config in block meta / wave_obj store                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 — Real-time OHLCV price data (Trading Algobot)

**Current state**: `generatePriceHistory()` uses random walk; `generateMockPositions()` uses
hard-coded base prices; `startRefresh()` ticks price with Gaussian noise every 2 s.

### TODO

- [ ] **P1-1** Create `pkg/databus/prices.go`
  - Connect to Hyperliquid WebSocket feed (`wss://api.hyperliquid.xyz/ws`)
  - Subscribe to `l2Book` and `trades` channels for configurable symbols
  - Publish OHLCV candles (1-min aggregation) to WPS topic `prices/{symbol}/ohlcv`
  - Cache last N=500 candles per symbol in Redis `ohlcv:{symbol}` sorted-set

- [ ] **P1-2** Add `wshcmd` RPC `GetOhlcv(symbol, limit)` → `[]OhlcvCandle`
  - Route: `pkg/wshcmd/ohlcvcmd.go`
  - Frontend call: `useWshRpc("GetOhlcv", { symbol, limit: 120 })`

- [ ] **P1-3** Replace `priceHistory` atom in `tradingalgobot-model.ts`
  - Remove `generatePriceHistory()` and 2-second `setInterval` price tick
  - Subscribe to WPS `prices/BTC-PERP/ohlcv` in `constructor`
  - Keep `selectedSymbol` atom — re-subscribe on symbol change

- [ ] **P1-4** Replace `generateMockPositions()` with `GetOpenPositions()` RPC
  - Hyperliquid REST: `POST https://api.hyperliquid.xyz/info` `{"type":"openOrders","user":"<addr>"}`
  - Cache in wave_obj store under `block:{blockId}:positions`
  - Refresh every 5 s (positions change infrequently)

- [ ] **P1-5** Replace `generateMockSignals()` with real ONNX/Joblib inference output
  - ML worker (containerised, see Phase 5) publishes signals to WPS `signals/{symbol}`
  - `tradingalgobot-model.ts` subscribes and appends to `signals` atom

- [ ] **P1-6** Wire performance metrics to accumulated trade history
  - P&L from actual position deltas stored in PostgreSQL `trades` table
  - `GetPerformanceMetrics()` RPC aggregates win-rate, Sharpe, drawdown

- [ ] **P1-7** Add `blockController` wrapper for Hyperliquid session state
  - Store API key / address in encrypted block meta (never plain-text)
  - Expose `GetControllerStatus()` so header bar shows connection health

---

## Phase 2 — Blockchain token prices and arbitrage data (Arbitrage Bot)

**Current state**: `randBetween()` generates fake price spreads per DEX; opportunity
confidence is random; execution outcome uses `Math.random() > 0.8`.

### TODO

- [ ] **P2-1** Create `pkg/databus/dex_prices.go`
  - Poll Uniswap V3 subgraph (The Graph) for pool slot0 (sqrtPriceX96) every 2 s
  - Poll Camelot subgraph for equivalent
  - Compute mid-price and spread between DEXes for each pair
  - Publish to WPS `dex/{pair}/{dex}/price`

- [ ] **P2-2** Replace `generateMockOpportunities()` in `arbitragebot-model.ts`
  - Subscribe to `dex/{pair}/*/price` and compute triangular profit in-widget
  - OR delegate to `pkg/databus/arbitrage.go` which emits `arb/{pair}/opportunity`

- [ ] **P2-3** Replace random execution simulation
  - Real execution: call Arbitrum smart-contract via `ethers.js` (or Go `go-ethereum`)
  - For safety: simulate-first mode using `eth_call` before real broadcast
  - Store execution receipts in PostgreSQL `arb_trades` table

- [ ] **P2-4** Add gas price feed
  - Subscribe to `eth_gasPrice` / EIP-1559 `eth_feeHistory` via Alchemy WebSocket
  - Display in arbitrage opportunity cards (profitability net of gas)

- [ ] **P2-5** `blockController` wrapper
  - Store RPC URL and wallet key reference in encrypted block meta
  - Health check: last successful price fetch timestamp

---

## Phase 3 — Liquidity hooks for DeFi Lending and AMM Pools

### DeFi Lending (`defilending`)

**Current state**: `Math.random()` drifts supply/borrow APY and utilization every 3 s;
ML-predicted APY is static offset.

- [ ] **P3-1** Create `pkg/databus/lending.go`
  - Fetch Aave V3 (Arbitrum) reserve data via `UiPoolDataProvider` view-call every 10 s
  - Map to `MoneyMarket` type (supplyApy, borrowApy, utilization, totalSupply, ltv)
  - Publish to WPS `lending/{asset}/rates`

- [ ] **P3-2** Replace `Math.random()` drifts in `defilending-model.ts`
  - Subscribe to `lending/*/rates`; update `markets` atom on each event

- [ ] **P3-3** ML APY prediction service
  - Retrain prediction model on-the-fly with latest utilization curve data
  - Expose `PredictApy(asset, horizon)` RPC from ML worker (Phase 5)
  - Update `mlPredApy` column in markets atom from RPC response

- [ ] **P3-4** User position sync
  - Call `UiPoolDataProvider.getUserReservesData(user, poolAddressProvider)`
  - Refresh every 15 s; store in wave_obj `block:{blockId}:position`

- [ ] **P3-5** Transaction submission
  - Wire Supply / Borrow / Repay / Withdraw buttons to real Aave V3 contract calls
  - Use `eth_sendRawTransaction` with pre-signed tx (wallet integration, Phase 6)

### AMM Liquidity (`ammliquidity`)

**Current state**: `Math.random()` drifts volume24h, apy, price, feesEarned every 3 s.

- [ ] **P3-6** Create `pkg/databus/amm.go`
  - Uniswap V3 subgraph: `pools` query for TVL, volumeUSD, feesUSD (24 h window)
  - Curve: `https://api.curve.fi/v1/getPools/arbitrum/main`
  - Balancer: subgraph `pools` query
  - Camelot: subgraph `pairs` query
  - Merge into unified `LiquidityPool` type; publish to WPS `amm/{protocol}/{pair}/stats`

- [ ] **P3-7** Replace drifts in `ammliquidity-model.ts`
  - Subscribe to `amm/*/stats`; update `pools` atom

- [ ] **P3-8** Tick-level price from Uniswap V3 `slot0`
  - Real sqrtPriceX96 → human price conversion
  - Use for swap price-impact calculator (replace static mock reserves)

- [ ] **P3-9** LP position read from on-chain
  - `NonfungiblePositionManager.positions(tokenId)` for connected wallet
  - Display real tick range, fee tier, unclaimed fees

---

## Phase 4 — Active container process monitoring (Containers widget)

**Current state**: 6 hard-coded container records; CPU drifts with `Math.random()` every 2.5 s;
log lines are static.

- [ ] **P4-1** Add `wshcmd` command `ListContainers()` → `[]ContainerInfo`
  - Call Docker daemon Unix socket `GET /containers/json?all=1`
  - Or kubectl API for K8s mode (detect via kubeconfig presence)
  - Return name, image, status, ports, created, id

- [ ] **P4-2** Add `wshcmd` command `GetContainerStats(id)` → `ContainerStats`
  - `GET /containers/{id}/stats?stream=false`
  - Parse cpu_delta / system_cpu_delta for CPU%; mem_usage for memory

- [ ] **P4-3** Replace `Math.random()` CPU drift in `containers-model.ts`
  - Poll `GetContainerStats` every 3 s for each running container
  - Store history for sparkline canvas

- [ ] **P4-4** Stream real container logs
  - `GET /containers/{id}/logs?follow=true&stdout=true&stderr=true&tail=100`
  - Multiplex via WPS `containers/{id}/logs`
  - Frontend appends log lines to `logs` atom

- [ ] **P4-5** Wire action buttons to real Docker API
  - Start: `POST /containers/{id}/start`
  - Stop: `POST /containers/{id}/stop`
  - Restart: `POST /containers/{id}/restart`
  - Remove: `DELETE /containers/{id}`

- [ ] **P4-6** Shell exec
  - `POST /containers/{id}/exec` + `POST /exec/{execId}/start`
  - Stream output back through WPS `containers/{id}/exec/{execId}`

- [ ] **P4-7** `blockController` wrapper
  - Store Docker socket path / K8s context in block meta
  - Show daemon version and connection health in header

---

## Phase 5 — ML model training infrastructure (ML Model widget)

**Current state**: `startTraining()` uses `setInterval` progress simulation; models are static
records; export buttons are no-ops.

- [ ] **P5-1** Create ML worker service
  - Containerised Python worker: `docker-compose.fin.yml` service `ml-worker`
  - Accepts jobs via Redis queue (`ml:jobs`) using existing Redis from `docker-compose.fin.yml`
  - Trains scikit-learn / ONNX models; stores artefacts in PostgreSQL `ml_models` table

- [ ] **P5-2** Add `wshcmd` RPCs for ML lifecycle
  - `StartTraining(config)` → `jobId`
  - `GetTrainingStatus(jobId)` → `{progress, log, status}`
  - `GetModels()` → `[]MLModelRecord`
  - `ExportModel(modelId, format)` → `{path, size}`
  - `PredictApy(asset, horizon)` → `float64` (used by DeFi Lending Phase 3-3)

- [ ] **P5-3** Replace simulation in `mlmodel-model.ts`
  - `startTraining()` calls `StartTraining` RPC; polls `GetTrainingStatus` every 1 s
  - `models` atom loaded from `GetModels()` on mount
  - Export buttons call `ExportModel` and show real file path / size

- [ ] **P5-4** Data ingestion pipeline
  - CSV/JSON: upload to Go backend, store in `/data/uploads/`
  - DB: query via `pkg/databus` connection pool → export to parquet
  - PDF: text extraction with `pdfminer` in Python worker
  - Safetensor: load via `safetensors` Python library
  - Dataset (HuggingFace): `datasets.load_dataset()` in worker
  - XML: parse with `lxml` in worker

- [ ] **P5-5** ONNX/Joblib exclusive export
  - ONNX: `skl2onnx.convert_sklearn(model, opset=17)` → save to `/models/`
  - Joblib: `joblib.dump(model, path, compress=9)`
  - Serve artefact download URL through block meta

- [ ] **P5-6** Wire Shell Workflows step execution to real shell
  - `shellworkflow` "shell" steps → call `wshcmd RunShellStep(cmd, env)` RPC
  - "python" steps → forward to ML worker queue
  - "http" steps → Go HTTP client with configurable timeout
  - "condition" steps → evaluate expression on last step output

---

## Phase 6 — Wallet and shared credential management

- [ ] **P6-1** Encrypted credential store in wave_obj
  - AES-256-GCM; key derived from OS keychain (macOS Keychain / libsecret / DPAPI)
  - Namespaced per block: `block:{blockId}:creds`

- [ ] **P6-2** Shared wallet context
  - Single wallet atom in global store; all DeFi widgets read from it
  - WalletConnect v2 integration for browser-extension signing

- [ ] **P6-3** RPC URL pool
  - Round-robin / fallback across Alchemy, Infura, public RPCs
  - Health-check pings; auto-failover stored in wave_obj `global:rpc_pool`

---

## Phase 7 — Metrics bus and observability

- [ ] **P7-1** Connect all widgets to unified metrics stream
  - WPS topic `metrics/{widgetType}/{blockId}/{metric}`
  - Each model's `startRefresh()` publishes latency, error count, data-freshness age

- [ ] **P7-2** Metrics dashboard aggregate view
  - Extend `widgetbuilder` metrics tab to pull from `metrics/**`
  - Show per-widget: last update time, error rate, data source health

- [ ] **P7-3** Alerting
  - Configurable thresholds in block meta (e.g. price deviation > X%, health factor < 1.2)
  - Alert fires WPS `alerts/{blockId}` → header bar badge + system notification

- [ ] **P7-4** Distributed cache invalidation
  - Redis pub/sub `__keyevent@0__:expired` to trigger re-fetch on TTL expiry
  - All `pkg/databus/*.go` fetchers subscribe and re-hydrate on invalidation

---

## Phase 8 — Widget Builder live data connections

- [ ] **P8-1** DB Query station — real connections
  - Connect to PostgreSQL via `pkg/databus` connection pool
  - Store connection string (encrypted) in `blockController` meta
  - Execute queries in Go; stream results back via RPC

- [ ] **P8-2** HTTP station — real requests
  - Execute from Go backend (avoids CORS); stream response chunks via WPS
  - Support OAuth2 bearer token injection from credential store (Phase 6-1)

- [ ] **P8-3** Storage station — wave_obj backend
  - `Set/Get/Delete` backed by wave_obj store (existing `waveobj` package)
  - TTL implemented via object version expiry

- [ ] **P8-4** AI Chat — real model calls
  - Route to Groq API (existing `groq:*` settings namespace from finstream)
  - Or local Ollama endpoint (configurable in block meta)
  - Stream tokens via WPS `ai/{blockId}/stream`

---

## Phase 9 — Code Editor live execution

- [ ] **P9-1** Python / Shell execution
  - Wire Run button to `wshcmd RunCode(lang, code, env)` RPC
  - Execute in isolated subprocess (per-block PTY or Docker `ml-worker` sandbox)
  - Stream stdout/stderr back via WPS `exec/{blockId}/output`

- [ ] **P9-2** AI autocompletion — real inference
  - Send cursor context to Groq / local LLM; stream completion tokens
  - Insert at cursor position in textarea

- [ ] **P9-3** File system integration
  - File tree backed by real filesystem path stored in block meta (`file` key, same as `preview`)
  - Read/write via existing `preview` model file RPC

---

## Cross-cutting concerns (all phases)

- [ ] **CC-1** Error boundaries: every widget must show a degraded-mode UI when data source
  is unavailable (display last cached value + staleness badge)
- [ ] **CC-2** Data-freshness timestamp displayed in each widget header
- [ ] **CC-3** Reconnect logic: exponential back-off on WebSocket / RPC failures
- [ ] **CC-4** `docker-compose.fin.yml` — add `ml-worker` service, ensure `postgres` and
  `redis` volumes are named and persist across restarts
- [ ] **CC-5** Go backend `pkg/databus/` package — shared singleton data-bus with
  context-cancellable goroutines; all fetchers register here
- [ ] **CC-6** Unit tests for each `pkg/databus/*.go` fetcher (mock HTTP transport)
- [ ] **CC-7** Integration test: preview server with real data injected via mock WPS events

---

## Priority order

| Priority | Phase | Rationale |
|---|---|---|
| 1 | P1 — OHLCV + Hyperliquid | Highest-value stream; direct P&L impact |
| 2 | P3 — Aave + AMM subgraph | Read-only; low risk; immediate visual improvement |
| 3 | P4 — Docker stats | Local data; no keys needed; easy win |
| 4 | P2 — DEX prices | Requires subgraph API key |
| 5 | P5 — ML worker | Requires containerised Python infra |
| 6 | P6 — Wallet | Security-critical; needs careful review |
| 7 | P7 — Metrics bus | Infrastructure; blocks alerting |
| 8 | P8/P9 — Builder / Editor live | Depends on earlier RPC plumbing |
