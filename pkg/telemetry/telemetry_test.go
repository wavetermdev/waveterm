package telemetry

import (
	"context"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"testing"
)

func TestTelemetryDoesNotInitializeStorage(t *testing.T) {
	if IsTelemetryEnabled() {
		t.Fatal("telemetry enabled")
	}
	if err := RecordTEvent(context.Background(), &telemetrydata.TEvent{}); err != nil {
		t.Fatal(err)
	}
	if err := UpdateActivity(context.Background(), wshrpc.ActivityUpdate{Startup: 1}); err != nil {
		t.Fatal(err)
	}
	events, err := GetNonUploadedTEvents(context.Background(), 100)
	if err != nil || len(events) != 0 {
		t.Fatal("telemetry queued")
	}
	activity, err := GetNonUploadedActivity(context.Background())
	if err != nil || len(activity) != 0 {
		t.Fatal("activity queued")
	}
}
