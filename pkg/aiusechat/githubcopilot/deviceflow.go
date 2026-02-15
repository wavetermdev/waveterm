// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package githubcopilot

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	GitHubCopilotClientID     = "Iv1.b507a08c87ecfe98"
	GitHubDeviceCodeURL       = "https://github.com/login/device/code"
	GitHubOAuthAccessTokenURL = "https://github.com/login/oauth/access_token"
	DeviceCodeGrantType       = "urn:ietf:params:oauth:grant-type:device_code"
)

// DeviceCodeResponse is the response from GitHub's device code endpoint.
type DeviceCodeResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

// AccessTokenResponse is the response from GitHub's OAuth access token endpoint.
type AccessTokenResponse struct {
	AccessToken string `json:"access_token,omitempty"`
	TokenType   string `json:"token_type,omitempty"`
	Scope       string `json:"scope,omitempty"`
	Error       string `json:"error,omitempty"`
}

// RequestDeviceCode initiates the OAuth device code flow by requesting a device code from GitHub.
func RequestDeviceCode(ctx context.Context) (*DeviceCodeResponse, error) {
	form := url.Values{}
	form.Set("client_id", GitHubCopilotClientID)
	form.Set("scope", "read:user")

	req, err := http.NewRequestWithContext(ctx, "POST", GitHubDeviceCodeURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("creating device code request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("requesting device code: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading device code response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("device code request failed (status %d): %s", resp.StatusCode, string(body))
	}

	var dcResp DeviceCodeResponse
	if err := json.Unmarshal(body, &dcResp); err != nil {
		return nil, fmt.Errorf("parsing device code response: %w", err)
	}

	return &dcResp, nil
}

// PollForAccessToken polls GitHub's OAuth token endpoint until the user completes
// authorization, the device code expires, or the context is cancelled.
// Returns the access token string on success.
func PollForAccessToken(ctx context.Context, deviceCode string, interval int, expiresIn int) (string, error) {
	if interval < 1 {
		interval = 5
	}

	deadline := time.Now().Add(time.Duration(expiresIn) * time.Second)

	for {
		if time.Now().After(deadline) {
			return "", fmt.Errorf("device code expired, please try again")
		}

		// Use a simple timer for the interval wait, but still respect cancellation
		timer := time.NewTimer(time.Duration(interval) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", ctx.Err()
		case <-timer.C:
		}

		// Each HTTP request gets its own 30-second timeout, independent of the
		// parent context, so that the RPC deadline doesn't kill poll requests.
		token, done, err := tryExchangeDeviceCode(deviceCode)
		if err != nil {
			return "", err
		}
		if done {
			return token, nil
		}
	}
}

// tryExchangeDeviceCode makes a single attempt to exchange the device code for an access token.
// Returns (token, true, nil) on success, ("", false, nil) if still pending, or ("", false, err) on failure.
func tryExchangeDeviceCode(deviceCode string) (string, bool, error) {
	// Use a per-request 30s timeout so the parent RPC context deadline
	// doesn't cause "context deadline exceeded" on individual poll requests.
	reqCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	form := url.Values{}
	form.Set("client_id", GitHubCopilotClientID)
	form.Set("device_code", deviceCode)
	form.Set("grant_type", DeviceCodeGrantType)

	req, err := http.NewRequestWithContext(reqCtx, "POST", GitHubOAuthAccessTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", false, fmt.Errorf("creating token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", false, fmt.Errorf("polling for access token: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", false, fmt.Errorf("reading token response: %w", err)
	}

	var tokenResp AccessTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", false, fmt.Errorf("parsing token response: %w", err)
	}

	switch tokenResp.Error {
	case "":
		if tokenResp.AccessToken != "" {
			return tokenResp.AccessToken, true, nil
		}
		return "", false, fmt.Errorf("empty access token in response")
	case "authorization_pending":
		return "", false, nil
	case "slow_down":
		// GitHub asks us to increase interval; we just wait an extra cycle
		return "", false, nil
	case "expired_token":
		return "", false, fmt.Errorf("device code expired, please try again")
	case "access_denied":
		return "", false, fmt.Errorf("user denied authorization")
	default:
		return "", false, fmt.Errorf("OAuth error: %s", tokenResp.Error)
	}
}
