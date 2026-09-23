// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// parseDurationFlag parses a duration flag. Empty input returns defaultDur.
// Accepts Go duration strings ("30s", "5m", "1h") or a bare integer (seconds).
func parseDurationFlag(s string, defaultDur time.Duration) (time.Duration, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return defaultDur, nil
	}
	if d, err := time.ParseDuration(s); err == nil {
		if d <= 0 {
			return 0, fmt.Errorf("duration must be positive, got %q", s)
		}
		return d, nil
	}
	secs, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("invalid duration %q (use 30s, 5m, 1h, or an integer number of seconds)", s)
	}
	if secs <= 0 {
		return 0, fmt.Errorf("duration must be positive, got %q", s)
	}
	return time.Duration(secs) * time.Second, nil
}
