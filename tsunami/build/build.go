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

	"golang.org/x/mod/modfile"
)

type BuildOpts struct {
	Dir            string
	Verbose        bool
	DistPath       string
	SdkReplacePath string
}

type BuildEnv struct {
	GoVersion string
	TempDir   string
}

func verifyEnvironment(verbose bool) (*BuildEnv, error) {
	// Check if go is in PATH
	goPath, err := exec.LookPath("go")
	if err != nil {
		return nil, fmt.Errorf("go command not found in PATH: %w", err)
	}

	// Run go version command
	cmd := exec.Command(goPath, "version")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to run 'go version': %w", err)
	}

	// Parse go version output and check for 1.21+
	versionStr := strings.TrimSpace(string(output))
	if verbose {
		log.Printf("Found %s", versionStr)
	}

	// Extract version like "go1.21.0" from output
	versionRegex := regexp.MustCompile(`go(1\.\d+)`)
	matches := versionRegex.FindStringSubmatch(versionStr)
	if len(matches) < 2 {
		return nil, fmt.Errorf("unable to parse go version from: %s", versionStr)
	}

	goVersion := matches[1]

	// Check if version is 1.21+
	minorRegex := regexp.MustCompile(`1\.(\d+)`)
	minorMatches := minorRegex.FindStringSubmatch(goVersion)
	if len(minorMatches) < 2 {
		return nil, fmt.Errorf("unable to parse minor version from: %s", goVersion)
	}

	minor, err := strconv.Atoi(minorMatches[1])
	if err != nil || minor < 21 {
		return nil, fmt.Errorf("go version 1.21 or higher required, found: %s", versionStr)
	}

	// Check if npx is in PATH
	_, err = exec.LookPath("npx")
	if err != nil {
		return nil, fmt.Errorf("npx command not found in PATH: %w", err)
	}

	if verbose {
		log.Printf("Found npx in PATH")
	}

	// Check Tailwind CSS version
	tailwindCmd := exec.Command("npx", "@tailwindcss/cli")
	tailwindOutput, err := tailwindCmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to run 'npx @tailwindcss/cli': %w", err)
	}

	tailwindStr := strings.TrimSpace(string(tailwindOutput))
	lines := strings.Split(tailwindStr, "\n")
	if len(lines) == 0 {
		return nil, fmt.Errorf("no output from tailwindcss command")
	}

	firstLine := lines[0]
	if verbose {
		log.Printf("Found %s", firstLine)
	}

	// Check for v4 (format: "≈ tailwindcss v4.1.12")
	tailwindRegex := regexp.MustCompile(`tailwindcss v(\d+)`)
	tailwindMatches := tailwindRegex.FindStringSubmatch(firstLine)
	if len(tailwindMatches) < 2 {
		return nil, fmt.Errorf("unable to parse tailwindcss version from: %s", firstLine)
	}

	majorVersion, err := strconv.Atoi(tailwindMatches[1])
	if err != nil || majorVersion != 4 {
		return nil, fmt.Errorf("tailwindcss v4 required, found: %s", firstLine)
	}

	return &BuildEnv{GoVersion: goVersion}, nil
}

