// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telemetry

import (
	"testing"
	"time"
)

func testCustomDaystr(t *testing.T, customDayStr string, expectedDayStr string, shouldErr bool) {
	rtn, err := GetCustomDayStr(customDayStr)
	if err != nil {
		if !shouldErr {
			t.Errorf("unexpected error: %v", err)
		}
	} else {
		if rtn != expectedDayStr {
			t.Errorf("for %q expected %q, got %q", customDayStr, expectedDayStr, rtn)
		}
	}
}

func TestDaystrCustom(t *testing.T) {
	now := time.Now()
	bom := now.AddDate(0, 0, -now.Day()+1)
	testCustomDaystr(t, "today", GetCurDayStr(), false)
	testCustomDaystr(t, "yesterday", GetRelDayStr(-1), false)
	testCustomDaystr(t, "bom", bom.Format("2006-01-02"), false)
	bow := now.AddDate(0, 0, -int(now.Weekday()))
	testCustomDaystr(t, "bow", bow.Format("2006-01-02"), false)
	testCustomDaystr(t, "today-1d", GetRelDayStr(-1), false)
	testCustomDaystr(t, "today+1d", GetRelDayStr(1), false)
	testCustomDaystr(t, "today-1w", GetRelDayStr(-7), false)
	day1 := bom.AddDate(0, 1, -1)
	testCustomDaystr(t, "bom+1m-1d", day1.Format("2006-01-02"), false)
	testCustomDaystr(t, "foo", "", true)
	testCustomDaystr(t, "2000-1-1", "", true)
	testCustomDaystr(t, "2024-01-01+1w", "2024-01-08", false)
	testCustomDaystr(t, "2024-01-01+1m+1w-1d", "2024-02-07", false)
}
