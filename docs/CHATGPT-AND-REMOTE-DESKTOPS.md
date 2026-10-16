# ChatGPT subscriptions, BYOK, and remote desktops

This fork removes Wave usage telemetry, event persistence, opt-out reporting, and diagnostic install pings. Legacy telemetry settings and RPC methods remain compatible but do not enable collection. Existing databases are not deleted. Explicit AI requests still go to the selected provider, and software updates remain a separate feature.

## Build on Fedora KDE Plasma 44 (x86_64)

Use Go 1.26.8, Node.js 22 LTS (Node 24 also passed the development build), npm, and a C compiler for SQLite. See `BUILD.md` for general build prerequisites. The desktop environment must supply Electron's graphical/runtime libraries. This document does not install or replace a system Wave application.

The subscription adapter was verified with the official `@openai/codex` CLI version **0.163.0**. Install it in a user-owned directory and ensure `codex` is on Wave's PATH. Alternatively set `WAVETERM_CODEX_BINARY` before launching Wave to an absolute path whose final component is `codex` (`codex.exe` on Windows). Only install the official OpenAI package from a trusted registry.

From the existing repository checkout:

```sh
npm ci
go mod download
go run cmd/generateschema/main-generateschema.go
mkdir -p dist/bin
go build -tags 'osusergo,sqlite_omit_load_extension' \
  -ldflags '-X main.WaveVersion=0.14.5' -o dist/bin/wavesrv.x64 ./cmd/server
go build -ldflags '-X main.WaveVersion=0.14.5' \
  -o dist/bin/wsh-0.14.5-linux.x64 cmd/wsh/main-wsh.go
npm run dev
```

Development mode uses Wave's separate development profile. Do not run `task init` or packaging tasks to replace your installed Wave. `npm run build:dev` creates the Electron main/preload and renderer bundles without launching the app.

## Connect a ChatGPT account

1. Open Wave Settings → Wave AI Modes → Visual.
2. Under **ChatGPT / Codex (Subscription)** choose **Continue with ChatGPT**.
3. The system browser opens OpenAI's official registration page. Authorize ChatGPT plan usage and return to Wave. Wave listens only on `127.0.0.1`, on an available port, at `/auth/callback`.
4. Verify that the selected account says **Plan usage authorized**. Click **Load models**, select a model, and click **Use in Wave AI**.
5. Start a new chat in the existing Wave AI sidebar. Responses stream into the sidebar; existing Stop and retry controls apply. Follow-up messages resume the same Codex thread.

A model catalog is not an entitlement check. Unavailable models, revoked authorization, and exhausted plan usage produce errors; Wave never falls back to paid API billing. Use the ChatGPT usage-management link to inspect app permissions and limits.

Reconnect reuses that account's issued client ID and the installation's stable host ID. Authorization URLs contain no tokens; returning users may see OpenAI's account selector. Add another account with Continue with ChatGPT, or choose Use account on a saved registration. Start a new chat when changing accounts. A chat's history cannot be opened or continued under another active account. Sign out cancels in-flight requests, attempts refresh-session revocation, and clears that account's tokens while retaining the registration for future sign-in. If remote revocation cannot be confirmed, the settings status directs you to disconnect the app in ChatGPT Settings.

## BYOK and local models

Wave AI Modes → Visual also provides an API-key mode form. Choose OpenAI API, Gemini, OpenRouter, or Groq; enter the model and an encrypted-secret name. Enter a key to save/update that secret, or leave it blank to reuse one. **Save API-key mode** preserves other mode entries and selects the new default. API keys use the provider's API billing, separately from ChatGPT plan usage. The JSON tab continues to support existing Ollama, Azure, custom endpoint, and other provider configurations.

Example subscription mode (tokens never belong in this file):

```json
{
  "codex-subscription": {
    "display:name": "ChatGPT / Codex (Subscription)",
    "ai:provider": "chatgpt-plan",
    "ai:apitype": "codex-app-server",
    "ai:model": "gpt-5.4"
  }
}
```

The subscription provider forces the official OpenAI Responses endpoint and ignores API-key, secret-name, proxy, and endpoint overrides. It has no implicit API-key fallback.

## Native RDP and VNC

Open Wave Settings → **Remote Desktops**. Choose a protocol, host, and actual TCP port (3389 for RDP; 5900 for VNC by default).

- RDP uses `xfreerdp3` or `xfreerdp`. Supply a username, optional domain, and password. The password goes only through the viewer's stdin, is cleared from the form after launch, and is not saved or placed in arguments or environment variables. Certificates are verified; `/cert:deny` rejects untrusted certificates. Install a trusted server certificate before connecting.
- VNC uses TigerVNC's `vncviewer`, with `host::port` notation. It handles authentication and security selection in its native window. IPv6 addresses are supported.
- The view shows running/closed viewer processes and a Disconnect control. A running process does not establish that authentication or a connection succeeded; inspect the viewer window.

