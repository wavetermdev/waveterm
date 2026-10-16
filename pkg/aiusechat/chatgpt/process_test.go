package chatgpt

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestInstalledCodexCatalog(t *testing.T) {
	if os.Getenv("WAVE_CODEX_SMOKE") != "1" {
		t.Skip("set WAVE_CODEX_SMOKE=1 to test the installed Codex handshake/catalog without account credentials")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	p, err := Start(ctx, "not-an-account-token", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	var result struct {
		Data []struct {
			Model string `json:"model"`
		} `json:"data"`
	}
	if err = p.Call(ctx, "model/list", map[string]any{"limit": 10}, &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Data) == 0 {
		t.Fatal("empty model catalog")
	}
	var thread struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err = p.Call(ctx, "thread/start", map[string]any{"model": result.Data[0].Model, "modelProvider": "openai_chatgpt_plan", "sandbox": "read-only", "approvalPolicy": "on-request", "allowProviderModelFallback": false, "dynamicTools": []map[string]any{{"type": "namespace", "name": "wave", "description": "Test namespace", "tools": []map[string]any{{"type": "function", "name": "read_widget", "description": "Read a widget", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}}}}}}, &thread); err != nil {
		t.Fatal(err)
	}
	if thread.Thread.ID == "" {
		t.Fatal("no thread created")
	}
}
func TestProtocolMalformedExitAndErrorRedaction(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fixture")
	}
	for _, scenario := range []string{"bad-json", "exit", "error"} {
		t.Run(scenario, func(t *testing.T) {
			binary := filepath.Join(t.TempDir(), "codex")
			body := "#!/usr/bin/env python3\nimport sys,json\nfor line in sys.stdin:\n m=json.loads(line)\n if m.get('method')=='initialize':\n"
			switch scenario {
			case "bad-json":
				body += "  print('not-json',flush=True)\n  sys.exit(0)\n"
			case "exit":
				body += "  sys.exit(1)\n"
			case "error":
				body += "  print(json.dumps({'id':m['id'],'error':{'message':'authorization failed secret-access-token'}}),flush=True)\n"
			}
			if err := os.WriteFile(binary, []byte(body), 0700); err != nil {
				t.Fatal(err)
			}
			t.Setenv("WAVETERM_CODEX_BINARY", binary)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_, err := Start(ctx, "secret-access-token", t.TempDir())
			if err == nil {
				t.Fatal("broken server accepted")
			}
			if strings.Contains(err.Error(), "secret-access-token") {
				t.Fatal("token leaked in error")
			}
		})
	}
}
func TestProviderConfigurationDoesNotContainTokens(t *testing.T) {
	args := strings.Join(CodexArgs(), " ")
	for _, v := range []string{`base_url="https://api.openai.com/v1"`, `supports_websockets=false`, `analytics.enabled=false`, `otel.metrics_exporter="none"`, `features.shell_tool=false`, `features.multi_agent=false`, `shell_environment_policy.inherit="none"`} {
		if !strings.Contains(args, v) {
			t.Fatalf("missing safety setting %s", v)
		}
	}
	err := Error(json.RawMessage(`{"message":"rate_limit_exceeded ACCESS_TOKEN=secret"}`))
	if strings.Contains(err.Error(), "secret") || !strings.Contains(err.Error(), "usage limit") {
		t.Fatal("error not classified/redacted")
	}
}

func TestStructuredAndTextUsageLimitErrors(t *testing.T) {
	for _, raw := range []string{`{"codexErrorInfo":"usageLimitExceeded"}`, `{"message":"You have hit your usage limit"}`, `{"message":"rate limit reached"}`} {
		if err := Error(json.RawMessage(raw)); !strings.Contains(err.Error(), "usage limit") {
			t.Fatal(err)
		}
	}
}