func createGoMod(tempDir, appDirName, goVersion string, opts BuildOpts, verbose bool) error {
	modulePath := fmt.Sprintf("tsunami/app/%s", appDirName)

	// Create new modfile
	modFile := &modfile.File{}
	if err := modFile.AddModuleStmt(modulePath); err != nil {
		return fmt.Errorf("failed to add module statement: %w", err)
	}

	if err := modFile.AddGoStmt(goVersion); err != nil {
		return fmt.Errorf("failed to add go version: %w", err)
	}

	// Add requirement for tsunami SDK
	if err := modFile.AddRequire("github.com/wavetermdev/waveterm/tsunami", "v0.0.0"); err != nil {
		return fmt.Errorf("failed to add require directive: %w", err)
	}

	// Add replace directive for tsunami SDK
	if err := modFile.AddReplace("github.com/wavetermdev/waveterm/tsunami", "", opts.SdkReplacePath, ""); err != nil {
		return fmt.Errorf("failed to add replace directive: %w", err)
	}

	// Format and write the file
	modFile.Cleanup()
	goModContent, err := modFile.Format()
	if err != nil {
		return fmt.Errorf("failed to format go.mod: %w", err)
	}

	goModPath := filepath.Join(tempDir, "go.mod")
	if err := os.WriteFile(goModPath, goModContent, 0644); err != nil {
		return fmt.Errorf("failed to write go.mod file: %w", err)
	}

	if verbose {
		log.Printf("Created go.mod with module path: %s", modulePath)
		log.Printf("Added require: github.com/wavetermdev/waveterm/tsunami v0.0.0")
		log.Printf("Added replace directive: github.com/wavetermdev/waveterm/tsunami => %s", opts.SdkReplacePath)
	}

	// Run go mod tidy to clean up dependencies
	tidyCmd := exec.Command("go", "mod", "tidy")
	tidyCmd.Dir = tempDir

	if verbose {
		log.Printf("Running go mod tidy")
		tidyCmd.Stdout = os.Stdout
		tidyCmd.Stderr = os.Stderr
	}

	if err := tidyCmd.Run(); err != nil {
		return fmt.Errorf("failed to run go mod tidy: %w", err)
	}

	if verbose {
		log.Printf("Successfully ran go mod tidy")
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

	// Check for templates/tailwind.css file
	tailwindPath := filepath.Join(distPath, "templates", "tailwind.css")
	if err := CheckFileExists(tailwindPath); err != nil {
		return fmt.Errorf("templates/tailwind.css check failed in distPath %q: %w", distPath, err)
	}

	// Check for templates/main.go.tmpl file
	mainTmplPath := filepath.Join(distPath, "templates", "main.go.tmpl")
	if err := CheckFileExists(mainTmplPath); err != nil {
		return fmt.Errorf("templates/main.go.tmpl check failed in distPath %q: %w", distPath, err)
	}

	return nil
}

func TsunamiBuild(opts BuildOpts) (*BuildEnv, error) {
	buildEnv, err := verifyEnvironment(opts.Verbose)
	if err != nil {
		return nil, err
	}

	if err := verifyTsunamiDir(opts.Dir); err != nil {
		return nil, err
	}

	if err := verifyDistPath(opts.DistPath); err != nil {
		return nil, err
	}

	// Create temporary directory
	tempDir, err := os.MkdirTemp("", "tsunami-build-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %w", err)
	}

	buildEnv.TempDir = tempDir

	log.Printf("Building tsunami app from %s\n", opts.Dir)

	if opts.Verbose {
		log.Printf("Temp dir: %s\n", tempDir)
	}

	// Copy all *.go files from the root directory
	goCount, err := copyGoFiles(opts.Dir, tempDir)
	if err != nil {
		return nil, fmt.Errorf("failed to copy go files: %w", err)
	}

	// Copy static directory
	staticCount, err := copyStaticDir(opts.Dir, tempDir)
	if err != nil {
		return nil, fmt.Errorf("failed to copy static directory: %w", err)
	}

	// Create dist directory
	distDir := filepath.Join(tempDir, "dist")
	if err := os.MkdirAll(distDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create dist directory: %w", err)
	}

	// Copy dist directory contents
	distCount, err := copyDirRecursive(opts.DistPath, distDir)
	if err != nil {
		return nil, fmt.Errorf("failed to copy dist directory: %w", err)
	}

	if opts.Verbose {
		log.Printf("Copied %d go files, %d static files, %d dist files\n", goCount, staticCount, distCount)
	}

	// Copy main.go.tmpl from dist/templates to temp dir as main-app.go
	mainTmplSrc := filepath.Join(opts.DistPath, "templates", "main.go.tmpl")
	mainTmplDest := filepath.Join(tempDir, "main-app.go")
	if err := copyFile(mainTmplSrc, mainTmplDest); err != nil {
		return nil, fmt.Errorf("failed to copy main.go.tmpl: %w", err)
	}

	// Create go.mod file
	appDirName := filepath.Base(opts.Dir)
	if err := createGoMod(tempDir, appDirName, buildEnv.GoVersion, opts, opts.Verbose); err != nil {
		return nil, fmt.Errorf("failed to create go.mod: %w", err)
	}

	// Generate Tailwind CSS
	if err := generateAppTailwindCss(opts.DistPath, tempDir, opts.Verbose); err != nil {
		return nil, fmt.Errorf("failed to generate tailwind css: %w", err)
	}

	// Build the Go application
	if err := runGoBuild(tempDir, opts.Verbose); err != nil {
		return nil, fmt.Errorf("failed to build application: %w", err)
	}

	return buildEnv, nil
}

