// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func TestReadDirCallback(t *testing.T) {
	// Create a temporary test directory
	tmpDir, err := os.MkdirTemp("", "readdir_test")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create test files and directories
	testFile1 := filepath.Join(tmpDir, "file1.txt")
	testFile2 := filepath.Join(tmpDir, "file2.log")
	testSubDir := filepath.Join(tmpDir, "subdir")

	if err := os.WriteFile(testFile1, []byte("test content 1"), 0644); err != nil {
		t.Fatalf("Failed to create test file 1: %v", err)
	}
	if err := os.WriteFile(testFile2, []byte("test content 2"), 0644); err != nil {
		t.Fatalf("Failed to create test file 2: %v", err)
	}
	if err := os.Mkdir(testSubDir, 0755); err != nil {
		t.Fatalf("Failed to create test subdir: %v", err)
	}

	// Test reading the directory
	input := map[string]any{
		"path": tmpDir,
	}

	result, err := readDirCallback(input, &uctypes.UIMessageDataToolUse{})
	if err != nil {
		t.Fatalf("readDirCallback failed: %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("Result is not a map")
	}

	// Verify the result contains expected fields
	if resultMap["path"] != tmpDir {
		t.Errorf("Expected path %q, got %q", tmpDir, resultMap["path"])
	}

	entryCount, ok := resultMap["entry_count"].(int)
	if !ok {
		t.Fatalf("entry_count is not an int")
	}
	if entryCount != 3 {
		t.Errorf("Expected 3 entries, got %d", entryCount)
	}

	entries, ok := resultMap["entries"].([]map[string]any)
	if !ok {
		t.Fatalf("entries is not a slice of maps")
	}

	// Check that we have the expected entries
	foundFiles := 0
	foundDirs := 0
	for _, entry := range entries {
		if entry["is_dir"].(bool) {
			foundDirs++
		} else {
			foundFiles++
		}
	}

	if foundFiles != 2 {
		t.Errorf("Expected 2 files, got %d", foundFiles)
	}
	if foundDirs != 1 {
		t.Errorf("Expected 1 directory, got %d", foundDirs)
	}
}

func TestReadDirOnFile(t *testing.T) {
	// Create a temporary test file
	tmpFile, err := os.CreateTemp("", "readdir_test_file")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())
	tmpFile.Close()

	// Test reading a file (should fail)
	input := map[string]any{
		"path": tmpFile.Name(),
	}

	_, err = readDirCallback(input, &uctypes.UIMessageDataToolUse{})
	if err == nil {
		t.Fatalf("Expected error when reading a file with read_dir, got nil")
	}

	expectedErrSubstr := "path is not a directory"
	if err.Error()[:len(expectedErrSubstr)] != expectedErrSubstr {
		t.Errorf("Expected error containing %q, got %q", expectedErrSubstr, err.Error())
	}
}

func TestReadDirMaxEntries(t *testing.T) {
	// Create a temporary test directory with many files
	tmpDir, err := os.MkdirTemp("", "readdir_test_max")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create 10 test files
	for i := 0; i < 10; i++ {
		testFile := filepath.Join(tmpDir, filepath.Base(tmpDir)+string(rune('a'+i))+".txt")
		if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
			t.Fatalf("Failed to create test file: %v", err)
		}
	}

	// Test reading with max_entries=5
	maxEntries := 5
	input := map[string]any{
		"path":        tmpDir,
		"max_entries": maxEntries,
	}

	result, err := readDirCallback(input, &uctypes.UIMessageDataToolUse{})
	if err != nil {
		t.Fatalf("readDirCallback failed: %v", err)
	}

	resultMap := result.(map[string]any)
	entryCount := resultMap["entry_count"].(int)
	totalEntries := resultMap["total_entries"].(int)

	if entryCount != maxEntries {
		t.Errorf("Expected %d entries, got %d", maxEntries, entryCount)
	}

	// Verify total_entries reports the original count, not the truncated count
	if totalEntries != 10 {
		t.Errorf("Expected total_entries to be 10, got %d", totalEntries)
	}

	if _, ok := resultMap["truncated"]; !ok {
		t.Error("Expected truncated field to be present")
	}

	// Verify the truncation message includes the correct total
	truncMsg, ok := resultMap["truncated_message"].(string)
	if !ok {
		t.Error("Expected truncated_message to be present")
	}
	expectedMsg := fmt.Sprintf("Directory listing truncated to %d entries (out of %d total)", maxEntries, 10)
	if !strings.Contains(truncMsg, expectedMsg[:len(expectedMsg)-1]) {
		t.Errorf("Expected truncated_message to contain %q, got %q", expectedMsg, truncMsg)
	}
}

