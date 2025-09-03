package build

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func IsDirOrNotFound(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // Not found is OK
		}
		return err // Other errors are not OK
	}

	if !info.IsDir() {
		return fmt.Errorf("%q exists but is not a directory", path)
	}

	return nil // It's a directory, which is OK
}

func CheckFileExists(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("file %q not found", path)
		}
		return fmt.Errorf("error accessing file %q: %w", path, err)
	}

	if info.IsDir() {
		return fmt.Errorf("%q is a directory, not a file", path)
	}

	return nil
}

func FileMustNotExist(path string) error {
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("%q must not exist", path)
	} else if !os.IsNotExist(err) {
		return err // Other errors are not OK
	}
	return nil // Not found is OK
}

func copyDirRecursive(srcDir, destDir string) (int, error) {
	fileCount := 0
	err := filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Calculate destination path
		relPath, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		destPath := filepath.Join(destDir, relPath)

		if info.IsDir() {
			// Create directory
			if err := os.MkdirAll(destPath, info.Mode()); err != nil {
				return err
			}
		} else {
			// Copy file
			if err := copyFile(path, destPath); err != nil {
				return err
			}
			fileCount++
		}

		return nil
	})

	return fileCount, err
}

func copyFile(srcPath, destPath string) error {
	// Get source file info for mode
	srcInfo, err := os.Stat(srcPath)
	if err != nil {
		return err
	}

	// Create destination directory if it doesn't exist
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return err
	}

	srcFile, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	destFile, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, srcFile)
	if err != nil {
		return err
	}

	// Set the same mode as source file
	return os.Chmod(destPath, srcInfo.Mode())
}

func listGoFilesInDir(dirPath string) ([]string, error) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory %s: %w", dirPath, err)
	}

	var goFiles []string
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".go" {
			goFiles = append(goFiles, entry.Name())
		}
	}

	return goFiles, nil
}
