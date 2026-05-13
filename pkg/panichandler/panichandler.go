// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package panichandler

import (
	"fmt"
	"log"
	"runtime/debug"
)

// returns an error (wrapping the panic) if a panic occurred
func PanicHandler(debugStr string, recoverVal any) error {
	if recoverVal == nil {
		return nil
	}
	log.Printf("[panic] in %s: %v\n", debugStr, recoverVal)
	debug.PrintStack()
	if err, ok := recoverVal.(error); ok {
		return fmt.Errorf("panic in %s: %w", debugStr, err)
	}
	return fmt.Errorf("panic in %s: %v", debugStr, recoverVal)
}
