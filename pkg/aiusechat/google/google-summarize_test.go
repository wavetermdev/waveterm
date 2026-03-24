// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package google

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDetectMimeType(t *testing.T) {
	tests := []struct {
		name     string
		data     []byte
		expected string
	}{
		{
			name:     "plain text",
			data:     []byte("Hello, World!"),
			expected: "text/plain",
		},
		{
			name:     "empty file",
			data:     []byte{},
			expected: "text/plain",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectMimeType(tt.data)
			if !containsMimeType(result, tt.expected) {
				t.Errorf("detectMimeType() = %v, want to contain %v", result, tt.expected)
			}
		})
	}
}

func containsMimeType(got, want string) bool {
	// DetectContentType may return variations like "text/plain; charset=utf-8"
	return got == want || (want == "text/plain" && got == "text/plain; charset=utf-8")
}

func TestSummarizeFile_FileNotFound(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, _, err := SummarizeFile(ctx, "/nonexistent/file.txt", SummarizeOpts{
		APIKey: "fake-api-key",
		Mode:   ModeQuickSummary,
	})
	if err == nil {
		t.Error("SummarizeFile() expected error for nonexistent file, got nil")
	}
}

func TestSummarizeFile_BinaryFile(t *testing.T) {
	// Create a temporary binary file
	tmpDir := t.TempDir()
	binFile := filepath.Join(tmpDir, "test.bin")

	// Create binary data (not text, image, or PDF)
	binaryData := []byte{0x00, 0x01, 0x02, 0x03, 0x7F, 0x80, 0xFF}
	if err := os.WriteFile(binFile, binaryData, 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, _, err := SummarizeFile(ctx, binFile, SummarizeOpts{
		APIKey: "fake-api-key",
		Mode:   ModeQuickSummary,
	})
	if err == nil {
		t.Error("SummarizeFile() expected error for binary file, got nil")
	}
	if err != nil && !containsString(err.Error(), "binary data") {
		t.Errorf("SummarizeFile() error = %v, want error containing 'binary data'", err)
	}
}

func TestSummarizeFile_FileTooLarge(t *testing.T) {
	// Create a temporary text file that exceeds the limit
	tmpDir := t.TempDir()
	textFile := filepath.Join(tmpDir, "large.txt")

	// Create a file larger than 200KB (text file limit)
	largeData := make([]byte, 201*1024)
	for i := range largeData {
		largeData[i] = 'a'
	}
	if err := os.WriteFile(textFile, largeData, 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, _, err := SummarizeFile(ctx, textFile, SummarizeOpts{
		APIKey: "fake-api-key",
		Mode:   ModeQuickSummary,
	})
	if err == nil {
		t.Error("SummarizeFile() expected error for file too large, got nil")
	}
	if err != nil && !containsString(err.Error(), "exceeds maximum size") {
		t.Errorf("SummarizeFile() error = %v, want error containing 'exceeds maximum size'", err)
	}
}

func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		(len(s) > 0 && len(substr) > 0 && stringContains(s, substr)))
}

func stringContains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// Note: We don't test the actual API call without a real API key
// Integration tests would require setting GOOGLE_API_KEY environment variable
