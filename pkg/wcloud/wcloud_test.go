// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcloud

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestEventSending(t *testing.T) {
	originalClient := http.DefaultClient
	originalPingEndpoint := WCloudPingEndpoint_VarCache
	t.Cleanup(func() {
		http.DefaultClient = originalClient
		WCloudPingEndpoint_VarCache = originalPingEndpoint
	})
	WCloudPingEndpoint_VarCache = "https://ping.example.test/central"
	var requests []*http.Request
	var inputs []PingInputType
	http.DefaultClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests = append(requests, req)
		if req.Method != http.MethodPost || req.URL.Path != "/api"+PingUrl {
			t.Fatalf("unexpected request: %s %s", req.Method, req.URL.Path)
		}
		var input PingInputType
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		inputs = append(inputs, input)
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}

	ctx := context.Background()
	if count, err := sendTEvents("test-client"); err != nil || count != 0 {
		t.Fatalf("event batch returned (%d, %v), want (0, nil)", count, err)
	}
	if err := sendTelemetry("test-client"); err != nil {
		t.Fatal(err)
	}
	for _, disabled := range []bool{false, true} {
		if err := SendNoTelemetryUpdate(ctx, "test-client", disabled); err != nil {
			t.Fatal(err)
		}
	}
	if len(requests) != 0 {
		t.Fatalf("got %d requests with uploads disabled, want 0", len(requests))
	}

	for _, enabled := range []bool{false, true} {
		if err := SendDiagnosticPing(ctx, "test-client", enabled); err != nil {
			t.Fatal(err)
		}
	}
	if len(inputs) != 2 {
		t.Fatalf("got %d pings, want 2", len(inputs))
	}
	for i, input := range inputs {
		if input.ClientId != "test-client" || input.UsageTelemetry != (i == 1) {
			t.Errorf("ping %d did not preserve its input", i)
		}
		if input.Arch == "" || input.Version == "" || input.LocalDate == "" {
			t.Errorf("ping %d is missing app details", i)
		}
	}
}
