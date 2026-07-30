// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: MIT

package openai

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

const testEndpoint = "https://test-gateway.example.com/v1/responses"

func makeTestChatOpts(provider, endpoint, apiToken, apiKeyHeader string) uctypes.WaveChatOpts {
	return uctypes.WaveChatOpts{
		ChatId:   "test-chat-id",
		ClientId: "test-client-id",
		Config: uctypes.AIOptsType{
			Provider:     provider,
			APIType:      uctypes.APIType_OpenAIResponses,
			Model:        "gpt-5-mini",
			APIToken:     apiToken,
			Endpoint:     endpoint,
			Capabilities: []string{uctypes.AICapabilityTools},
			APIKeyHeader: apiKeyHeader,
		},
	}
}

// TestBuildOpenAIHTTPRequest_AuthHeader_CustomHeader verifies that when
// ai:apikeyheader is set, the API token is sent using that header name
// (without "Bearer " prefix) and no Authorization header is set.
func TestBuildOpenAIHTTPRequest_AuthHeader_CustomHeader(t *testing.T) {
	chatOpts := makeTestChatOpts(uctypes.AIProvider_Custom, testEndpoint, "my-secret-key", "x-api-key")

	req, err := buildOpenAIHTTPRequest(context.Background(), []any{}, chatOpts, nil)
	if err != nil {
		t.Fatalf("buildOpenAIHTTPRequest returned error: %v", err)
	}

	if req.Header.Get("x-api-key") != "my-secret-key" {
		t.Errorf("expected x-api-key header to be 'my-secret-key', got %q", req.Header.Get("x-api-key"))
	}
	if req.Header.Get("Authorization") != "" {
		t.Errorf("expected no Authorization header, got %q", req.Header.Get("Authorization"))
	}
	// Verify Content-Type is still set
	if req.Header.Get("Content-Type") != "application/json" {
		t.Errorf("expected Content-Type to be 'application/json', got %q", req.Header.Get("Content-Type"))
	}
}

// TestBuildOpenAIHTTPRequest_AuthHeader_Default verifies that the default path
// (no custom header) still sets "Authorization: Bearer <token>".
func TestBuildOpenAIHTTPRequest_AuthHeader_Default(t *testing.T) {
	chatOpts := makeTestChatOpts(uctypes.AIProvider_Custom, testEndpoint, "my-secret-key", "")

	req, err := buildOpenAIHTTPRequest(context.Background(), []any{}, chatOpts, nil)
	if err != nil {
		t.Fatalf("buildOpenAIHTTPRequest returned error: %v", err)
	}

	if req.Header.Get("Authorization") != "Bearer my-secret-key" {
		t.Errorf("expected Authorization to be 'Bearer my-secret-key', got %q", req.Header.Get("Authorization"))
	}
	if req.Header.Get("x-api-key") != "" {
		t.Errorf("expected no x-api-key header, got %q", req.Header.Get("x-api-key"))
	}
}

// TestBuildOpenAIHTTPRequest_AuthHeader_Azure verifies that Azure providers
// still use the "api-key" header regardless of APIKeyHeader setting.
func TestBuildOpenAIHTTPRequest_AuthHeader_Azure(t *testing.T) {
	chatOpts := makeTestChatOpts(uctypes.AIProvider_Azure, testEndpoint, "my-azure-key", "x-api-key")

	req, err := buildOpenAIHTTPRequest(context.Background(), []any{}, chatOpts, nil)
	if err != nil {
		t.Fatalf("buildOpenAIHTTPRequest returned error: %v", err)
	}

	if req.Header.Get("api-key") != "my-azure-key" {
		t.Errorf("expected api-key header to be 'my-azure-key', got %q", req.Header.Get("api-key"))
	}
	if req.Header.Get("Authorization") != "" {
		t.Errorf("expected no Authorization header for Azure, got %q", req.Header.Get("Authorization"))
	}
	// APIKeyHeader should be ignored for Azure providers
	if req.Header.Get("x-api-key") != "" {
		t.Errorf("expected APIKeyHeader to be ignored for Azure, got x-api-key=%q", req.Header.Get("x-api-key"))
	}
}

// TestBuildOpenAIHTTPRequest_AuthHeader_AzureLegacy verifies that Azure Legacy
// providers use the "api-key" header.
func TestBuildOpenAIHTTPRequest_AuthHeader_AzureLegacy(t *testing.T) {
	chatOpts := makeTestChatOpts(uctypes.AIProvider_AzureLegacy, testEndpoint, "my-azure-legacy-key", "")

	req, err := buildOpenAIHTTPRequest(context.Background(), []any{}, chatOpts, nil)
	if err != nil {
		t.Fatalf("buildOpenAIHTTPRequest returned error: %v", err)
	}

	if req.Header.Get("api-key") != "my-azure-legacy-key" {
		t.Errorf("expected api-key header to be 'my-azure-legacy-key', got %q", req.Header.Get("api-key"))
	}
	if req.Header.Get("Authorization") != "" {
		t.Errorf("expected no Authorization header for Azure Legacy, got %q", req.Header.Get("Authorization"))
	}
}