func runGoBuild(tempDir string, verbose bool) error {
	binDir := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		return fmt.Errorf("failed to create bin directory: %w", err)
	}

	goFiles, err := listGoFilesInDir(tempDir)
	if err != nil {
		return fmt.Errorf("failed to list go files: %w", err)
	}

	if len(goFiles) == 0 {
		return fmt.Errorf("no .go files found in %s", tempDir)
	}

	// Build command with explicit go files
	args := append([]string{"build", "-o", "bin/app"}, goFiles...)
	buildCmd := exec.Command("go", args...)
	buildCmd.Dir = tempDir

	if verbose {
		log.Printf("Running: %s", strings.Join(buildCmd.Args, " "))
		buildCmd.Stdout = os.Stdout
		buildCmd.Stderr = os.Stderr
	}

	if err := buildCmd.Run(); err != nil {
		return fmt.Errorf("failed to build application: %w", err)
	}

	if verbose {
		log.Printf("Application built successfully at %s", filepath.Join(binDir, "app"))
	}

	return nil
}

func generateAppTailwindCss(distPath, tempDir string, verbose bool) error {
	// Copy tailwind.css from dist/templates to temp dir
	tailwindSrc := filepath.Join(distPath, "templates", "tailwind.css")
	tailwindDest := filepath.Join(tempDir, "tailwind.css")
	if err := copyFile(tailwindSrc, tailwindDest); err != nil {
		return fmt.Errorf("failed to copy tailwind.css: %w", err)
	}

	tailwindOutput := filepath.Join(tempDir, "static", "tw.css")

	tailwindCmd := exec.Command("npx", "@tailwindcss/cli",
		"-i", "./tailwind.css",
		"-o", tailwindOutput)
	tailwindCmd.Dir = tempDir

	if verbose {
		log.Printf("Running: %s", strings.Join(tailwindCmd.Args, " "))
		tailwindCmd.Stdout = os.Stdout
		tailwindCmd.Stderr = os.Stderr
	}

	if err := tailwindCmd.Run(); err != nil {
		return fmt.Errorf("failed to run tailwind command: %w", err)
	}

	if verbose {
		log.Printf("Tailwind CSS generated successfully")
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
	buildEnv, err := TsunamiBuild(opts)
	if err != nil {
		return err
	}

	// Run the built application
	appPath := filepath.Join(buildEnv.TempDir, "bin", "app")
	runCmd := exec.Command(appPath)
	runCmd.Dir = buildEnv.TempDir

	log.Printf("Running tsunami app from %s", opts.Dir)

	runCmd.Stdin = os.Stdin
	if opts.Verbose {
		log.Printf("Executing: %s", appPath)
		runCmd.Stdout = os.Stdout
		runCmd.Stderr = os.Stderr
	}

	if err := runCmd.Run(); err != nil {
		return fmt.Errorf("failed to run application: %w", err)
	}

	return nil
}
