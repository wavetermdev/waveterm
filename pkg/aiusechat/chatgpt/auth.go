// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package chatgpt implements the documented public-client Sign in with ChatGPT flow.
// Credentials never cross a renderer API or use Codex's private auth files.
package chatgpt

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const AppName = "waveterm"
const PlanScope = "chatgpt.tokens.use.direct"
const Resource = "https://api.openai.com/v1"
const Issuer = "https://auth.openai.com"

// Store must write the complete credential set atomically with OS protection.
type Store interface {
	Load() ([]byte, error)
	Save([]byte) error
}
type profile struct {
	ID           string    `json:"id"`
	ClientID     string    `json:"client_id"`
	Subject      string    `json:"subject"`
	Email        string    `json:"email"`
	AccessToken  string    `json:"access_token,omitempty"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	IDToken      string    `json:"id_token,omitempty"`
	Scopes       string    `json:"scopes,omitempty"`
	Expires      time.Time `json:"expires"`
}
type credentials struct {
	HostID   string             `json:"ext_agent_host_id"`
	Active   string             `json:"active"`
	Profiles map[string]profile `json:"profiles"`
}
type Account struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	SignedIn  bool   `json:"signedIn"`
	PlanUsage bool   `json:"planUsage"`
}
type Status struct {
	Accounts []Account `json:"accounts"`
	Active   string    `json:"active"`
	Pending  bool      `json:"pending"`
	Message  string    `json:"message,omitempty"`
}
type pendingLogin struct {
	state, nonce, verifier, clientID, selected, redirect string
	server                                               *http.Server
	timer                                                *time.Timer
}
type Manager struct {
	mu                                        sync.Mutex
	store                                     Store
	client                                    *http.Client
	open                                      func(string) error
	issuer, authorize, token, jwks, discovery string
	loaded                                    bool
	data                                      credentials
	pending                                   *pendingLogin
	message                                   string
	session                                   context.Context
	cancel                                    context.CancelFunc
}

func NewManager(store Store, open func(string) error) *Manager {
	return &Manager{store: store, open: open, client: &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, issuer: Issuer, authorize: Issuer + "/api/accounts/authorize", token: Issuer + "/api/accounts/oauth/token", jwks: Issuer + "/.well-known/jwks.json", discovery: Issuer + "/.well-known/openid-configuration"}
}
func randomValue() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("secure randomness unavailable")
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func (m *Manager) load() error {
	if m.loaded {
		return nil
	}
	b, err := m.store.Load()
	if err != nil {
		return errors.New("ChatGPT credential store unavailable; unlock your OS keyring and retry")
	}
	d := credentials{HostID: "urn:uuid:" + uuid.NewString(), Profiles: make(map[string]profile)}
	if len(b) > 0 {
		if json.Unmarshal(b, &d) != nil || d.HostID == "" || d.Profiles == nil {
			return errors.New("invalid protected ChatGPT credential store")
		}
	}
	m.data = d
	m.loaded = true
	m.resetSession()
	return nil
}
func (m *Manager) resetSession() {
	if m.cancel != nil {
		m.cancel()
	}
	m.session, m.cancel = context.WithCancel(context.Background())
}
func (m *Manager) save(d credentials) error {
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	if err = m.store.Save(b); err != nil {
		return errors.New("could not save protected ChatGPT credentials")
	}
	m.data = d
	return nil
}
func (m *Manager) copyData() credentials {
	d := m.data
	d.Profiles = make(map[string]profile, len(m.data.Profiles))
	for k, v := range m.data.Profiles {
		d.Profiles[k] = v
	}
	return d
}
func hasScope(scopes, name string) bool {
	for _, s := range strings.Fields(scopes) {
		if s == name {
			return true
		}
	}
	return false
}
func (m *Manager) Status() (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.load(); err != nil {
		return Status{}, err
	}
	s := Status{Active: m.data.Active, Pending: m.pending != nil, Message: m.message, Accounts: []Account{}}
	for _, p := range m.data.Profiles {
		s.Accounts = append(s.Accounts, Account{p.ID, p.Email, p.RefreshToken != "", hasScope(p.Scopes, PlanScope)})
	}
	sort.Slice(s.Accounts, func(i, j int) bool { return s.Accounts[i].ID < s.Accounts[j].ID })
	return s, nil
}

// SignIn opens the system browser internally. No tokens are included in authorization URLs.
func (m *Manager) SignIn(selected string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.load(); err != nil {
		return err
	}
	if err := m.save(m.copyData()); err != nil {
		return err
	}
	m.stopPending()
	p := &pendingLogin{state: randomValue(), nonce: randomValue(), verifier: randomValue(), clientID: "dynamic_agent_client", selected: selected}
	var account profile
	if selected != "" {
		var ok bool
		account, ok = m.data.Profiles[selected]
		if !ok {
			return errors.New("unknown ChatGPT account")
		}
		p.clientID = account.ClientID
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return errors.New("cannot open ChatGPT loopback callback")
	}
	p.redirect = "http://" + listener.Addr().String() + "/auth/callback"
	p.server = &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { m.callback(p, w, r) }), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 30 * time.Second}
	digest := sha256.Sum256([]byte(p.verifier))
	q := url.Values{"client_id": {p.clientID}, "ext_agent_host_id": {m.data.HostID}, "response_type": {"code"}, "redirect_uri": {p.redirect}, "scope": {"openid profile email offline_access resource.invoke " + PlanScope}, "resource": {Resource}, "state": {p.state}, "nonce": {p.nonce}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(digest[:])}}
	if selected == "" {
		q.Set("agent_name_hint", AppName)
	} else {

		if account.Email != "" {
			q.Set("login_hint", account.Email)
		}
	}
	m.pending = p
	m.message = "Waiting for browser authorization"
	p.timer = time.AfterFunc(5*time.Minute, func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.pending == p {
			m.stopPending()
			m.message = "Sign-in expired; try again"
		}
	})
	go p.server.Serve(listener)
	if err = m.open(m.authorize + "?" + q.Encode()); err != nil {
		m.stopPending()
		return errors.New("could not open your browser for ChatGPT sign-in")
	}
	return nil
}
func (m *Manager) stopPending() {
	if m.pending == nil {
		return
	}
	p := m.pending
	m.pending = nil
	if p.timer != nil {
		p.timer.Stop()
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = p.server.Shutdown(ctx)
	}()
}
func (m *Manager) CancelLogin() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopPending()
	m.message = "Sign-in canceled"
}
func (m *Manager) callback(p *pendingLogin, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if r.Method != "GET" || r.URL.Path != "/auth/callback" {
		http.NotFound(w, r)
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	q := r.URL.Query()
	expected, _ := url.Parse(p.redirect)
	if m.pending != p || r.Host != expected.Host || subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(p.state)) != 1 {
		http.Error(w, "Invalid authorization state", 400)
		return
	}
	defer func() {
		if m.pending == p {
			m.stopPending()
		}
	}()
	fail := func(message string) { m.message = message; http.Error(w, message, 400) }
	if q.Get("error") != "" {
		fail("ChatGPT authorization declined; your existing account was unchanged")
		return
	}
	id := q.Get("client_id")
	if p.selected != "" {
		if id != "" && id != p.clientID {
			fail("ChatGPT registration did not match the selected account")
			return
		}
		id = p.clientID
	}
	if id == "" || id == "dynamic_agent_client" || q.Get("code") == "" {
		fail("ChatGPT registration incomplete; try again")
		return
	}
	m.mu.Unlock()
	t, err := m.exchange(r.Context(), url.Values{"grant_type": {"authorization_code"}, "client_id": {id}, "code": {q.Get("code")}, "code_verifier": {p.verifier}, "redirect_uri": {p.redirect}, "resource": {Resource}})
	var claims jwt.MapClaims
	if err == nil {
		if t.RefreshToken == "" {
			err = errors.New("ChatGPT did not issue a renewable session; reconnect and grant offline access")
		} else {
			var verifyErr error
			claims, verifyErr = m.validateID(r.Context(), t.IDToken, id, p.nonce)
			if verifyErr != nil {
				err = errors.New("ChatGPT identity verification failed")
			}
		}
	}
	m.mu.Lock()
	if m.pending != p {
		if t.RefreshToken != "" {
			go m.revoke(context.Background(), profile{ClientID: id, RefreshToken: t.RefreshToken})
		}
		http.Error(w, "Authorization attempt canceled; return to Wave", 400)
		return
	}
	if err != nil {
		fail(err.Error())
		return
	}
	sub, _ := claims["sub"].(string)
	email, _ := claims["email"].(string)
	if p.selected != "" && m.data.Profiles[p.selected].Subject != sub {
		fail("ChatGPT account did not match the selected registration")
		return
	}
	digest := sha256.Sum256([]byte(id + "\x00" + sub))
	key := hex.EncodeToString(digest[:16])
	record := profile{ID: key, ClientID: id, Subject: sub, Email: email, AccessToken: t.AccessToken, RefreshToken: t.RefreshToken, IDToken: t.IDToken, Scopes: t.Scope, Expires: time.Now().Add(time.Duration(t.ExpiresIn) * time.Second)}
	d := m.copyData()
	d.Profiles[key] = record
	d.Active = key
	if err = m.save(d); err != nil {
		fail(err.Error())
		return
	}
	m.resetSession()
	m.message = "Connected to ChatGPT"
	if !hasScope(t.Scope, PlanScope) {
		m.message = "Connected, but ChatGPT plan usage permission was not granted. Reconnect and grant plan usage to chat."
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprint(w, m.message+"\nYou can return to Wave Terminal.")
}

type tokenReply struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	Error        string `json:"error"`
}

func (m *Manager) exchange(ctx context.Context, values url.Values) (tokenReply, error) {
	var t tokenReply
	req, _ := http.NewRequestWithContext(ctx, "POST", m.token, strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := m.client.Do(req)
	if err != nil {
		return t, errors.New("ChatGPT token service unavailable; try reconnecting")
	}
	defer resp.Body.Close()
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&t) != nil {
		return t, errors.New("invalid ChatGPT token response")
	}
	if resp.StatusCode != 200 || t.Error != "" {
		if t.Error == "invalid_grant" {
			return t, errors.New("ChatGPT session expired or revoked; sign in again")
		}
		return t, errors.New("ChatGPT authorization failed; sign in again")
	}
	if t.AccessToken == "" || !strings.EqualFold(t.TokenType, "bearer") || t.ExpiresIn <= 0 || t.ExpiresIn > 7*24*3600 {
		return t, errors.New("incomplete ChatGPT token response")
	}
	return t, nil
}
func (m *Manager) validateID(ctx context.Context, raw, clientID, nonce string) (jwt.MapClaims, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", m.jwks, nil)
	resp, err := m.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var keys struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
			Use string `json:"use"`
			Alg string `json:"alg"`
		} `json:"keys"`
	}
	if resp.StatusCode != 200 || json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&keys) != nil {
		return nil, errors.New("JWKS unavailable")
	}
	parsed, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		for _, k := range keys.Keys {
			if kid != "" && k.Kid == kid && k.Kty == "RSA" && (k.Use == "" || k.Use == "sig") && (k.Alg == "" || k.Alg == "RS256") {
				n, e1 := base64.RawURLEncoding.DecodeString(k.N)
				e, e2 := base64.RawURLEncoding.DecodeString(k.E)
				if e1 != nil || e2 != nil || len(e) > 4 || len(n) < 256 {
					break
				}
				exp := int(new(big.Int).SetBytes(e).Int64())
				if exp < 3 {
					break
				}
				return &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exp}, nil
			}
		}
		return nil, errors.New("unknown signing key")
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(m.issuer), jwt.WithAudience(clientID), jwt.WithExpirationRequired(), jwt.WithIssuedAt())
	if err != nil || !parsed.Valid {
		return nil, errors.New("invalid ID token")
	}
	claims := parsed.Claims.(jwt.MapClaims)
	audiences, _ := claims.GetAudience()
	if len(audiences) > 1 {
		if claims["azp"] != clientID {
			return nil, errors.New("invalid authorized party")
		}
	}
	sub, _ := claims["sub"].(string)
	got, _ := claims["nonce"].(string)
	if sub == "" || (nonce != "" && subtle.ConstantTimeCompare([]byte(nonce), []byte(got)) != 1) {
		return nil, errors.New("invalid identity or nonce")
	}
	return claims, nil
}

// Token serializes rotating refreshes and returns a cancellation signal tied to the active account.
func (m *Manager) Token(ctx context.Context) (string, string, context.Context, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.load(); err != nil {
		return "", "", nil, err
	}
	p, ok := m.data.Profiles[m.data.Active]
	if !ok || p.RefreshToken == "" {
		return "", "", nil, errors.New("sign in with ChatGPT in Wave AI Modes")
	}
	if !hasScope(p.Scopes, PlanScope) {
		return "", "", nil, errors.New("ChatGPT plan usage permission is required; reconnect in Wave AI Modes")
	}
	if time.Until(p.Expires) < time.Minute {
		t, err := m.exchange(ctx, url.Values{"grant_type": {"refresh_token"}, "client_id": {p.ClientID}, "refresh_token": {p.RefreshToken}, "resource": {Resource}})
		if err != nil {
			return "", "", nil, err
		}
		if t.IDToken != "" {
			claims, e := m.validateID(ctx, t.IDToken, p.ClientID, "")
			if e != nil || claims["sub"] != p.Subject {
				return "", "", nil, errors.New("ChatGPT refresh identity mismatch; sign in again")
			}
			p.IDToken = t.IDToken
		}
		p.AccessToken = t.AccessToken
		if t.RefreshToken != "" {
			p.RefreshToken = t.RefreshToken
		}
		if t.Scope != "" {
			p.Scopes = t.Scope
		}
		p.Expires = time.Now().Add(time.Duration(t.ExpiresIn) * time.Second)
		d := m.copyData()
		d.Profiles[p.ID] = p
		if err = m.save(d); err != nil {
			return "", "", nil, err
		}
		if !hasScope(p.Scopes, PlanScope) {
			return "", "", nil, errors.New("ChatGPT plan usage permission was revoked; reconnect")
		}
	}
	return p.AccessToken, p.ID, m.session, nil
}
func (m *Manager) Select(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.load(); err != nil {
		return err
	}
	p, ok := m.data.Profiles[id]
	if !ok || p.RefreshToken == "" {
		return errors.New("sign in to this account first")
	}
	m.stopPending()
	d := m.copyData()
	d.Active = id
	if err := m.save(d); err != nil {
		return err
	}
	m.resetSession()
	m.message = "ChatGPT account selected; start a new chat when switching accounts"
	return nil
}
func (m *Manager) SignOut(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.load(); err != nil {
		return err
	}
	m.stopPending()
	p, ok := m.data.Profiles[id]
	if !ok {
		return errors.New("unknown ChatGPT account")
	}
	if m.data.Active == id {
		m.resetSession()
	}
	confirmed := p.RefreshToken == ""
	if !confirmed {
		confirmed = m.revoke(ctx, p)
	}
	p.AccessToken = ""
	p.RefreshToken = ""
	p.IDToken = ""
	p.Scopes = ""
	p.Expires = time.Time{}
	d := m.copyData()
	d.Profiles[id] = p
	if d.Active == id {
		d.Active = ""
	}
	if err := m.save(d); err != nil {
		return err
	}
	m.message = "Signed out"
	if !confirmed {
		m.message = "Signed out locally. Remote revocation was not confirmed; disconnect Wave in ChatGPT Settings → Usage."
	}
	return nil
}
func (m *Manager) revoke(ctx context.Context, p profile) bool {
	req, _ := http.NewRequestWithContext(ctx, "GET", m.discovery, nil)
	resp, err := m.client.Do(req)
	if err != nil {
		return false
	}
	var metadata struct {
		Revocation string `json:"revocation_endpoint"`
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&metadata)
	resp.Body.Close()
	if err != nil || resp.StatusCode != 200 {
		return false
	}
	u, err := url.Parse(metadata.Revocation)
	base, _ := url.Parse(m.issuer)
	if err != nil || u.Scheme != base.Scheme || u.Host != base.Host || u.User != nil {
		return false
	}
	values := url.Values{"token": {p.RefreshToken}, "token_type_hint": {"refresh_token"}, "client_id": {p.ClientID}}
	for attempt := 0; attempt < 2; attempt++ {
		req, _ = http.NewRequestWithContext(ctx, "POST", u.String(), strings.NewReader(values.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		resp, err = m.client.Do(req)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return true
			}
			if resp.StatusCode < 500 {
				return false
			}
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(200 * time.Millisecond):
		}
	}
	return false
}
