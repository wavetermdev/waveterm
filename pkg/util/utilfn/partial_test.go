// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestTimeoutFromContext_ExpiredDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()
	time.Sleep(2 * time.Millisecond)
	timeout := TimeoutFromContext(ctx, 30*time.Second)
	if timeout != 0 {
		t.Fatalf("expected 0 for expired deadline, got %v", timeout)
	}
}

func TestTimeoutFromContext_CancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	timeout := TimeoutFromContext(ctx, 30*time.Second)
	if timeout != 0 {
		t.Fatalf("expected 0 for cancelled context, got %v", timeout)
	}
}

func TestTimeoutFromContext_NegativeDeadline(t *testing.T) {
	// Create a context with a deadline that's already passed
	past := time.Now().Add(-1 * time.Second)
	ctx, cancel := context.WithDeadline(context.Background(), past)
	defer cancel()
	timeout := TimeoutFromContext(ctx, 30*time.Second)
	if timeout != 0 {
		t.Fatalf("expected 0 for past deadline, got %v", timeout)
	}
}

func TestTimeoutFromContext_FutureDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	timeout := TimeoutFromContext(ctx, 30*time.Second)
	// Should be approximately 10s (with small tolerance for execution time)
	if timeout <= 0 || timeout > 10*time.Second {
		t.Fatalf("expected positive timeout <= 10s, got %v", timeout)
	}
}

func TestTimeoutFromContext_NoDeadline(t *testing.T) {
	ctx := context.Background()
	timeout := TimeoutFromContext(ctx, 30*time.Second)
	if timeout != 30*time.Second {
		t.Fatalf("expected default timeout 30s, got %v", timeout)
	}
}

func TestRepairJson(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "open bracket",
			input:    "[",
			expected: "[]",
		},
		{
			name:     "empty array",
			input:    "[]",
			expected: "[]",
		},
		{
			name:     "unclosed string in array",
			input:    `["a`,
			expected: `["a"]`,
		},
		{
			name:     "unclosed array with string",
			input:    `["a"`,
			expected: `["a"]`,
		},
		{
			name:     "unclosed array with number",
			input:    `[5`,
			expected: `[5]`,
		},
		{
			name:     "array with trailing comma",
			input:    `["a",`,
			expected: `["a"]`,
		},
		{
			name:     "array with unclosed second string",
			input:    `["a","`,
			expected: `["a",""]`,
		},
		{
			name:     "unclosed array with string and number",
			input:    `["a",5`,
			expected: `["a",5]`,
		},
		{
			name:     "open brace",
			input:    "{",
			expected: "{}",
		},
		{
			name:     "empty object",
			input:    "{}",
			expected: "{}",
		},
		{
			name:     "unclosed key",
			input:    `{"a`,
			expected: `{"a": null}`,
		},
		{
			name:     "key without colon",
			input:    `{"a"`,
			expected: `{"a": null}`,
		},
		{
			name:     "key with colon no value",
			input:    `{"a": `,
			expected: `{"a": null}`,
		},
		{
			name:     "unclosed object with number value",
			input:    `{"a": 5`,
			expected: `{"a": 5}`,
		},
		{
			name:     "unclosed object with true",
			input:    `{"a": true`,
			expected: `{"a": true}`,
		},
		// {
		// 	name:     "unclosed object with partial value",
		// 	input:    `{"a": fa`,
		// 	expected: `{"a": fa}`,
		// },
		{
			name:     "object with trailing comma",
			input:    `{"a": true,`,
			expected: `{"a": true}`,
		},
		{
			name:     "object with unclosed second key",
			input:    `{"a": true, "`,
			expected: `{"a": true, "": null}`,
		},
		{
			name:     "complete object",
			input:    `{"a": true, "b": false}`,
			expected: `{"a": true, "b": false}`,
		},
		{
			name:     "nested incomplete",
			input:    `[1, {"a": true, "b`,
			expected: `[1, {"a": true, "b": null}]`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := repairJson([]byte(tt.input))
			resultStr := string(result)

			if resultStr != tt.expected {
				t.Errorf("repairJson() of %s = %s, expected %s", tt.input, resultStr, tt.expected)
			}

			var parsed any
			err := json.Unmarshal(result, &parsed)
			if err != nil {
				t.Errorf("repaired JSON is not valid: %v\nInput: %q\nOutput: %q", err, tt.input, resultStr)
			}
		})
	}
}
