package build

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

type BuildOpts struct {
	Dir     string
	Verbose bool
}

func verifyTsunamiDir(dir string) error {
	if dir == "" {
		return fmt.Errorf("directory path cannot be empty")
	}

	// Check if directory exists
	info, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("directory %q does not exist", dir)
		}
		return fmt.Errorf("error accessing directory %q: %w", dir, err)
	}

	if !info.IsDir() {
		return fmt.Errorf("%q is not a directory", dir)
	}

	// Check for app.go file
	appGoPath := filepath.Join(dir, "app.go")
	if err := CheckFileExists(appGoPath); err != nil {
		return fmt.Errorf("app.go check failed in directory %q: %w", dir, err)
	}

	// Check static directory if it exists
	staticPath := filepath.Join(dir, "static")
	if err := IsDirOrNotFound(staticPath); err != nil {
		return fmt.Errorf("static directory check failed in %q: %w", dir, err)
	}

	// Check that dist doesn't exist
	distPath := filepath.Join(dir, "dist")
	if err := FileMustNotExist(distPath); err != nil {
		return fmt.Errorf("dist check failed in %q: %w", dir, err)
	}

	return nil
}

func TsunamiBuild(opts BuildOpts) error {
	if err := verifyTsunamiDir(opts.Dir); err != nil {
		return err
	}

	// Create temporary directory
	tempDir, err := os.MkdirTemp("", "tsunami-build-*")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}

	log.Printf("Building tsunami app from %s\n", opts.Dir)

	if opts.Verbose {
		log.Printf("Temp dir: %s\n", tempDir)
	}

	// Copy all *.go files from the root directory
	goCount, err := copyGoFiles(opts.Dir, tempDir)
	if err != nil {
		return fmt.Errorf("failed to copy go files: %w", err)
	}

	// Copy static directory
	staticCount, err := copyStaticDir(opts.Dir, tempDir)
	if err != nil {
		return fmt.Errorf("failed to copy static directory: %w", err)
	}

	// Create dist directory
	distDir := filepath.Join(tempDir, "dist")
	if err := os.MkdirAll(distDir, 0755); err != nil {
		return fmt.Errorf("failed to create dist directory: %w", err)
	}

	if opts.Verbose {
		log.Printf("Copied %d go files, %d static files\n", goCount, staticCount)
	}
	return nil
}

func copyStaticDir(srcDir, destDir string) (int, error) {
	// Always create static directory in temp dir
	staticDestDir := filepath.Join(destDir, "static")
	if err := os.MkdirAll(staticDestDir, 0755); err != nil {
		return 0, fmt.Errorf("failed to create static directory: %w", err)
	}

	// Copy static/ directory contents if it exists
	staticSrcDir := filepath.Join(srcDir, "static")
	if _, err := os.Stat(staticSrcDir); err == nil {
		return copyDirRecursive(staticSrcDir, staticDestDir)
	}

	return 0, nil
}

func copyGoFiles(srcDir, destDir string) (int, error) {
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return 0, err
	}

	fileCount := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		if strings.HasSuffix(entry.Name(), ".go") {
			srcPath := filepath.Join(srcDir, entry.Name())
			destPath := filepath.Join(destDir, entry.Name())

			if err := copyFile(srcPath, destPath); err != nil {
				return 0, fmt.Errorf("failed to copy %s: %w", entry.Name(), err)
			}
			fileCount++
		}
	}

	return fileCount, nil
}

func TsunamiRun(opts BuildOpts) error {
	if err := TsunamiBuild(opts); err != nil {
		return err
	}

	return fmt.Errorf("TsunamiRun not implemented yet")
}