On Fedora the relevant optional packages are `freerdp` and `tigervnc`. Have your administrator install missing system packages if needed; this change does not install them. A graphical desktop, Xwayland for xfreerdp when applicable, and network access to the destination are required. These sessions open native windows; they are not embedded inside a terminal widget. Credentials and connection profiles are not persisted by the Remote Desktops form.

## Architecture and security

- `chatgpt/auth.go` owns public-client registration, PKCE S256, state/nonce checks, RS256 JWKS validation (issuer, audience, expiry, subject, nonce), granted-scope checks, serialized rotating refresh, account isolation, and revocation discovered from OpenAI's OIDC metadata.
- `chatgpt/store.go` uses Electron safeStorage in a separate `chatgpt.enc`, with atomic owner-only writes. Linux refuses `basic_text` or an unavailable keyring. Unlock KDE Wallet / an OS-backed secret store before connecting. Tokens are never returned by settings APIs, copied into `waveai.json`, or read from browser sessions or Codex's private authentication files.
- `chatgpt/process.go` supervises the official stdio app-server protocol. Wave passes the access token only in the child's `ACCESS_TOKEN`, filters unrelated credentials from its environment, suppresses child diagnostics, bounds JSON messages, and exposes sanitized errors. Codex analytics and OTEL exporters are disabled.
- `usechat-codex.go` maps streamed deltas into the existing Wave message protocol. Codex processes start only for selected-provider requests or catalog loading and stop after each operation; subsequent operations initialize a new process and resume the saved thread. This also refreshes the child token after renewal.
- Separate per-account `CODEX_HOME` directories under Wave's data directory keep Codex configuration/history isolated. Local Wave UI history and thread IDs are owner-only files under `chatgpt-chats`. They contain conversation content, not credentials. As with existing Wave history, protect the OS account and data directory.
- Dynamic tools are exposed only in the `wave` namespace. Only currently registered Wave tools can execute, and Wave's existing verification and approval callbacks apply. Unknown tool calls and native approval requests are rejected. Codex shell, agents, MCP, browser, image-generation, plugin paths, and automatic host-skill discovery are disabled. Patch attempts remain constrained by the restricted read-only sandbox and rejected native approval requests. There is no unrestricted-agent option.
- Local settings and desktop-launch endpoints use Wave's existing authenticated HTTP wrapper. Remote desktops run with argument arrays rather than shell strings. No certificate or TLS verification is disabled.

## Supported inputs and limitations

Text, inline text attachments, images, and Wave widget tools are supported through documented app-server RPC. PDF/binary attachments are rejected with a clear message because app-server input does not expose arbitrary Responses file inputs. Native web search, hosted tools, audio/video, and a Wave builder workflow are not provided by this adapter. Use another existing provider when those capabilities are needed. A stored thread retains the tool catalog from its first turn; tools absent from the current Wave context are rejected, so start a new chat after changing the available widgets/tools.

The adapter depends on experimental app-server dynamic-tool fields. Pin the tested Codex version and rerun protocol checks before upgrading. It does not implement an alternative private OAuth flow or use Codex's existing account credentials.

## Validation

Deterministic Go tests cover registration, consent refusal, state/nonce/signature/issuer/audience/expiry failures, refresh rotation, revoked sessions, account switching and restart, credential persistence failures, initialization, malformed messages, subprocess crashes, streaming, resume, cancellation, usage-limit handling, unauthorized tools, attachment restrictions, endpoint isolation, and native-viewer argument validation. Existing provider tests remain in place.

```sh
go test -race ./pkg/aiusechat/... ./pkg/remotedesktop ./pkg/telemetry ./pkg/wcloud ./pkg/web ./cmd/server
npm exec eslint -- frontend/app/view/waveconfig/waveaivisual.tsx \
  frontend/app/view/waveconfig/remotedesktop.tsx frontend/app/view/waveconfig/localapi.ts
npm run build:dev
```

An optional installed-CLI test initializes app-server, lists its catalog, and starts a local thread without inference or account credentials:

```sh
WAVE_CODEX_SMOKE=1 go test ./pkg/aiusechat/chatgpt -run TestInstalledCodexCatalog -v
```

**Optional real-account acceptance test (requires the user's explicit consent):** launch the app, personally authorize the browser consent flow, select a model, send a harmless message, confirm streamed output, send a follow-up, stop a response, restart Wave and continue, test a denied widget-write prompt, then sign out. This uses actual ChatGPT plan allowance. Automated tests never start a real-account login or send inference using an existing account. A successful mocked test or catalog listing does not prove subscription entitlement or a live response.

Official references consulted: [registration/sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [account lifecycle](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [Codex integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), and [app-server protocol](https://developers.openai.com/codex/app-server).
