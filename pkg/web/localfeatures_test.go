package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/authkey"
)

func TestLocalFeatureEndpointsRequireAuthentication(t *testing.T) {
	t.Setenv(authkey.WaveAuthKeyEnv, "local-feature-test-only")
	if err := authkey.SetAuthKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
	for _, handler := range []WebFnType{handleChatGPT, handleRemoteDesktop} {
		for _, key := range []string{"", "wrong"} {
			r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/wave/test", strings.NewReader(`{"action":"signin"}`))
			r.Header.Set(authkey.AuthKeyHeader, key)
			w := httptest.NewRecorder()
			WebFnWrap(WebFnOpts{}, handler)(w, r)
			if w.Code != http.StatusUnauthorized {
				t.Fatal("unauthenticated request accepted")
			}
		}
	}
	r := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/wave/remote-desktop", nil)
	r.Header.Set(authkey.AuthKeyHeader, "local-feature-test-only")
	w := httptest.NewRecorder()
	WebFnWrap(WebFnOpts{}, handleRemoteDesktop)(w, r)
	if w.Code != 200 || w.Body.String() != "[]\n" {
		t.Fatalf("authenticated desktop status failed: %s", w.Body.String())
	}
}
