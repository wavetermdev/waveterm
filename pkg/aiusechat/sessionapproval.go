// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/util/logutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// SessionApprovalRegistry tracks paths that the user has approved for reading
// during the current session. This is in-memory only and resets when the app restarts.
type SessionApprovalRegistry struct {
	mu            sync.RWMutex
	approvedPaths map[string]bool // set of approved directory prefixes
}

var globalSessionApproval = &SessionApprovalRegistry{
	approvedPaths: make(map[string]bool),
}

// AddSessionReadApproval adds a directory path to the session-level read approval list.
// All files under this directory (and subdirectories) will be auto-approved for reading.
func AddSessionReadApproval(dirPath string) {
	expanded, err := wavebase.ExpandHomeDir(dirPath)
	if err != nil {
		expanded = dirPath
	}
	cleaned := filepath.Clean(expanded)
	if !strings.HasSuffix(cleaned, string(filepath.Separator)) {
		cleaned += string(filepath.Separator)
	}
	logutil.DevPrintf("session read approval added: %s\n", cleaned)
	globalSessionApproval.mu.Lock()
	defer globalSessionApproval.mu.Unlock()
	globalSessionApproval.approvedPaths[cleaned] = true
}

// isSensitivePath checks if a path is or falls under a sensitive directory
// that should never be auto-approved, even with session approval.
func isSensitivePath(expandedPath string) bool {
	homeDir := os.Getenv("HOME")
	if homeDir == "" {
		homeDir = os.Getenv("USERPROFILE")
	}
	cleanPath := filepath.Clean(expandedPath)

	sensitiveDirs := []string{
		filepath.Join(homeDir, ".ssh"),
		filepath.Join(homeDir, ".aws"),
		filepath.Join(homeDir, ".gnupg"),
		filepath.Join(homeDir, ".password-store"),
		filepath.Join(homeDir, ".secrets"),
		filepath.Join(homeDir, ".kube"),
		filepath.Join(homeDir, "Library", "Keychains"),
		"/Library/Keychains",
		"/etc/sudoers.d",
	}

	for _, dir := range sensitiveDirs {
		dirWithSep := dir + string(filepath.Separator)
		if cleanPath == dir || strings.HasPrefix(cleanPath, dirWithSep) {
			return true
		}
	}

	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		credPath := filepath.Join(localAppData, "Microsoft", "Credentials")
		if cleanPath == credPath || strings.HasPrefix(cleanPath, credPath+string(filepath.Separator)) {
			return true
		}
	}
	if appData := os.Getenv("APPDATA"); appData != "" {
		credPath := filepath.Join(appData, "Microsoft", "Credentials")
		if cleanPath == credPath || strings.HasPrefix(cleanPath, credPath+string(filepath.Separator)) {
			return true
		}
	}

	return false
}

// IsSessionReadApproved checks if a file path falls under any session-approved directory.
// Sensitive paths (e.g. ~/.ssh, ~/.aws) are never auto-approved.
func IsSessionReadApproved(filePath string) bool {
	cleaned := filepath.Clean(filePath)
	if isSensitivePath(cleaned) {
		return false
	}
	globalSessionApproval.mu.RLock()
	defer globalSessionApproval.mu.RUnlock()
	for approvedDir := range globalSessionApproval.approvedPaths {
		if strings.HasPrefix(cleaned, approvedDir) || cleaned == strings.TrimSuffix(approvedDir, string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// GetSessionApprovedPaths returns a copy of all currently approved paths.
func GetSessionApprovedPaths() []string {
	globalSessionApproval.mu.RLock()
	defer globalSessionApproval.mu.RUnlock()
	paths := make([]string, 0, len(globalSessionApproval.approvedPaths))
	for p := range globalSessionApproval.approvedPaths {
		paths = append(paths, p)
	}
	return paths
}

// ClearSessionApprovals removes all session-level read approvals.
func ClearSessionApprovals() {
	globalSessionApproval.mu.Lock()
	defer globalSessionApproval.mu.Unlock()
	globalSessionApproval.approvedPaths = make(map[string]bool)
}
