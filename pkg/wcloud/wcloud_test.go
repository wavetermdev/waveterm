package wcloud

import (
	"context"
	"net/http"
	"testing"
)

type rejectTransport struct{ calls int }

func (r *rejectTransport) RoundTrip(*http.Request) (*http.Response, error) {
	r.calls++
	panic("telemetry attempted an HTTP request")
}
func TestLegacyReportingCannotMakeNetworkRequests(t *testing.T) {
	transport := &rejectTransport{}
	old := http.DefaultTransport
	http.DefaultTransport = transport
	defer func() { http.DefaultTransport = old }()
	if err := SendAllTelemetry("test-client"); err != nil {
		t.Fatal(err)
	}
	if err := SendNoTelemetryUpdate(context.Background(), "test-client", true); err != nil {
		t.Fatal(err)
	}
	if err := SendDiagnosticPing(context.Background(), "test-client", true); err != nil {
		t.Fatal(err)
	}
	if transport.calls != 0 {
		t.Fatal("reporting is still active")
	}
}
