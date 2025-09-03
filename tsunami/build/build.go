package build

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type BuildOpts struct {
	Dir      string
	Verbose  bool
	DistPath string
}

func verifyEnvironment(verbose bool) error {
	// Check if go is in PATH
	goPath, err := exec.LookPath("go")
	if err != nil {
		return fmt.Errorf("go command not found in PATH: %w", err)
	}

	// Run go version command
	cmd := exec.Command(goPath, "version")
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("failed to run 'go version': %w", err)
	}

	// Parse go version output and check for 1.21+
	versionStr := strings.TrimSpace(string(output))
	if verbose {
		log.Printf("Found %s", versionStr)
	}

	// Extract version like "go1.21.0" from output
	versionRegex := regexp.MustCompile(`go1\.(\d+)`)
	matches := versionRegex.FindStringSubmatch(versionStr)
	if len(matches) < 2 {
		return fmt.Errorf("unable to parse go version from: %s", versionStr)
	}

	minor, err := strconv.Atoi(matches[1])
	if err != nil || minor < 21 {
		return fmt.Errorf("go version 1.21 or higher required, found: %s", versionStr)
	}

	// Check if npx is in PATH
	_, err = exec.LookPath("npx")
	if err != nil {
		return fmt.Errorf("npx command not found in PATH: %w", err)
	}

	if verbose {
		log.Printf("Found npx in PATH")
	}

	// Check Tailwind CSS version
	tailwindCmd := exec.Command("npx", "@tailwindcss/cli")
	tailwindOutput, err := tailwindCmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to run 'npx @tailwindcss/cli': %w", err)
	}

	tailwindStr := strings.TrimSpace(string(tailwindOutput))
	lines := strings.Split(tailwindStr, "\n")
	if len(lines) == 0 {
		return fmt.Errorf("no output from tailwindcss command")
	}

	firstLine := lines[0]
	if verbose {
		log.Printf("Found %s", firstLine)
	}

	// Check for v4 (format: "≈ tailwindcss v4.1.12")
	tailwindRegex := regexp.MustCompile(`tailwindcss v(\d+)`)
	matches = tailwindRegex.FindStringSubmatch(firstLine)
	if len(matches) < 2 {
		return fmt.Errorf("unable to parse tailwindcss version from: %s", firstLine)
	}

	majorVersion, err := strconv.Atoi(matches[1])
	if err != nil || majorVersion != 4 {
		return fmt.Errorf("tailwindcss v4 required, found: %s", firstLine)
	}

	return nil
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

func verifyDistPath(distPath string) error {
	if distPath == "" {
		return fmt.Errorf("distPath cannot be empty")
	}

	// Check if directory exists
	info, err := os.Stat(distPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("distPath directory %q does not exist", distPath)
		}
		return fmt.Errorf("error accessing distPath directory %q: %w", distPath, err)
	}

	if !info.IsDir() {
		return fmt.Errorf("distPath %q is not a directory", distPath)
	}

	// Check for index.html file
	indexPath := filepath.Join(distPath, "index.html")
	if err := CheckFileExists(indexPath); err != nil {
		return fmt.Errorf("index.html check failed in distPath %q: %w", distPath, err)
	}

	return nil
}

func TsunamiBuild(opts BuildOpts) error {
	if err := verifyEnvironment(opts.Verbose); err != nil {
		return err
	}

	if err := verifyTsunamiDir(opts.Dir); err != nil {
		return err
	}

	if err := verifyDistPath(opts.DistPath); err != nil {
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
