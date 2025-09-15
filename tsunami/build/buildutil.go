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

func copyDirRecursive(srcDir, destDir string, forceCreateDestDir bool) (int, error) {
	// Check if source directory exists
	srcInfo, err := os.Stat(srcDir)
	if err != nil {
		if os.IsNotExist(err) {
			if forceCreateDestDir {
				// Create destination directory even if source doesn't exist
				if err := os.MkdirAll(destDir, 0755); err != nil {
					return 0, fmt.Errorf("failed to create destination directory %s: %w", destDir, err)
				}
			}
			return 0, nil // Source doesn't exist, return 0 files copied
		}
		return 0, fmt.Errorf("error accessing source directory %s: %w", srcDir, err)
	}

	// Check if source is actually a directory
	if !srcInfo.IsDir() {
		return 0, fmt.Errorf("source %s is not a directory", srcDir)
	}

	fileCount := 0
	err = filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
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

func copyScaffoldSelective(scaffoldPath, destDir string) (int, error) {
	fileCount := 0

	// Create symlinks for node_modules directory
	symlinkItems := []string{"node_modules"}
	for _, item := range symlinkItems {
		srcPath := filepath.Join(scaffoldPath, item)
		destPath := filepath.Join(destDir, item)

		// Check if source exists
		if _, err := os.Stat(srcPath); err != nil {
			if os.IsNotExist(err) {
				continue // Skip if doesn't exist
			}
			return 0, fmt.Errorf("error checking %s: %w", item, err)
		}

		// Create symlink
		if err := os.Symlink(srcPath, destPath); err != nil {
			return 0, fmt.Errorf("failed to create symlink for %s: %w", item, err)
		}
		fileCount++
	}

	// Copy package files instead of symlinking
	packageFiles := []string{"package.json", "package-lock.json"}
	for _, fileName := range packageFiles {
		srcPath := filepath.Join(scaffoldPath, fileName)
		destPath := filepath.Join(destDir, fileName)

		// Check if source exists
		if _, err := os.Stat(srcPath); err != nil {
			if os.IsNotExist(err) {
				continue // Skip if doesn't exist
			}
			return 0, fmt.Errorf("error checking %s: %w", fileName, err)
		}

		// Copy file
		if err := copyFile(srcPath, destPath); err != nil {
			return 0, fmt.Errorf("failed to copy %s: %w", fileName, err)
		}
		fileCount++
	}

	// Copy dist directory that needs to be fully copied for go embed
	distSrcPath := filepath.Join(scaffoldPath, "dist")
	distDestPath := filepath.Join(destDir, "dist")
	dirCount, err := copyDirRecursive(distSrcPath, distDestPath, false)
	if err != nil {
		return 0, fmt.Errorf("failed to copy dist directory: %w", err)
	}
	fileCount += dirCount

	// Copy files by pattern (*.go, *.md, *.json, tailwind.css)
	patterns := []string{"*.go", "*.md", "*.json", "tailwind.css"}
	for _, pattern := range patterns {
		matches, err := filepath.Glob(filepath.Join(scaffoldPath, pattern))
		if err != nil {
			return 0, fmt.Errorf("failed to glob pattern %s: %w", pattern, err)
		}

		for _, srcPath := range matches {
			fileName := filepath.Base(srcPath)
			destPath := filepath.Join(destDir, fileName)

			if err := copyFile(srcPath, destPath); err != nil {
				return 0, fmt.Errorf("failed to copy %s: %w", fileName, err)
			}
			fileCount++
		}
	}

	return fileCount, nil
}

func CopyFileIfExists(srcPath, destPath string) (bool, error) {
	if _, err := os.Stat(srcPath); err == nil {
		if err := copyFile(srcPath, destPath); err != nil {
			return false, fmt.Errorf("failed to copy %s: %w", srcPath, err)
		}
		return true, nil
	} else if os.IsNotExist(err) {
		return false, nil
	} else {
		return false, fmt.Errorf("error checking %s: %w", srcPath, err)
	}
}
