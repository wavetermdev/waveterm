// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package panichandler

import (
	"fmt"
	"log"
	"runtime/debug"
)

// to log NumPanics into the local telemetry system
// gets around import cycles
var PanicTelemetryHandler func()

func PanicHandlerNoTelemetry(debugStr string) {
	r := recover()
	if r == nil {
		return
	}
	log.Printf("[panic] in %s: %v\n", debugStr, r)
	debug.PrintStack()
}

// returns an error (wrapping the panic) if a panic occurred
func PanicHandler(debugStr string) error {
	r := recover()
	if r == nil {
		return nil
	}
	log.Printf("[panic] in %s: %v\n", debugStr, r)
	debug.PrintStack()
	if PanicTelemetryHandler != nil {
		go func() {
			defer PanicHandlerNoTelemetry("PanicTelemetryHandler")
			PanicTelemetryHandler()
		}()
	}
	if err, ok := r.(error); ok {
		return fmt.Errorf("panic in %s: %w", debugStr, err)
	}
	return fmt.Errorf("panic in %s: %v", debugStr, r)
}
