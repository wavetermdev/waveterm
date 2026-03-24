// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package filebackup

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const BackupRetentionPeriod = 5 * 24 * time.Hour

type BackupMetadata struct {
	FullPath  string `json:"fullpath"`
	Timestamp string `json:"timestamp"`
	Perm      string `json:"perm"`
}

func MakeFileBackup(absFilePath string) (string, error) {
	fileInfo, err := os.Stat(absFilePath)
	if err != nil {
		return "", fmt.Errorf("failed to stat file for backup: %w", err)
	}

	fileData, err := os.ReadFile(absFilePath)
	if err != nil {
		return "", fmt.Errorf("failed to read file for backup: %w", err)
	}

	dir := filepath.Dir(absFilePath)
	basename := filepath.Base(absFilePath)

	hash := sha256.Sum256([]byte(dir))
	dirHash8 := hex.EncodeToString(hash[:])[:8]

	uuidV7, err := uuid.NewV7()
	if err != nil {
		return "", fmt.Errorf("failed to generate UUID: %w", err)
	}
	uuidStr := uuidV7.String()

	now := time.Now()
	dateStr := now.Format("2006-01-02")

	backupDir := filepath.Join(wavebase.GetWaveCachesDir(), "waveai-backups", dateStr)
	err = os.MkdirAll(backupDir, 0700)
	if err != nil {
		return "", fmt.Errorf("failed to create backup directory: %w", err)
	}

	backupName := fmt.Sprintf("%s.%s.%s.bak", basename, dirHash8, uuidStr)
	backupPath := filepath.Join(backupDir, backupName)

	err = os.WriteFile(backupPath, fileData, 0600)
	if err != nil {
		return "", fmt.Errorf("failed to write backup file: %w", err)
	}

	metadata := BackupMetadata{
		FullPath:  absFilePath,
		Timestamp: now.Format(time.RFC3339),
		Perm:      fmt.Sprintf("%04o", fileInfo.Mode().Perm()),
	}

	metadataJSON, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal backup metadata: %w", err)
	}

	metadataName := fmt.Sprintf("%s.%s.%s.json", basename, dirHash8, uuidStr)
	metadataPath := filepath.Join(backupDir, metadataName)

	err = os.WriteFile(metadataPath, metadataJSON, 0600)
	if err != nil {
		return "", fmt.Errorf("failed to write backup metadata: %w", err)
	}

	return backupPath, nil
}

func RestoreBackup(backupFilePath string, restoreToFileName string) error {
	backupData, err := os.ReadFile(backupFilePath)
	if err != nil {
		return fmt.Errorf("failed to read backup file: %w", err)
	}

	metadataPath := backupFilePath[:len(backupFilePath)-4] + ".json"
	metadataData, err := os.ReadFile(metadataPath)
	if err != nil {
		return fmt.Errorf("failed to read backup metadata: %w", err)
	}

	var metadata BackupMetadata
	err = json.Unmarshal(metadataData, &metadata)
	if err != nil {
		return fmt.Errorf("failed to unmarshal backup metadata: %w", err)
	}

	if metadata.FullPath != restoreToFileName {
		return fmt.Errorf("backup metadata mismatch: expected %s, got %s", restoreToFileName, metadata.FullPath)
	}

	var perm os.FileMode
	_, err = fmt.Sscanf(metadata.Perm, "%o", &perm)
	if err != nil {
		return fmt.Errorf("failed to parse file permissions: %w", err)
	}

	err = os.WriteFile(restoreToFileName, backupData, perm)
	if err != nil {
		return fmt.Errorf("failed to restore file: %w", err)
	}

	return nil
}

func CleanupOldBackups() error {
	backupBaseDir := filepath.Join(wavebase.GetWaveCachesDir(), "waveai-backups")

	if _, err := os.Stat(backupBaseDir); os.IsNotExist(err) {
		return nil
	}

	entries, err := os.ReadDir(backupBaseDir)
	if err != nil {
		return fmt.Errorf("failed to read backup directory: %w", err)
	}

	cutoffTime := time.Now().Add(-BackupRetentionPeriod)
	var removedCount int

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		dirPath := filepath.Join(backupBaseDir, entry.Name())
		info, err := entry.Info()
		if err != nil {
			log.Printf("failed to get info for backup dir %s: %v\n", entry.Name(), err)
			continue
		}

		if info.ModTime().Before(cutoffTime) {
			err = os.RemoveAll(dirPath)
			if err != nil {
				log.Printf("failed to remove old backup dir %s: %v\n", entry.Name(), err)
			} else {
				removedCount++
			}
		}
	}

	if removedCount > 0 {
		log.Printf("cleaned up %d old backup directories\n", removedCount)
	}

	return nil
}
