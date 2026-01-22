// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package build

import (
	"archive/zip"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
)

type DirFS struct {
	Root string
	fs.FS
}

func NewDirFS(root string) DirFS {
	return DirFS{Root: root, FS: os.DirFS(root)}
}

func (d DirFS) JoinOS(name string) string {
	return filepath.Join(d.Root, filepath.FromSlash(name))
}

func (d DirFS) Stat(name string) (fs.FileInfo, error)      { return fs.Stat(d.FS, name) }
func (d DirFS) ReadFile(name string) ([]byte, error)       { return fs.ReadFile(d.FS, name) }
func (d DirFS) ReadDir(name string) ([]fs.DirEntry, error) { return fs.ReadDir(d.FS, name) }
func (d DirFS) Glob(p string) ([]string, error)            { return fs.Glob(d.FS, p) }

func pathToFS(path string) (fs.FS, bool, func() error, error) {
	if path == "" {
		return nil, false, nil, fmt.Errorf("directory path cannot be empty")
	}

	// Check if path exists
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil, fmt.Errorf("path %q does not exist", path)
		}
		return nil, false, nil, fmt.Errorf("error accessing path %q: %w", path, err)
	}

	// Check if it's a .tsapp file (zip archive)
	if strings.HasSuffix(path, ".tsapp") {
		if info.IsDir() {
			return nil, false, nil, fmt.Errorf("%q is a directory, but .tsapp files must be zip archives", path)
		}

		// Open as zip file
		zipReader, err := zip.OpenReader(path)
		if err != nil {
			return nil, false, nil, fmt.Errorf("failed to open .tsapp file %q as zip archive: %w", path, err)
		}

		// Return zip filesystem (not writable) with closer function
		return zipReader, false, zipReader.Close, nil
	}

	// Handle regular directories
	if !info.IsDir() {
		return nil, false, nil, fmt.Errorf("%q is not a directory", path)
	}

	// Check if directory is writable by checking permissions
	canWrite := info.Mode().Perm()&0200 != 0 // Check if owner has write permission

	return NewDirFS(path), canWrite, nil, nil
}

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

func copyFile(srcPath, destPath string) error {
	return CopyFileFromFS(os.DirFS("/"), strings.TrimPrefix(srcPath, "/"), destPath)
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

func CopyFileIfExists(fsys fs.FS, srcPath, destPath string) (bool, error) {
	if fileInfo, err := fs.Stat(fsys, srcPath); err == nil {
		if fileInfo.IsDir() {
			return false, fmt.Errorf("source path %s is a directory", srcPath)
		}
		if err := CopyFileFromFS(fsys, srcPath, destPath); err != nil {
			return false, fmt.Errorf("failed to copy %s: %w", srcPath, err)
		}
		return true, nil
	} else if os.IsNotExist(err) {
		return false, nil
	} else {
		return false, fmt.Errorf("error checking %s: %w", srcPath, err)
	}
}

func CopyFileFromFS(fsys fs.FS, srcPath, destPath string) error {
	// Open source file from filesystem
	srcFile, err := fsys.Open(srcPath)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	// Get source file info
	srcInfo, err := fs.Stat(fsys, srcPath)
	if err != nil {
		return err
	}

	// Create destination directory if it doesn't exist
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return err
	}

	// Create destination file
	destFile, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer destFile.Close()

	// Copy content
	_, err = io.Copy(destFile, srcFile)
	if err != nil {
		return err
	}

	// Set the same mode as source file
	return os.Chmod(destPath, srcInfo.Mode())
}

func checkFileExistsFS(fsys fs.FS, path string) error {
	info, err := fs.Stat(fsys, path)
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

func isDirOrNotFoundFS(fsys fs.FS, path string) error {
	info, err := fs.Stat(fsys, path)
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

func copyDirFromFS(fsys fs.FS, srcDir, destDir string, forceCreateDestDir bool) (int, error) {
	fileCount := 0

	// Check if source directory exists
	srcInfo, err := fs.Stat(fsys, srcDir)
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

	err = fs.WalkDir(fsys, srcDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Calculate destination path
		relPath, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		destPath := filepath.Join(destDir, relPath)

		if d.IsDir() {
			// Create directory with standard permissions (0755) regardless of source permissions
			// This is important when extracting from zip files which may have read-only dirs
			if err := os.MkdirAll(destPath, 0755); err != nil {
				return err
			}
		} else {
			// Copy file
			if err := CopyFileFromFS(fsys, path, destPath); err != nil {
				return err
			}
			fileCount++
		}

		return nil
	})

	return fileCount, err
}

func addFileToZipIfExists(zipWriter *zip.Writer, fsys fs.FS, fileName string, fileCount *int, verbose bool) error {
	if _, err := fs.Stat(fsys, fileName); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("error checking %s: %w", fileName, err)
	}

	if err := addFileToZip(zipWriter, fsys, fileName, fileName); err != nil {
		return err
	}

	*fileCount++
	if verbose {
		log.Printf("Added %s to package", fileName)
	}

	return nil
}

func addGoFilesToZip(zipWriter *zip.Writer, fsys fs.FS, fileCount *int, verbose bool) error {
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return fmt.Errorf("failed to read directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		if strings.HasSuffix(entry.Name(), ".go") {
			if err := addFileToZip(zipWriter, fsys, entry.Name(), entry.Name()); err != nil {
				return fmt.Errorf("failed to add %s: %w", entry.Name(), err)
			}

			*fileCount++
			if verbose {
				log.Printf("Added %s to package", entry.Name())
			}
		}
	}

	return nil
}

func addDirToZipIfExists(zipWriter *zip.Writer, fsys fs.FS, dirName string, fileCount *int, verbose bool) error {
	info, err := fs.Stat(fsys, dirName)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("error checking %s: %w", dirName, err)
	}

	if !info.IsDir() {
		return fmt.Errorf("%s exists but is not a directory", dirName)
	}

	return fs.WalkDir(fsys, dirName, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if !d.IsDir() {
			if err := addFileToZip(zipWriter, fsys, path, path); err != nil {
				return fmt.Errorf("failed to add file %s: %w", path, err)
			}

			*fileCount++
			if verbose {
				log.Printf("Added %s to package", path)
			}
		}

		return nil
	})
}

func addFileToZip(zipWriter *zip.Writer, fsys fs.FS, srcPath, destPath string) error {
	srcFile, err := fsys.Open(srcPath)
	if err != nil {
		return fmt.Errorf("failed to open source file %s: %w", srcPath, err)
	}
	defer srcFile.Close()

	info, err := fs.Stat(fsys, srcPath)
	if err != nil {
		return fmt.Errorf("failed to get file info for %s: %w", srcPath, err)
	}

	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return fmt.Errorf("failed to create zip header for %s: %w", srcPath, err)
	}

	header.Name = destPath

	destFile, err := zipWriter.CreateHeader(header)
	if err != nil {
		return fmt.Errorf("failed to create zip entry for %s: %w", destPath, err)
	}

	_, err = io.Copy(destFile, srcFile)
	if err != nil {
		return fmt.Errorf("failed to copy content for %s: %w", srcPath, err)
	}

	return nil
}
