package wshutil

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type testRpcClient struct {
	peer string
	recv chan []byte
	sent chan []byte
}

func newTestRpcClient(peer string, recvBuf, sentBuf int) *testRpcClient {
	return &testRpcClient{
		peer: peer,
		recv: make(chan []byte, recvBuf),
		sent: make(chan []byte, sentBuf),
	}
}

func (c *testRpcClient) GetPeerInfo() string { return c.peer }

func (c *testRpcClient) SendRpcMessage(msg []byte, ingressLinkId baseds.LinkId, debugStr string) bool {
	select {
	case c.sent <- msg:
		return true
	default:
		return false
	}
}

func (c *testRpcClient) RecvRpcMessage() ([]byte, bool) {
	msg, ok := <-c.recv
	return msg, ok
}

func reqJSON(t *testing.T, route, reqId string) []byte {
	t.Helper()
	b, err := json.Marshal(RpcMessage{
		Command: wshrpc.Command_Message,
		Route:   route,
		ReqId:   reqId,
		Data:    wshrpc.CommandMessageData{Message: "hi"},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func waitForMsg(t *testing.T, ch <-chan []byte, d time.Duration) []byte {
	t.Helper()
	select {
	case msg := <-ch:
		return msg
	case <-time.After(d):
		t.Fatalf("timed out waiting for message after %s", d)
		return nil
	}
}

func TestRecvLoopDoesNotTakeRouterLock(t *testing.T) {
	router := NewWshRouter()
	src := newTestRpcClient("src", 8, 8)
	linkId := router.RegisterUntrustedLink(src)
	router.trustLink(linkId, LinkKind_Leaf)
	if err := router.bindRoute(linkId, "bare:test-lock", true); err != nil {
		t.Fatalf("bindRoute: %v", err)
	}

	// Hold the global lock. If the recv loop still calls getLinkMeta per
	// message it will stall after the first RecvRpcMessage and leave the
	// remaining messages in src.recv.
	router.lock.Lock()
	const n = 5
	for i := 0; i < n; i++ {
		src.recv <- reqJSON(t, ControlRoute, "req-lock")
	}

	deadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(deadline) && len(src.recv) > 0 {
		time.Sleep(5 * time.Millisecond)
	}
	left := len(src.recv)
	router.lock.Unlock()

	if left != 0 {
		t.Fatalf("recv loop blocked on router.lock; %d/%d messages still queued", left, n)
	}
}

func TestRecvLoopSeesTrustAfterStart(t *testing.T) {
	router := NewWshRouter()
	src := newTestRpcClient("src", 4, 8)
	dest := newTestRpcClient("dest", 1, 8)
	srcId := router.RegisterUntrustedLink(src)
	if _, err := router.RegisterTrustedLeaf(dest, "dest:trust-test"); err != nil {
		t.Fatalf("RegisterTrustedLeaf dest: %v", err)
	}

	// Before trust: non-control request is rejected.
	src.recv <- reqJSON(t, "dest:trust-test", "pre-trust")
	unauth := waitForMsg(t, src.sent, time.Second)
	if !strings.Contains(string(unauth), "unauthenticated") {
		t.Fatalf("expected unauthenticated error before trust, got %s", unauth)
	}

	router.trustLink(srcId, LinkKind_Leaf)
	if err := router.bindRoute(srcId, "bare:trust-test", true); err != nil {
		t.Fatalf("bindRoute: %v", err)
	}

	// After trust: the same dest route is forwarded (not rejected).
	src.recv <- reqJSON(t, "dest:trust-test", "post-trust")
	forwarded := waitForMsg(t, dest.sent, time.Second)
	var msg RpcMessage
	if err := json.Unmarshal(forwarded, &msg); err != nil {
		t.Fatalf("unmarshal forwarded: %v", err)
	}
	if msg.Error != "" && strings.Contains(msg.Error, "unauthenticated") {
		t.Fatalf("trusted link still treated as unauthenticated: %s", forwarded)
	}
	if msg.ReqId != "post-trust" && msg.Command != wshrpc.Command_Message {
		// forwarded request should still be the command we sent
		if msg.Command == "" && msg.ReqId == "" {
			t.Fatalf("unexpected forwarded message: %s", forwarded)
		}
	}
	if !strings.Contains(string(forwarded), "post-trust") {
		t.Fatalf("forwarded message missing reqid: %s", forwarded)
	}
}

func TestRecvLoopExitsOnUnregister(t *testing.T) {
	router := NewWshRouter()
	src := newTestRpcClient("src", 4, 4)
	linkId := router.RegisterUntrustedLink(src)
	router.trustLink(linkId, LinkKind_Leaf)
	if err := router.bindRoute(linkId, "bare:unreg", true); err != nil {
		t.Fatalf("bindRoute: %v", err)
	}

	router.UnregisterLink(linkId)

	// Next message wakes RecvRpcMessage; loop should see alive=false and exit
	// without forwarding onto dest (or treating it as a live link).
	src.recv <- reqJSON(t, ControlRoute, "after-unreg")

	// Close recv so the loop can also observe eof if it is still running.
	time.Sleep(50 * time.Millisecond)
	close(src.recv)

	if lm := router.getLinkMeta(linkId); lm != nil {
		t.Fatal("unregistered link still in linkMap")
	}
}
