// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import "testing"

func TestMakeHTTPClientProxy(t *testing.T) {
	client, err := makeHTTPClient("http://localhost:8080")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client.Transport == nil {
		t.Fatalf("expected proxy transport to be set")
	}
}

func TestMakeHTTPClientInvalidProxy(t *testing.T) {
	_, err := makeHTTPClient("://bad-url")
	if err == nil {
		t.Fatalf("expected invalid proxy URL error")
	}
}
