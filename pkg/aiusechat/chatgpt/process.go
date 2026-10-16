// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatgpt

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RPCMessage is a bounded, newline-delimited Codex app-server protocol message.
type RPCMessage struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  json.RawMessage `json:"error,omitempty"`
}
type Process struct {
	cmd      *exec.Cmd
	in       io.WriteCloser
	messages chan RPCMessage
	done     chan struct{}
	mu       sync.Mutex
	next     int
	queued   []RPCMessage
	stop     sync.Once
}

func CodexArgs() []string {
	settings := []string{
		`model_provider="openai_chatgpt_plan"`,
		`model_providers.openai_chatgpt_plan.name="ChatGPT plan"`,
		`model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"`,
		`model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"`,
		`model_providers.openai_chatgpt_plan.wire_api="responses"`,
		`model_providers.openai_chatgpt_plan.requires_openai_auth=false`,
		`model_providers.openai_chatgpt_plan.supports_websockets=false`,
		`analytics.enabled=false`, `feedback.enabled=false`,
		`otel.exporter="none"`, `otel.trace_exporter="none"`, `otel.metrics_exporter="none"`,
		`otel.log_user_prompt=false`, `otel.log_agent_responses=false`,
		`sandbox_mode="read-only"`, `approval_policy="on-request"`,
		`web_search="disabled"`, `mcp_servers={}`,
		`shell_environment_policy.inherit="none"`, `project_doc_max_bytes=0`,
	}
	args := []string{"app-server", "--listen", "stdio://"}
	for _, s := range settings {
		args = append(args, "-c", s)
	}
	for _, f := range []string{"shell_tool", "unified_exec", "apply_patch_freeform", "multi_agent", "multi_agent_v2", "apps", "plugins", "browser_use", "computer_use", "image_generation", "view_image", "tool_search", "skill_search", "code_mode", "skill_mcp_dependency_install", "skill_env_var_dependency_prompt"} {
		args = append(args, "-c", "features."+f+"=false")
	}
	args = append(args, "-c", "features.skip_host_skill_discovery=true")
	return args
}
func Start(ctx context.Context, token, home string) (*Process, error) {
	binary := os.Getenv("WAVETERM_CODEX_BINARY")
	if binary == "" {
		binary = "codex"
	} else if !filepath.IsAbs(binary) || (filepath.Base(binary) != "codex" && filepath.Base(binary) != "codex.exe") {
		return nil, errors.New("WAVETERM_CODEX_BINARY must be an absolute path to the official codex executable")
	}
	path, err := exec.LookPath(binary)
	if err != nil {
		return nil, errors.New("Codex executable missing; install @openai/codex and restart Wave")
	}
	if err = os.MkdirAll(home, 0700); err != nil {
		return nil, errors.New("cannot create isolated Codex profile")
	}
	cmd := exec.Command(path, CodexArgs()...)
	cmd.Dir = home
	// Do not inherit API keys or other providers' credentials. Keep the platform's
	// proxy and CA trust so direct OpenAI inference works in managed environments.
	for _, name := range []string{"PATH", "HOME", "USERPROFILE", "USER", "LOGNAME", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"} {
		if v, ok := os.LookupEnv(name); ok {
			cmd.Env = append(cmd.Env, name+"="+v)
		}
	}
	cmd.Env = append(cmd.Env, "CODEX_HOME="+home, "ACCESS_TOKEN="+token)
	// Stderr can include diagnostics with sensitive request context; never relay it.
	cmd.Stderr = io.Discard
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		return nil, errors.New("could not start Codex app-server")
	}
	p := &Process{cmd: cmd, in: in, messages: make(chan RPCMessage, 128), done: make(chan struct{})}
	go func() {
		defer close(p.messages)
		scanner := bufio.NewScanner(out)
		scanner.Buffer(make([]byte, 65536), 8<<20)
		for scanner.Scan() {
			var msg RPCMessage
			if json.Unmarshal(scanner.Bytes(), &msg) != nil || ((msg.Method == "") && (len(msg.ID) == 0)) {
				break
			}
			select {
			case p.messages <- msg:
			case <-p.done:
				return
			}
		}
		p.Close()
	}()
	go func() { cmd.Wait(); p.Close() }()
	initCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err = p.Call(initCtx, "initialize", map[string]any{"clientInfo": map[string]string{"name": AppName, "title": "Wave Terminal", "version": "0.14.5"}, "capabilities": map[string]bool{"experimentalApi": true}}, nil); err != nil {
		p.Close()
		return nil, err
	}
	if err = p.Send(map[string]any{"method": "initialized"}); err != nil {
		p.Close()
		return nil, err
	}
	return p, nil
}
func (p *Process) Done() <-chan struct{} { return p.done }

func (p *Process) Close() { p.stop.Do(func() { close(p.done); p.in.Close(); p.cmd.Process.Kill() }) }
func (p *Process) Send(msg any) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	_, err = p.in.Write(append(b, '\n'))
	if err != nil {
		return errors.New("Codex app-server disconnected")
	}
	return nil
}
func (p *Process) Call(ctx context.Context, method string, params, result any) error {
	p.mu.Lock()
	p.next++
	id := p.next
	p.mu.Unlock()
	if err := p.Send(map[string]any{"id": id, "method": method, "params": params}); err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-p.messages:
			if !ok {
				return errors.New("Codex app-server exited unexpectedly")
			}
			if msg.Method == "" && string(msg.ID) == strconv.Itoa(id) {
				if len(msg.Error) > 0 && string(msg.Error) != "null" {
					return protocolError(msg.Error)
				}
				if result != nil && json.Unmarshal(msg.Result, result) != nil {
					return errors.New("invalid Codex response")
				}
				return nil
			}
			if len(p.queued) >= 128 {
				return errors.New("too many pending Codex notifications")
			}
			p.queued = append(p.queued, msg)
		}
	}
}
func (p *Process) Next(ctx context.Context) (RPCMessage, error) {
	if len(p.queued) > 0 {
		m := p.queued[0]
		p.queued = p.queued[1:]
		return m, nil
	}
	select {
	case <-ctx.Done():
		return RPCMessage{}, ctx.Err()
	case m, ok := <-p.messages:
		if !ok {
			return m, errors.New("Codex app-server exited unexpectedly")
		}
		return m, nil
	}
}
func protocolError(raw json.RawMessage) error {
	// Never pass arbitrary server error text to a renderer: it may contain tokens.
	lower := strings.ToLower(string(raw))
	switch {
	case strings.Contains(lower, "rate_limit"), strings.Contains(lower, "usage_limit"), strings.Contains(lower, "usage limit"), strings.Contains(lower, "usagelimit"), strings.Contains(lower, "rate limit"), strings.Contains(lower, "ratelimit"), strings.Contains(lower, "quota"):
		return errors.New("ChatGPT plan usage limit reached; review ChatGPT Settings → Usage and retry later")
	case strings.Contains(lower, "unauthorized"), strings.Contains(lower, "auth"), strings.Contains(lower, "401"):
		return errors.New("ChatGPT authorization expired or was revoked; reconnect in Wave AI Modes")
	case strings.Contains(lower, "model"):
		return errors.New("Selected model is unavailable for this ChatGPT account; choose another model")
	default:
		return errors.New("Codex request failed; check your connection, model access, and ChatGPT usage limits")
	}
}
func Error(raw json.RawMessage) error { return protocolError(raw) }
func (p *Process) Reject(msg RPCMessage) error {
	return p.Send(map[string]any{"id": msg.ID, "error": map[string]any{"code": -32601, "message": "Operation is not allowed by Wave Terminal"}})
}
