// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"testing"
)

func TestValidateWorkspaceDirectory(t *testing.T) {
	tests := []struct {
		name        string
		directory   string
		expectError bool
		errorMsg    string
	}{
		{
			name:        "empty directory is valid",
			directory:   "",
			expectError: false,
		},
		{
			name:        "valid absolute path",
			directory:   "/home/user/projects",
			expectError: false,
		},
		{
			name:        "valid home directory path",
			directory:   "~/projects",
			expectError: false,
		},
		{
			name:        "valid path with spaces",
			directory:   "/home/user/my projects",
			expectError: false,
		},
		{
			name:        "valid path with special characters",
			directory:   "/home/user/project-v1.0_final",
			expectError: false,
		},
		{
			name:        "valid Windows-style path",
			directory:   "C:\\Users\\user\\projects",
			expectError: false,
		},
		{
			name:        "directory with null byte at end is rejected",
			directory:   "/home/user\x00",
			expectError: true,
			errorMsg:    "invalid directory path: contains null byte",
		},
		{
			name:        "directory with null byte in middle is rejected",
			directory:   "/home/user\x00/malicious",
			expectError: true,
			errorMsg:    "invalid directory path: contains null byte",
		},
		{
			name:        "directory with embedded null byte",
			directory:   "valid\x00path",
			expectError: true,
			errorMsg:    "invalid directory path: contains null byte",
		},
		{
			name:        "directory with multiple null bytes",
			directory:   "\x00\x00\x00",
			expectError: true,
			errorMsg:    "invalid directory path: contains null byte",
		},
		{
			name:        "valid unicode path",
			directory:   "/home/用户/项目",
			expectError: false,
		},
		{
			name:        "valid path with emoji",
			directory:   "/home/user/📁projects",
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateWorkspaceDirectory(tt.directory)

			if tt.expectError {
				if err == nil {
					t.Errorf("expected error but got none")
					return
				}
				if err.Error() != tt.errorMsg {
					t.Errorf("expected error %q, got %q", tt.errorMsg, err.Error())
				}
				return
			}

			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}
