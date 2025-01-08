package daystr

import (
	"testing"
	"time"
)

func TestGetCurDayStr(t *testing.T) {
	expected := time.Now().Format("2006-01-02")
	result := GetCurDayStr()
	if result != expected {
		t.Errorf("GetCurDayStr() = %v; want %v", result, expected)
	}
}

func TestGetRelDayStr(t *testing.T) {
	expected := time.Now().AddDate(0, 0, 5).Format("2006-01-02")
	result := GetRelDayStr(5)
	if result != expected {
		t.Errorf("GetRelDayStr(5) = %v; want %v", result, expected)
	}

	expected = time.Now().AddDate(0, 0, -5).Format("2006-01-02")
	result = GetRelDayStr(-5)
	if result != expected {
		t.Errorf("GetRelDayStr(-5) = %v; want %v", result, expected)
	}
}

func TestGetCustomDayStr(t *testing.T) {
	tests := []struct {
		format   string
		expected string
	}{
		{"today", time.Now().Format("2006-01-02")},
		{"yesterday", time.Now().AddDate(0, 0, -1).Format("2006-01-02")},
		{"bom", time.Date(time.Now().Year(), time.Now().Month(), 1, 0, 0, 0, 0, time.Now().Location()).Format("2006-01-02")},
		{"bow", time.Now().AddDate(0, 0, -int(time.Now().Weekday())).Format("2006-01-02")},
		{"2025-04-01", "2025-04-01"},
		{"2025-04-01+1w", "2025-04-08"},
		{"2025-04-01+1w-1d", "2025-04-07"},
		{"2025-04-01+1m", "2025-05-01"},
		{"2025-04-01+1m-1d", "2025-04-30"},
	}

	for _, test := range tests {
		result, err := GetCustomDayStr(test.format)
		if err != nil {
			t.Errorf("GetCustomDayStr(%v) returned error: %v", test.format, err)
		}
		if result != test.expected {
			t.Errorf("GetCustomDayStr(%v) = %v; want %v", test.format, result, test.expected)
		}
	}

	invalidTests := []string{
		"invalid",
		"2025-04-01+1x",
		"2025-04-01+1m-1x",
	}

	for _, test := range invalidTests {
		_, err := GetCustomDayStr(test)
		if err == nil {
			t.Errorf("GetCustomDayStr(%v) expected error, got nil", test)
		}
	}
}