func TestReadDirSortBeforeTruncate(t *testing.T) {
	// Create a temporary test directory
	tmpDir, err := os.MkdirTemp("", "readdir_test_sort")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create files with names that would sort alphabetically before directories
	// but we want directories to appear first
	for i := 0; i < 5; i++ {
		testFile := filepath.Join(tmpDir, fmt.Sprintf("a_file_%d.txt", i))
		if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
			t.Fatalf("Failed to create test file: %v", err)
		}
	}

	// Create directories with names that sort alphabetically after the files
	for i := 0; i < 3; i++ {
		testDir := filepath.Join(tmpDir, fmt.Sprintf("z_dir_%d", i))
		if err := os.Mkdir(testDir, 0755); err != nil {
			t.Fatalf("Failed to create test dir: %v", err)
		}
	}

	// Test with max_entries=5 (less than total of 8)
	// All 3 directories should still appear because they're sorted first
	maxEntries := 5
	input := map[string]any{
		"path":        tmpDir,
		"max_entries": maxEntries,
	}

	result, err := readDirCallback(input, &uctypes.UIMessageDataToolUse{})
	if err != nil {
		t.Fatalf("readDirCallback failed: %v", err)
	}

	resultMap := result.(map[string]any)
	entries := resultMap["entries"].([]map[string]any)

	// Count directories in the result
	dirCount := 0
	for _, entry := range entries {
		if entry["is_dir"].(bool) {
			dirCount++
		}
	}

	// All 3 directories should be present because sorting happens before truncation
	if dirCount != 3 {
		t.Errorf("Expected 3 directories in truncated results, got %d", dirCount)
	}

	// First 3 entries should be directories
	for i := 0; i < 3; i++ {
		if !entries[i]["is_dir"].(bool) {
			t.Errorf("Expected entry %d to be a directory, but it was a file", i)
		}
	}
}

func TestParseReadDirInput(t *testing.T) {
	// Test valid input
	input := map[string]any{
		"path": "/tmp/test",
	}

	params, err := parseReadDirInput(input)
	if err != nil {
		t.Fatalf("parseReadDirInput failed on valid input: %v", err)
	}

	if params.Path != "/tmp/test" {
		t.Errorf("Expected path '/tmp/test', got %q", params.Path)
	}

	if *params.MaxEntries != ReadDirDefaultMaxEntries {
		t.Errorf("Expected default max_entries %d, got %d", ReadDirDefaultMaxEntries, *params.MaxEntries)
	}

	// Test missing path
	input = map[string]any{}
	_, err = parseReadDirInput(input)
	if err == nil {
		t.Error("Expected error for missing path, got nil")
	}

	// Test invalid max_entries
	input = map[string]any{
		"path":        "/tmp/test",
		"max_entries": 0,
	}
	_, err = parseReadDirInput(input)
	if err == nil {
		t.Error("Expected error for max_entries < 1, got nil")
	}
}

func TestGetReadDirToolDefinition(t *testing.T) {
	toolDef := GetReadDirToolDefinition()

	if toolDef.Name != "read_dir" {
		t.Errorf("Expected tool name 'read_dir', got %q", toolDef.Name)
	}

	if toolDef.ToolLogName != "gen:readdir" {
		t.Errorf("Expected tool log name 'gen:readdir', got %q", toolDef.ToolLogName)
	}

	if toolDef.ToolAnyCallback == nil {
		t.Error("ToolAnyCallback should not be nil")
	}

	if toolDef.ToolApproval == nil {
		t.Error("ToolApproval should not be nil")
	}

	if toolDef.ToolCallDesc == nil {
		t.Error("ToolCallDesc should not be nil")
	}
}
