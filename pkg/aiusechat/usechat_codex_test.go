package aiusechat

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatgpt"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

type codexTestStore struct{ data []byte }

func (s *codexTestStore) Load() ([]byte, error) { return s.data, nil }
func (s *codexTestStore) Save(b []byte) error   { s.data = b; return nil }
func setupCodexFixture(t *testing.T, scenario string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fixture")
	}
	root := t.TempDir()
	previous := wavebase.DataHome_VarCache
	wavebase.DataHome_VarCache = root
	t.Cleanup(func() { wavebase.DataHome_VarCache = previous })
	store := &codexTestStore{}
	store.data = []byte(`{"ext_agent_host_id":"test-host","active":"account","profiles":{"account":{"id":"account","client_id":"oaiapp_test","subject":"subject","access_token":"mock-secret","refresh_token":"refresh-secret","scopes":"chatgpt.tokens.use.direct","expires":"2099-01-01T00:00:00Z"}}}`)
	var data map[string]any
	_ = json.Unmarshal(store.data, &data)
	data["profiles"].(map[string]any)["other"] = map[string]any{"id": "other", "client_id": "oaiapp_other", "subject": "other", "access_token": "other-mock-secret", "refresh_token": "other-refresh-secret", "scopes": "chatgpt.tokens.use.direct", "expires": "2099-01-01T00:00:00Z"}
	store.data, _ = json.Marshal(data)
	old := chatgpt.Default
	chatgpt.Default = chatgpt.NewManager(store, func(string) error { return nil })
	t.Cleanup(func() { chatgpt.Default = old })
	log := filepath.Join(root, "protocol.jsonl")
	quoted, _ := json.Marshal(log)
	mode, _ := json.Marshal(scenario)
	fixture := `#!/usr/bin/env python3
import sys,json
log=` + string(quoted) + `
scenario=` + string(mode) + `
for line in sys.stdin:
 m=json.loads(line)
 with open(log,'a') as f:f.write(json.dumps(m)+'\n')
 method=m.get('method')
 def send(obj):print(json.dumps(obj),flush=True)
 if method=='initialize':send({'id':m['id'],'result':{'userAgent':'test'}})
 elif method in ['thread/start','thread/resume']:send({'id':m['id'],'result':{'thread':{'id':'thread-1'}}})
 elif method=='turn/start':
  send({'id':m['id'],'result':{'turn':{'id':'turn-1','status':'inProgress'}}})
  if scenario=='cancel':continue
  send({'method':'item/agentMessage/delta','params':{'threadId':'thread-1','turnId':'turn-1','itemId':'item-1','delta':'Hello '}})
  send({'method':'item/agentMessage/delta','params':{'threadId':'thread-1','turnId':'turn-1','itemId':'item-1','delta':'Wave'}})
  if scenario=='tool':
   send({'id':'tool-1','method':'item/tool/call','params':{'threadId':'thread-1','turnId':'turn-1','callId':'call-1','namespace':'wave','tool':'forbidden','arguments':{}}})
   continue
  status='failed' if scenario=='limit' else 'completed'
  send({'method':'turn/completed','params':{'threadId':'thread-1','turn':{'id':'turn-1','status':status,'error':{'message':'usage_limit mock-secret'}}}})
 elif method=='turn/interrupt':send({'id':m['id'],'result':{}})
 elif m.get('id')=='tool-1':
  send({'method':'turn/completed','params':{'threadId':'thread-1','turn':{'id':'turn-1','status':'completed'}}})
`
	binary := filepath.Join(root, "codex")
	if err := os.WriteFile(binary, []byte(fixture), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("WAVETERM_CODEX_BINARY", binary)
	return log
}
func runCodexTurn(t *testing.T, ctx context.Context, id string, tools ...uctypes.ToolDefinition) (string, error) {
	t.Helper()
	opts := uctypes.WaveChatOpts{ChatId: id, Config: uctypes.AIOptsType{APIType: CodexAPIType, Model: "test-model", Provider: ChatGPTProvider, Capabilities: []string{uctypes.AICapabilityTools}}, WidgetAccess: true, Tools: tools}
	msg := uctypes.AIMessage{MessageId: uuid.NewString(), Parts: []uctypes.AIMessagePart{{Type: "text", Text: "Hello"}}}
	w := &codexRecorder{httptest.NewRecorder()}
	h := sse.MakeSSEHandlerCh(w, ctx)
	err := WaveAIPostMessageWrap(ctx, h, &msg, opts)
	if err == nil && w.Header().Get("Content-Type") != sse.SSEContentType {
		t.Fatal("SSE was not initialized")
	}
	h.Close()
	return w.Body.String(), err
}
func TestCodexStreamResumeAndIsolation(t *testing.T) {
	log := setupCodexFixture(t, "success")
	id := uuid.NewString()
	defer chatstore.DefaultChatStore.Delete(id)
	output, err := runCodexTurn(t, context.Background(), id)
	if err != nil || !strings.Contains(output, `"delta":"Hello "`) || !strings.Contains(output, `"delta":"Wave"`) {
		t.Fatalf("stream failed: %v %s", err, output)
	}
	chatstore.DefaultChatStore.Delete(id)
	if err = RestoreCodexChat(id); err != nil {
		t.Fatal(err)
	}
	if chatstore.DefaultChatStore.CountUserMessages(id) != 1 {
		t.Fatal("history not restored")
	}
	if _, err = runCodexTurn(t, context.Background(), id); err != nil {
		t.Fatal(err)
	}
	protocol, _ := os.ReadFile(log)
	if !strings.Contains(string(protocol), `"method": "thread/resume"`) {
		t.Fatal("thread not resumed")
	}
	if strings.Contains(string(protocol), "mock-secret") {
		t.Fatal("token leaked into RPC")
	}
	c, _ := readCodexConversation(id)
	c.Account = "another-account"
	saveCodexConversation(id, c)
	if err = RestoreCodexChat(id); err == nil {
		t.Fatal("other account history exposed")
	}
}
func TestCodexCancellationAndUsageLimit(t *testing.T) {
	for _, scenario := range []string{"cancel", "limit"} {
		t.Run(scenario, func(t *testing.T) {
			setupCodexFixture(t, scenario)
			id := uuid.NewString()
			defer chatstore.DefaultChatStore.Delete(id)
			ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
			defer cancel()
			_, err := runCodexTurn(t, ctx, id)
			if err == nil {
				t.Fatal("failed/interrupted turn reported success")
			}
			if strings.Contains(err.Error(), "mock-secret") {
				t.Fatal("token leaked")
			}
			if scenario == "limit" && !strings.Contains(err.Error(), "usage limit") {
				t.Fatal(err)
			}
		})
	}
}
func TestCodexRejectsUnauthorizedTools(t *testing.T) {
	log := setupCodexFixture(t, "tool")
	id := uuid.NewString()
	defer chatstore.DefaultChatStore.Delete(id)
	_, err := runCodexTurn(t, context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(log)
	if !strings.Contains(string(b), "Operation is not allowed by Wave Terminal") {
		t.Fatal("unauthorized call not rejected")
	}
}
func TestSubscriptionDefaultsAndAttachments(t *testing.T) {
	c := wconfig.AIModeConfigType{Provider: ChatGPTProvider, APIToken: "must-be-ignored", Endpoint: "https://untrusted.test", APITokenSecretName: "OPENAI_KEY", ProxyURL: "http://untrusted.test"}
	applyProviderDefaults(&c)
	if c.Endpoint != "https://api.openai.com/v1" || c.APIToken != "" || c.APITokenSecretName != "" || c.ProxyURL != "" || c.APIType != CodexAPIType {
		t.Fatal("subscription credential route override accepted")
	}
	b := &codexBackend{}
	if _, err := b.ConvertAIMessageToNativeChatMessage(uctypes.AIMessage{Parts: []uctypes.AIMessagePart{{Type: "file", MimeType: "application/pdf", Data: []byte("pdf")}}}); err == nil {
		t.Fatal("unsupported attachment silently accepted")
	}
	if _, err := b.ConvertAIMessageToNativeChatMessage(uctypes.AIMessage{Parts: []uctypes.AIMessagePart{{Type: "file", MimeType: "image/png", Data: []byte("image")}, {Type: "file", MimeType: "text/plain", Data: []byte("text")}}}); err != nil {
		t.Fatal(err)
	}
}

type codexRecorder struct{ *httptest.ResponseRecorder }

func (*codexRecorder) SetWriteDeadline(time.Time) error { return nil }

func TestCodexWidgetApprovalBoundary(t *testing.T) {
	for _, approval := range []string{uctypes.ApprovalUserDenied, uctypes.ApprovalUserApproved} {
		t.Run(approval, func(t *testing.T) {
			setupCodexFixture(t, "tool")
			id := uuid.NewString()
			defer chatstore.DefaultChatStore.Delete(id)
			ran := false
			tool := uctypes.ToolDefinition{Name: "forbidden", Description: "A write tool requiring consent", InputSchema: map[string]any{"type": "object"}, ToolApproval: func(any) string { return uctypes.ApprovalNeedsApproval }, ToolTextCallback: func(any) (string, error) { ran = true; return "done", nil }}
			done := make(chan struct{})
			go func() {
				defer close(done)
				deadline := time.Now().Add(2 * time.Second)
				for time.Now().Before(deadline) {
					if _, exists := getToolApprovalRequest(id + ":call-1"); exists {
						_ = UpdateToolApproval(id+":call-1", approval)
						return
					}
					time.Sleep(time.Millisecond)
				}
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_, err := runCodexTurn(t, ctx, id, tool)
			<-done
			if err != nil {
				t.Fatal(err)
			}
			if ran != (approval == uctypes.ApprovalUserApproved) {
				t.Fatal("tool executed without required user approval")
			}
			chat := chatstore.DefaultChatStore.Get(id)
			input := (&codexBackend{}).GetFunctionCallInputByToolCallId(*chat, id+":call-1")
			if input == nil || input.ToolUseData == nil || input.ToolUseData.Approval != approval {
				t.Fatal("tool history/approval state not persisted")
			}
		})
	}
}

func TestAccountSwitchCancelsPendingToolApproval(t *testing.T) {
	setupCodexFixture(t, "tool")
	id := uuid.NewString()
	defer chatstore.DefaultChatStore.Delete(id)
	ran := false
	tool := uctypes.ToolDefinition{Name: "forbidden", InputSchema: map[string]any{"type": "object"}, ToolApproval: func(any) string { return uctypes.ApprovalNeedsApproval }, ToolTextCallback: func(any) (string, error) { ran = true; return "unexpected", nil }}
	switched := make(chan error, 1)
	go func() {
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			if _, exists := getToolApprovalRequest(id + ":call-1"); exists {
				switched <- chatgpt.Default.Select("other")
				return
			}
			time.Sleep(time.Millisecond)
		}
		switched <- context.DeadlineExceeded
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := runCodexTurn(t, ctx, id, tool)
	if switchErr := <-switched; switchErr != nil {
		t.Fatal(switchErr)
	}
	if err == nil || ran {
		t.Fatal("account switch did not stop the pending tool")
	}
}
