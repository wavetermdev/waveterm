// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package githubcopilot

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	CopilotTokenURL           = "https://api.github.com/copilot_internal/v2/token"
	DefaultCopilotAPIBaseURL  = "https://api.individual.githubcopilot.com"
	CopilotTokenRefreshMargin = 5 * time.Minute
)

// CopilotToken represents a short-lived Copilot API token obtained by exchanging a GitHub token.
type CopilotToken struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expires_at"` // unix timestamp in seconds
	BaseURL   string `json:"base_url"`   // derived from the proxy-ep field in the token
}

// IsUsable returns true if the token is still valid with a safety margin.
func (ct *CopilotToken) IsUsable() bool {
	if ct == nil || ct.Token == "" {
		return false
	}
	return time.Until(time.Unix(ct.ExpiresAt, 0)) > CopilotTokenRefreshMargin
}

var proxyEpRegex = regexp.MustCompile(`(?:^|;)\s*proxy-ep=([^;\s]+)`)

// deriveCopilotBaseURL extracts the API base URL from the Copilot token.
// The token contains semicolon-delimited key=value pairs, one of which is proxy-ep.
// We convert proxy.* to api.* to get the base URL.
func deriveCopilotBaseURL(token string) string {
	match := proxyEpRegex.FindStringSubmatch(token)
	if len(match) < 2 || match[1] == "" {
		return DefaultCopilotAPIBaseURL
	}
	proxyEp := strings.TrimSpace(match[1])
	// Remove scheme if present, then replace proxy. prefix with api.
	host := proxyEp
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	if strings.HasPrefix(strings.ToLower(host), "proxy.") {
		host = "api." + host[len("proxy."):]
	}
	if host == "" {
		return DefaultCopilotAPIBaseURL
	}
	return "https://" + host
}

// copilotTokenResponse is the JSON response from the Copilot token endpoint.
type copilotTokenResponse struct {
	Token     string `json:"token"`
	ExpiresAt any    `json:"expires_at"` // can be int or string
}

func parseExpiresAt(v any) (int64, error) {
	switch val := v.(type) {
	case float64:
		ts := int64(val)
		if ts > 10_000_000_000 {
			return ts / 1000, nil // was in milliseconds
		}
		return ts, nil
	case string:
		val = strings.TrimSpace(val)
		if val == "" {
			return 0, fmt.Errorf("empty expires_at string")
		}
		var ts int64
		_, err := fmt.Sscanf(val, "%d", &ts)
		if err != nil {
			return 0, fmt.Errorf("invalid expires_at string: %q", val)
		}
		if ts > 10_000_000_000 {
			return ts / 1000, nil
		}
		return ts, nil
	case nil:
		return 0, fmt.Errorf("missing expires_at")
	default:
		return 0, fmt.Errorf("unexpected expires_at type: %T", v)
	}
}

// ExchangeGitHubTokenForCopilotToken exchanges a GitHub personal access token (or OAuth token)
// for a short-lived Copilot API token via the GitHub Copilot internal endpoint.
func ExchangeGitHubTokenForCopilotToken(githubToken string) (*CopilotToken, error) {
	req, err := http.NewRequest(http.MethodGet, CopilotTokenURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create copilot token request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+githubToken)
	req.Header.Set("User-Agent", "WaveTerm")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("copilot token exchange request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read copilot token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("copilot token exchange failed (HTTP %d): %s", resp.StatusCode, string(bodyBytes))
	}

	var tokenResp copilotTokenResponse
	if err := json.Unmarshal(bodyBytes, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse copilot token response: %w", err)
	}

	if tokenResp.Token == "" {
		return nil, fmt.Errorf("copilot token response missing token field")
	}

	expiresAt, err := parseExpiresAt(tokenResp.ExpiresAt)
	if err != nil {
		return nil, fmt.Errorf("copilot token response: %w", err)
	}

	return &CopilotToken{
		Token:     tokenResp.Token,
		ExpiresAt: expiresAt,
		BaseURL:   deriveCopilotBaseURL(tokenResp.Token),
	}, nil
}

// CopilotTokenManager handles caching and refreshing of Copilot API tokens.
// Thread-safe.
type CopilotTokenManager struct {
	mu           sync.Mutex
	cachedToken  *CopilotToken
	githubToken  string
	refreshing   bool
}

var globalTokenManager = &CopilotTokenManager{}

// GetCopilotToken returns a valid Copilot API token, refreshing if necessary.
// githubToken is the user's GitHub token (PAT or OAuth access token).
func GetCopilotToken(githubToken string) (*CopilotToken, error) {
	return globalTokenManager.GetToken(githubToken)
}

func (m *CopilotTokenManager) GetToken(githubToken string) (*CopilotToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// If the github token changed, invalidate the cache
	if m.githubToken != githubToken {
		m.cachedToken = nil
		m.githubToken = githubToken
	}

	// Return cached token if still usable
	if m.cachedToken.IsUsable() {
		return m.cachedToken, nil
	}

	// Exchange for a new token
	log.Printf("githubcopilot: exchanging GitHub token for Copilot API token\n")
	token, err := ExchangeGitHubTokenForCopilotToken(githubToken)
	if err != nil {
		return nil, err
	}

	m.cachedToken = token
	log.Printf("githubcopilot: obtained Copilot API token, expires at %s, base URL: %s\n",
		time.Unix(token.ExpiresAt, 0).Format(time.RFC3339), token.BaseURL)
	return token, nil
}

// ResetCachedToken clears the cached token, forcing a refresh on next call.
func ResetCachedToken() {
	globalTokenManager.mu.Lock()
	defer globalTokenManager.mu.Unlock()
	globalTokenManager.cachedToken = nil
}

// CopilotModelInfo represents a model returned by the Copilot /models endpoint.
type CopilotModelInfo struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	OwnedBy string `json:"owned_by"`
}

type copilotModelsResponse struct {
	Data []CopilotModelInfo `json:"data"`
}

// FetchAvailableModels queries the Copilot API for the list of models available
// to the user's subscription. Returns the model IDs.
func FetchAvailableModels(githubToken string) ([]CopilotModelInfo, error) {
	// First get a valid Copilot token
	copilotToken, err := GetCopilotToken(githubToken)
	if err != nil {
		return nil, fmt.Errorf("token exchange for model discovery: %w", err)
	}

	modelsURL := copilotToken.BaseURL + "/models"
	req, err := http.NewRequest(http.MethodGet, modelsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating models request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+copilotToken.Token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Copilot-Integration-Id", "vscode-chat")
	req.Header.Set("Editor-Version", "WaveTerm/0.11.0")
	req.Header.Set("Editor-Plugin-Version", "CopilotChat/0.35.0")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("models request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading models response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("githubcopilot: models endpoint returned HTTP %d: %s\n", resp.StatusCode, string(bodyBytes))
		return nil, fmt.Errorf("models endpoint returned HTTP %d", resp.StatusCode)
	}

	var modelsResp copilotModelsResponse
	if err := json.Unmarshal(bodyBytes, &modelsResp); err != nil {
		return nil, fmt.Errorf("parsing models response: %w", err)
	}

	log.Printf("githubcopilot: discovered %d available models\n", len(modelsResp.Data))
	return modelsResp.Data, nil
}
