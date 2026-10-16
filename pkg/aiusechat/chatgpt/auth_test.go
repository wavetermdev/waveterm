package chatgpt

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type memoryStore struct {
	data []byte
	fail bool
}

func (s *memoryStore) Load() ([]byte, error) { return s.data, nil }
func (s *memoryStore) Save(b []byte) error {
	if s.fail {
		return fmt.Errorf("disk full")
	}
	s.data = append([]byte{}, b...)
	return nil
}

type authFixture struct {
	revokeSignal                     chan struct{}
	badSignature                     bool
	expectedNonce                    string
	m                                *Manager
	store                            *memoryStore
	server                           *httptest.Server
	key                              *rsa.PrivateKey
	opened                           string
	scopes                           string
	nonce, subject, audience, issuer string
	expired, revoked                 bool
	refreshCalls, revokeCalls        int
}

func fixture(t *testing.T) *authFixture {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &authFixture{revokeSignal: make(chan struct{}, 1), key: key, store: &memoryStore{}, scopes: "openid offline_access resource.invoke " + PlanScope, subject: "user-one"}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/keys":
			json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]any{{"kty": "RSA", "kid": "test", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(f.key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(f.key.E)).Bytes())}}})
		case "/token":
			r.ParseForm()
			if r.Form.Get("client_id") == "dynamic_agent_client" || r.Form.Get("resource") != Resource {
				t.Error("invalid exchange client/resource")
			}
			if r.Form.Get("grant_type") == "refresh_token" {
				f.refreshCalls++
				if f.revoked {
					w.WriteHeader(400)
					fmt.Fprint(w, `{"error":"invalid_grant"}`)
					return
				}
				json.NewEncoder(w).Encode(tokenReply{AccessToken: "new-access-secret", RefreshToken: "rotated-refresh-secret", ExpiresIn: 3600, TokenType: "Bearer"})
				return
			}
			if r.Form.Get("code_verifier") == "" {
				t.Error("PKCE missing")
			}
			nonce := f.expectedNonce
			if f.nonce != "" {
				nonce = f.nonce
			}
			aud := r.Form.Get("client_id")
			if f.audience != "" {
				aud = f.audience
			}
			iss := f.server.URL
			if f.issuer != "" {
				iss = f.issuer
			}
			expires := time.Now().Add(time.Hour)
			if f.expired {
				expires = time.Now().Add(-time.Hour)
			}
			token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"iss": iss, "sub": f.subject, "aud": aud, "exp": expires.Unix(), "nonce": nonce, "email": "person@example.test"})
			token.Header["kid"] = "test"
			signingKey := f.key
			if f.badSignature {
				signingKey, _ = rsa.GenerateKey(rand.Reader, 2048)
			}
			signed, _ := token.SignedString(signingKey)
			json.NewEncoder(w).Encode(tokenReply{AccessToken: "access-secret", RefreshToken: "refresh-secret", IDToken: signed, Scope: f.scopes, ExpiresIn: 3600, TokenType: "Bearer"})
		case "/discovery":
			json.NewEncoder(w).Encode(map[string]string{"revocation_endpoint": f.server.URL + "/revoke"})
		case "/revoke":
			f.revokeCalls++
			select {
			case f.revokeSignal <- struct{}{}:
			default:
			}
			r.ParseForm()
			if r.Form.Get("token_type_hint") != "refresh_token" || r.Form.Get("client_id") == "dynamic_agent_client" {
				t.Error("invalid revoke")
			}
			w.WriteHeader(200)
		default:
			http.NotFound(w, r)
		}
	}))
	f.m = NewManager(f.store, func(u string) error { f.opened = u; return nil })
	f.m.issuer = f.server.URL
	f.m.authorize = f.server.URL + "/authorize"
	f.m.token = f.server.URL + "/token"
	f.m.jwks = f.server.URL + "/keys"
	f.m.discovery = f.server.URL + "/discovery"
	t.Cleanup(func() { f.m.CancelLogin(); f.server.Close() })
	return f
}
func (f *authFixture) callback(t *testing.T, params url.Values) *httptest.ResponseRecorder {
	t.Helper()
	p := f.m.pending
	if p == nil {
		t.Fatal("no pending login")
	}
	f.expectedNonce = p.nonce
	params.Set("state", p.state)
	if params.Get("code") == "" && params.Get("error") == "" {
		params.Set("code", "mock-code")
	}
	if p.selected == "" && params.Get("client_id") == "" {
		params.Set("client_id", "oaiapp_test")
	}
	r := httptest.NewRequest("GET", p.redirect+"?"+params.Encode(), nil)
	w := httptest.NewRecorder()
	f.m.callback(p, w, r)
	return w
}
func (f *authFixture) login(t *testing.T) {
	t.Helper()
	if err := f.m.SignIn(""); err != nil {
		t.Fatal(err)
	}
	w := f.callback(t, url.Values{})
	if w.Code != 200 {
		t.Fatalf("callback: %s", w.Body.String())
	}
}
func TestRegistrationAndProtectedStatus(t *testing.T) {
	f := fixture(t)
	f.login(t)
	u, _ := url.Parse(f.opened)
	q := u.Query()
	if q.Get("client_id") != "dynamic_agent_client" || q.Get("agent_name_hint") != AppName || q.Get("code_challenge_method") != "S256" || q.Get("nonce") == "" || q.Get("state") == "" {
		t.Fatal("incomplete authorization request")
	}
	s, err := f.m.Status()
	if err != nil || len(s.Accounts) != 1 || !s.Accounts[0].PlanUsage {
		t.Fatal("account not authorized")
	}
	b, _ := json.Marshal(s)
	for _, secret := range []string{"access-secret", "refresh-secret", "id_token", "client_id"} {
		if strings.Contains(string(b), secret) {
			t.Fatal("status leaked credentials")
		}
	}
	token, _, _, err := f.m.Token(context.Background())
	if err != nil || token != "access-secret" {
		t.Fatal("token unavailable")
	}
	host := f.m.data.HostID
	id := s.Active
	if err = f.m.SignIn(id); err != nil {
		t.Fatal(err)
	}
	u, _ = url.Parse(f.opened)
	if u.Query().Get("client_id") != "oaiapp_test" || u.Query().Get("agent_name_hint") != "" || u.Query().Get("id_token_hint") != "" || u.Query().Get("ext_agent_host_id") != host {
		t.Fatal("registration not reused")
	}
}
func TestDeclinedPlanPermission(t *testing.T) {
	f := fixture(t)
	f.scopes = "openid offline_access"
	f.login(t)
	s, _ := f.m.Status()
	if s.Accounts[0].PlanUsage {
		t.Fatal("permission incorrectly enabled")
	}
	if _, _, _, err := f.m.Token(context.Background()); err == nil {
		t.Fatal("inference allowed without scope")
	}
}
func TestOAuthValidation(t *testing.T) {
	for _, name := range []string{"state", "nonce", "audience", "issuer", "expired", "signature", "declined", "client-mismatch"} {
		t.Run(name, func(t *testing.T) {
			f := fixture(t)
			if err := f.m.SignIn(""); err != nil {
				t.Fatal(err)
			}
			params := url.Values{}
			switch name {
			case "nonce":
				f.nonce = "wrong"
			case "audience":
				f.audience = "wrong"
			case "issuer":
				f.issuer = "https://wrong.test"
			case "expired":
				f.expired = true
			case "signature":
				f.badSignature = true
			case "declined":
				params.Set("error", "access_denied")
			case "client-mismatch":
				f.m.pending.selected = "known"
				f.m.pending.clientID = "oaiapp_original"
				params.Set("client_id", "oaiapp_other")
			case "state":
				p := f.m.pending
				r := httptest.NewRequest("GET", p.redirect+"?state=wrong&code=code&client_id=oaiapp_test", nil)
				w := httptest.NewRecorder()
				f.m.callback(p, w, r)
				if w.Code != 400 || f.m.pending == nil {
					t.Fatal("bad state accepted or valid attempt destroyed")
				}
				return
			}
			w := f.callback(t, params)
			if w.Code != 400 || f.m.data.Active != "" {
				t.Fatalf("invalid authorization accepted: %s", w.Body.String())
			}
		})
	}
}
func TestRefreshRevocationAndRestart(t *testing.T) {
	f := fixture(t)
	f.login(t)
	id := f.m.data.Active
	p := f.m.data.Profiles[id]
	p.Expires = time.Now()
	f.m.data.Profiles[id] = p
	token, _, session, err := f.m.Token(context.Background())
	if err != nil || token != "new-access-secret" || f.refreshCalls != 1 || f.m.data.Profiles[id].RefreshToken != "rotated-refresh-secret" {
		t.Fatal("refresh did not rotate atomically")
	}
	restored := NewManager(f.store, func(string) error { return nil })
	s, err := restored.Status()
	if err != nil || s.Active != id {
		t.Fatal("account not restored")
	}
	if err = f.m.SignOut(context.Background(), id); err != nil || f.revokeCalls != 1 {
		t.Fatal("revocation failed")
	}
	select {
	case <-session.Done():
	default:
		t.Fatal("sign-out did not cancel requests")
	}
	p = f.m.data.Profiles[id]
	if p.AccessToken != "" || p.RefreshToken != "" || p.IDToken != "" || p.ClientID == "" {
		t.Fatal("sign-out did not clear tokens and retain registration")
	}
	if _, _, _, err = f.m.Token(context.Background()); err == nil {
		t.Fatal("signed out session usable")
	}
	f.login(t)
	id = f.m.data.Active
	p = f.m.data.Profiles[id]
	p.Expires = time.Now()
	f.m.data.Profiles[id] = p
	f.revoked = true
	if _, _, _, err = f.m.Token(context.Background()); err == nil || !strings.Contains(err.Error(), "revoked") {
		t.Fatal("revoked session accepted")
	}
}
func TestSwitchingAndReturningIdentity(t *testing.T) {
	f := fixture(t)
	f.login(t)
	first := f.m.data.Active
	_, _, session, _ := f.m.Token(context.Background())
	f.subject = "user-two"
	f.login(t)
	second := f.m.data.Active
	if first == second {
		t.Fatal("accounts mixed")
	}
	select {
	case <-session.Done():
	default:
		t.Fatal("previous session not canceled")
	}
	if err := f.m.Select(first); err != nil {
		t.Fatal(err)
	}
	if err := f.m.SignIn(first); err != nil {
		t.Fatal(err)
	}
	w := f.callback(t, url.Values{})
	if w.Code != 400 || f.m.data.Active != first {
		t.Fatal("returning identity mismatch accepted")
	}
	if err := f.m.Select(second); err != nil {
		t.Fatal(err)
	}
}
func TestStorageFailureDoesNotActivateAccount(t *testing.T) {
	f := fixture(t)
	if err := f.m.SignIn(""); err != nil {
		t.Fatal(err)
	}
	f.store.fail = true
	w := f.callback(t, url.Values{})
	if w.Code != 400 || f.m.data.Active != "" {
		t.Fatal("activated unsaved credentials")
	}
}

type blockingTransport struct {
	base            http.RoundTripper
	started, resume chan struct{}
}

func (b *blockingTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Path == "/token" {
		close(b.started)
		<-b.resume
	}
	return b.base.RoundTrip(r)
}
func TestCancelDuringCodeExchangeDoesNotActivateAccount(t *testing.T) {
	f := fixture(t)
	transport := &blockingTransport{base: http.DefaultTransport, started: make(chan struct{}), resume: make(chan struct{})}
	f.m.client.Transport = transport
	if err := f.m.SignIn(""); err != nil {
		t.Fatal(err)
	}
	finished := make(chan *httptest.ResponseRecorder, 1)
	go func() { finished <- f.callback(t, url.Values{}) }()
	<-transport.started
	f.m.CancelLogin()
	close(transport.resume)
	w := <-finished
	if w.Code != 400 || f.m.data.Active != "" {
		t.Fatal("canceled login activated credentials")
	}
	select {
	case <-f.revokeSignal:
	case <-time.After(2 * time.Second):
		t.Fatal("canceled credentials were not revoked")
	}
}
