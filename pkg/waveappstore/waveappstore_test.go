// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveappstore

import (
	"os"
	"path/filepath"
	"testing"
)

// setupTestDir creates a temporary test directory and sets it as the home directory
func setupTestDir(t *testing.T) (string, func()) {
	t.Helper()

	// Create a temporary directory for testing
	tmpDir, err := os.MkdirTemp("", "waveappstore-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	// Save the original HOME environment variable
	originalHome := os.Getenv("HOME")

	// Set the test directory as the home directory
	os.Setenv("HOME", tmpDir)

	// Return cleanup function
	cleanup := func() {
		os.RemoveAll(tmpDir)
		// Restore original home directory
		if originalHome != "" {
			os.Setenv("HOME", originalHome)
		} else {
			os.Unsetenv("HOME")
		}
	}

	return tmpDir, cleanup
}

// createTestApp creates a test app with a simple file
func createTestApp(t *testing.T, appId string) {
	t.Helper()

	appDir, err := GetAppDir(appId)
	if err != nil {
		t.Fatalf("failed to get app dir: %v", err)
	}

	if err := os.MkdirAll(appDir, 0755); err != nil {
		t.Fatalf("failed to create app dir: %v", err)
	}

	testFile := filepath.Join(appDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}
}

// appExists checks if an app directory exists
func appExists(t *testing.T, appId string) bool {
	t.Helper()

	appDir, err := GetAppDir(appId)
	if err != nil {
		t.Fatalf("failed to get app dir: %v", err)
	}

	_, err = os.Stat(appDir)
	return err == nil
}

func TestRenameLocalApp_LocalOnly(t *testing.T) {
	_, cleanup := setupTestDir(t)
	defer cleanup()

	// Create a local app
	createTestApp(t, "local/testapp")

	// Rename the app
	err := RenameLocalApp("testapp", "renamedapp")
	if err != nil {
		t.Fatalf("RenameLocalApp failed: %v", err)
	}

	// Verify old app is gone
	if appExists(t, "local/testapp") {
		t.Error("old local app still exists")
	}

	// Verify new app exists
	if !appExists(t, "local/renamedapp") {
		t.Error("new local app does not exist")
	}

	// Verify draft app does not exist
	if appExists(t, "draft/testapp") {
		t.Error("old draft app should not exist")
	}
	if appExists(t, "draft/renamedapp") {
		t.Error("new draft app should not exist")
	}
}

func TestRenameLocalApp_DraftOnly(t *testing.T) {
	_, cleanup := setupTestDir(t)
	defer cleanup()

	// Create a draft app
	createTestApp(t, "draft/testapp")

	// Rename the app
	err := RenameLocalApp("testapp", "renamedapp")
	if err != nil {
		t.Fatalf("RenameLocalApp failed: %v", err)
	}

	// Verify old draft app is gone
	if appExists(t, "draft/testapp") {
		t.Error("old draft app still exists")
	}

	// Verify new draft app exists
	if !appExists(t, "draft/renamedapp") {
		t.Error("new draft app does not exist")
	}

	// Verify local app does not exist
	if appExists(t, "local/testapp") {
		t.Error("old local app should not exist")
	}
	if appExists(t, "local/renamedapp") {
		t.Error("new local app should not exist")
	}
}

func TestRenameLocalApp_BothLocalAndDraft(t *testing.T) {
	_, cleanup := setupTestDir(t)
	defer cleanup()

	// Create both local and draft apps
	createTestApp(t, "local/testapp")
	createTestApp(t, "draft/testapp")

	// Rename the app
	err := RenameLocalApp("testapp", "renamedapp")
	if err != nil {
		t.Fatalf("RenameLocalApp failed: %v", err)
	}

	// Verify old apps are gone
	if appExists(t, "local/testapp") {
		t.Error("old local app still exists")
	}
	if appExists(t, "draft/testapp") {
		t.Error("old draft app still exists")
	}

	// Verify new apps exist
	if !appExists(t, "local/renamedapp") {
		t.Error("new local app does not exist")
	}
	if !appExists(t, "draft/renamedapp") {
		t.Error("new draft app does not exist")
	}
}

func TestRenameLocalApp_NonExistentApp(t *testing.T) {
	_, cleanup := setupTestDir(t)
	defer cleanup()

	// Try to rename an app that doesn't exist
	err := RenameLocalApp("nonexistent", "newname")
	if err == nil {
		t.Fatal("expected error when renaming non-existent app, got nil")
	}

	expectedMsg := "does not exist"
	if err.Error() == "" || len(err.Error()) < len(expectedMsg) {
		t.Errorf("expected error message containing '%s', got: %v", expectedMsg, err)
	}
}

func TestRenameLocalApp_InvalidOldName(t *testing.T) {
	_, cleanup := setupTestDir(t)
	defer cleanup()

	// Try to rename with invalid old app name
	err := RenameLocalApp("invalid name with spaces", "newname")
	if err == nil {
		t.Fatal("expected error with invalid old app name, got nil")
	}
}

func TestRenameLocalApp_InvalidNewName(t *testing.T) {
	_, cleanup := setupTestDir(t)
	defer cleanup()

	// Create a local app
	createTestApp(t, "local/testapp")

	// Try to rename with invalid new app name
	err := RenameLocalApp("testapp", "invalid name with spaces")
	if err == nil {
		t.Fatal("expected error with invalid new app name, got nil")
	}

	// Verify original app still exists
	if !appExists(t, "local/testapp") {
		t.Error("original app should still exist after failed rename")
	}
}

func TestRenameLocalApp_ConflictWithExistingLocal(t *testing.T) {
	_, cleanup := setupTestDir(t)
	defer cleanup()

	// Create two local apps
	createTestApp(t, "local/testapp")
	createTestApp(t, "local/existingapp")

	// Try to rename to an existing app name
	err := RenameLocalApp("testapp", "existingapp")
	if err == nil {
		t.Fatal("expected error when renaming to existing app, got nil")
	}

	expectedMsg := "already exists"
	if err.Error() == "" || len(err.Error()) < len(expectedMsg) {
		t.Errorf("expected error message containing '%s', got: %v", expectedMsg, err)
	}

	// Verify both apps still exist unchanged
	if !appExists(t, "local/testapp") {
		t.Error("original app should still exist")
	}
	if !appExists(t, "local/existingapp") {
		t.Error("existing app should still exist")
	}
}

func TestRenameLocalApp_ConflictWithExistingDraft(t *testing.T) {
	_, cleanup := setupTestDir(t)
	defer cleanup()

	// Create a local app and a draft app with different names
	createTestApp(t, "local/testapp")
	createTestApp(t, "draft/existingapp")

	// Try to rename to an existing draft app name
	err := RenameLocalApp("testapp", "existingapp")
	if err == nil {
		t.Fatal("expected error when renaming to existing draft app, got nil")
	}

	expectedMsg := "already exists"
	if err.Error() == "" || len(err.Error()) < len(expectedMsg) {
		t.Errorf("expected error message containing '%s', got: %v", expectedMsg, err)
	}

	// Verify both apps still exist unchanged
	if !appExists(t, "local/testapp") {
		t.Error("original app should still exist")
	}
	if !appExists(t, "draft/existingapp") {
		t.Error("existing draft app should still exist")
	}
}

func TestRenameLocalApp_PreserveFileContents(t *testing.T) {
	_, cleanup := setupTestDir(t)
	defer cleanup()

	// Create a local app with specific content
	appId := "local/testapp"
	createTestApp(t, appId)

	// Write additional content
	err := WriteAppFile(appId, "config.json", []byte(`{"key": "value"}`))
	if err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	// Rename the app
	err = RenameLocalApp("testapp", "renamedapp")
	if err != nil {
		t.Fatalf("RenameLocalApp failed: %v", err)
	}

	// Verify the file contents are preserved
	newAppId := "local/renamedapp"
	fileData, err := ReadAppFile(newAppId, "config.json")
	if err != nil {
		t.Fatalf("failed to read config file from renamed app: %v", err)
	}

	expectedContent := `{"key": "value"}`
	if string(fileData.Contents) != expectedContent {
		t.Errorf("file contents not preserved, expected %q, got %q", expectedContent, string(fileData.Contents))
	}
}

func TestRenameLocalApp_EmptyAppName(t *testing.T) {
	_, cleanup := setupTestDir(t)
	defer cleanup()

	// Try to rename with empty old app name
	err := RenameLocalApp("", "newname")
	if err == nil {
		t.Fatal("expected error with empty old app name, got nil")
	}

	// Try to rename with empty new app name
	createTestApp(t, "local/testapp")
	err = RenameLocalApp("testapp", "")
	if err == nil {
		t.Fatal("expected error with empty new app name, got nil")
	}
}
