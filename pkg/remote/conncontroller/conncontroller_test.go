// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"path/filepath"
	"testing"
)

func TestGetSshConfigFilesWindowsUsesNativeSystemConfig(t *testing.T) {
	homeDir := filepath.Join("C:", "Users", "wave")
	programData := filepath.Join("C:", "ProgramData")

	configFiles := getSshConfigFiles(homeDir, "windows", programData)

	expected := []string{
		filepath.Join(homeDir, ".ssh", "config"),
		filepath.Join(programData, "ssh", "ssh_config"),
	}
	if len(configFiles) != len(expected) {
		t.Fatalf("expected %d config files, got %d: %#v", len(expected), len(configFiles), configFiles)
	}
	for index, expectedFile := range expected {
		if configFiles[index] != expectedFile {
			t.Fatalf("configFiles[%d] = %q, expected %q", index, configFiles[index], expectedFile)
		}
	}
}

func TestGetSshConfigFilesWindowsSkipsUnixEtcConfig(t *testing.T) {
	homeDir := filepath.Join("C:", "Users", "wave")

	configFiles := getSshConfigFiles(homeDir, "windows", "")

	expected := []string{filepath.Join(homeDir, ".ssh", "config")}
	if len(configFiles) != len(expected) {
		t.Fatalf("expected %d config files, got %d: %#v", len(expected), len(configFiles), configFiles)
	}
	for index, expectedFile := range expected {
		if configFiles[index] != expectedFile {
			t.Fatalf("configFiles[%d] = %q, expected %q", index, configFiles[index], expectedFile)
		}
	}
}

func TestGetSshConfigFilesNonWindowsKeepsUnixEtcConfig(t *testing.T) {
	homeDir := filepath.Join("home", "wave")

	configFiles := getSshConfigFiles(homeDir, "linux", "")

	expected := []string{
		filepath.Join(homeDir, ".ssh", "config"),
		filepath.Join("/etc", "ssh", "config"),
	}
	if len(configFiles) != len(expected) {
		t.Fatalf("expected %d config files, got %d: %#v", len(expected), len(configFiles), configFiles)
	}
	for index, expectedFile := range expected {
		if configFiles[index] != expectedFile {
			t.Fatalf("configFiles[%d] = %q, expected %q", index, configFiles[index], expectedFile)
		}
	}
}
