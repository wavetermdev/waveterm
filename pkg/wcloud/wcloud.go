// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcloud

import (
	"context"
	"os"
)

// Compatibility entrypoints deliberately perform no network operations. This
// build sends neither analytics, opt-out notifications, nor diagnostic pings.
func CacheAndRemoveEnvVars() error {
	os.Unsetenv("WCLOUD_ENDPOINT")
	os.Unsetenv("WCLOUD_PING_ENDPOINT")
	return nil
}
func SendAllTelemetry(string) error                             { return nil }
func SendNoTelemetryUpdate(context.Context, string, bool) error { return nil }
func SendDiagnosticPing(context.Context, string, bool) error    { return nil }
