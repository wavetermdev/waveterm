// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package build

import (
	"archive/zip"
	"bufio"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/util"
	"golang.org/x/mod/modfile"
)

const MinSupportedGoMinorVersion = 22
const TsunamiUIImportPath = "github.com/wavetermdev/waveterm/tsunami/ui"
const MainAppFileName = "app.go"

type OutputCapture struct {
	lock       sync.Mutex
	lines      []string
	lineWriter *util.LineWriter
}

func MakeOutputCapture() *OutputCapture {
	oc := &OutputCapture{
		lines: make([]string, 0),
	}
	oc.lineWriter = util.NewLineWriter(func(line []byte) {
		// synchronized via the Write/Flush functions
		oc.lines = append(oc.lines, string(line))
	})
	return oc
}

func (oc *OutputCapture) Write(p []byte) (n int, err error) {
	if oc == nil {
		return os.Stdout.Write(p)
	}
	oc.lock.Lock()
	defer oc.lock.Unlock()
	return oc.lineWriter.Write(p)
}

func (oc *OutputCapture) Flush() {
	if oc == nil || oc.lineWriter == nil {
		return
	}
	oc.lock.Lock()
	defer oc.lock.Unlock()
	oc.lineWriter.Flush()
}

func (oc *OutputCapture) Printf(format string, args ...interface{}) {
	if oc == nil || oc.lineWriter == nil {
		log.Printf(format, args...)
		return
	}
	line := fmt.Sprintf(format, args...)
	oc.lock.Lock()
	defer oc.lock.Unlock()
	oc.lines = append(oc.lines, line)
}

func (oc *OutputCapture) GetLines() []string {
	if oc == nil {
		return nil
	}
	oc.lock.Lock()
	defer oc.lock.Unlock()
	result := make([]string, len(oc.lines))
	copy(result, oc.lines)
	return result
}

type BuildOpts struct {
	AppPath        string
	AppNS          string
	Verbose        bool
	Open           bool
	KeepTemp       bool
	OutputFile     string
	ScaffoldPath   string
	SdkReplacePath string
	SdkVersion     string
	NodePath       string
	GoPath         string
	MoveFileBack   bool
	OutputCapture  *OutputCapture
}

func GetAppName(appPath string) string {
	baseName := filepath.Base(appPath)
	return strings.TrimSuffix(baseName, ".tsapp")
}

type BuildEnv struct {
	GoVersion   string
	GoPath      string
	TempDir     string
	cleanupOnce *sync.Once
}

func (opts BuildOpts) getNodePath() string {
	if opts.NodePath != "" {
		return opts.NodePath
	}
	return "node"
}

type GoVersionCheckResult struct {
	GoStatus    string
	GoPath      string
	GoVersion   string
	ErrorString string
}

func FindGoExecutable() (string, error) {
	// First try the standard PATH lookup
	if goPath, err := exec.LookPath("go"); err == nil {
		return goPath, nil
	}

	// Define platform-specific paths to check
	var pathsToCheck []string

	if runtime.GOOS == "windows" {
		pathsToCheck = []string{
			`c:\go\bin\go.exe`,
			`c:\program files\go\bin\go.exe`,
		}
	} else {
		// Unix-like systems (macOS, Linux, etc.)
		pathsToCheck = []string{
			"/opt/homebrew/bin/go", // Homebrew on Apple Silicon
			"/usr/local/bin/go",    // Traditional Homebrew or manual install
			"/usr/local/go/bin/go", // Official Go installation
			"/usr/bin/go",          // System package manager
		}
	}

	// Check each path
	for _, path := range pathsToCheck {
		if _, err := os.Stat(path); err == nil {
			// File exists, check if it's executable
			if info, err := os.Stat(path); err == nil && !info.IsDir() {
				return path, nil
			}
		}
	}

	return "", fmt.Errorf("go command not found in PATH or common installation locations")
}

func CheckGoVersion(customGoPath string) GoVersionCheckResult {
	var goPath string
	var err error

	if customGoPath != "" {
		goPath = customGoPath
	} else {
		goPath, err = FindGoExecutable()
		if err != nil {
			return GoVersionCheckResult{
				GoStatus:    "notfound",
				GoPath:      "",
				GoVersion:   "",
				ErrorString: "",
			}
		}
	}

	cmd := exec.Command(goPath, "version")
	output, err := cmd.Output()
	if err != nil {
		return GoVersionCheckResult{
			GoStatus:    "error",
			GoPath:      goPath,
			GoVersion:   "",
			ErrorString: fmt.Sprintf("failed to run 'go version': %v", err),
		}
	}

	versionStr := strings.TrimSpace(string(output))

	versionRegex := regexp.MustCompile(`go(1\.\d+)`)
	matches := versionRegex.FindStringSubmatch(versionStr)
	if len(matches) < 2 {
		return GoVersionCheckResult{
			GoStatus:    "error",
			GoPath:      goPath,
			GoVersion:   versionStr,
			ErrorString: fmt.Sprintf("unable to parse go version from: %s", versionStr),
		}
	}

	goVersion := matches[1]

	minorRegex := regexp.MustCompile(`1\.(\d+)`)
	minorMatches := minorRegex.FindStringSubmatch(goVersion)
	if len(minorMatches) < 2 {
		return GoVersionCheckResult{
			GoStatus:    "error",
			GoPath:      goPath,
			GoVersion:   versionStr,
			ErrorString: fmt.Sprintf("unable to parse minor version from: %s", goVersion),
		}
	}

	minor, err := strconv.Atoi(minorMatches[1])
	if err != nil {
		return GoVersionCheckResult{
			GoStatus:    "error",
			GoPath:      goPath,
			GoVersion:   versionStr,
			ErrorString: fmt.Sprintf("failed to parse minor version: %v", err),
		}
	}

	if minor < MinSupportedGoMinorVersion {
		return GoVersionCheckResult{
			GoStatus:    "badversion",
			GoPath:      goPath,
			GoVersion:   versionStr,
			ErrorString: "",
		}
	}

	return GoVersionCheckResult{
		GoStatus:    "ok",
		GoPath:      goPath,
		GoVersion:   versionStr,
		ErrorString: "",
	}
}

func verifyEnvironment(verbose bool, opts BuildOpts) (*BuildEnv, error) {
	oc := opts.OutputCapture

	if opts.SdkVersion == "" && opts.SdkReplacePath == "" {
		return nil, fmt.Errorf("either SdkVersion or SdkReplacePath must be set")
	}

	if opts.SdkVersion != "" {
		versionRegex := regexp.MustCompile(`^v\d+\.\d+\.\d+`)
		if !versionRegex.MatchString(opts.SdkVersion) {
			return nil, fmt.Errorf("SdkVersion must be in semantic version format (e.g., v0.0.0), got: %s", opts.SdkVersion)
		}
	}

	result := CheckGoVersion(opts.GoPath)

	switch result.GoStatus {
	case "notfound":
		return nil, fmt.Errorf("go command not found")
	case "badversion":
		return nil, fmt.Errorf("go version 1.%d or higher required, found: %s", MinSupportedGoMinorVersion, result.GoVersion)
	case "error":
		return nil, fmt.Errorf("%s", result.ErrorString)
	case "ok":
		if verbose {
			if opts.GoPath != "" {
				oc.Printf("[debug] Using custom go path: %s", result.GoPath)
			} else {
				oc.Printf("[debug] Using go path: %s", result.GoPath)
			}
			oc.Printf("[debug] Found %s", result.GoVersion)
		}
	default:
		return nil, fmt.Errorf("unexpected go status: %s", result.GoStatus)
	}

	versionRegex := regexp.MustCompile(`go(1\.\d+)`)
	matches := versionRegex.FindStringSubmatch(result.GoVersion)
	if len(matches) < 2 {
		return nil, fmt.Errorf("unable to parse go version from: %s", result.GoVersion)
	}
	goVersion := matches[1]

	var err error

	// Check if node is available
	if opts.NodePath != "" {
		// Custom node path specified - verify it's absolute and executable
		if !filepath.IsAbs(opts.NodePath) {
			return nil, fmt.Errorf("NodePath must be an absolute path, got: %s", opts.NodePath)
		}

		info, err := os.Stat(opts.NodePath)
		if err != nil {
			return nil, fmt.Errorf("NodePath does not exist: %s: %w", opts.NodePath, err)
		}

		if info.IsDir() {
			return nil, fmt.Errorf("NodePath is a directory, not an executable: %s", opts.NodePath)
		}

		// Check if file is executable (Unix-like systems)
		if runtime.GOOS != "windows" && info.Mode()&0111 == 0 {
			return nil, fmt.Errorf("NodePath is not executable: %s", opts.NodePath)
		}

		if verbose {
			oc.Printf("[debug] Using custom node path: %s", opts.NodePath)
		}
	} else {
		// Use standard PATH lookup
		_, err = exec.LookPath("node")
		if err != nil {
			return nil, fmt.Errorf("node command not found in PATH: %w", err)
		}

		if verbose {
			oc.Printf("[debug] Found node in PATH")
		}
	}

	return &BuildEnv{
		GoVersion:   goVersion,
		GoPath:      result.GoPath,
		cleanupOnce: &sync.Once{},
	}, nil
}

func createGoMod(tempDir, appNS, appName string, buildEnv *BuildEnv, opts BuildOpts, verbose bool) error {
	oc := opts.OutputCapture
	if appNS == "" {
		appNS = "app"
	}
	modulePath := fmt.Sprintf("tsunami/%s/%s", appNS, appName)

	// Check if go.mod already exists in temp directory (copied from app path)
	tempGoModPath := filepath.Join(tempDir, "go.mod")
	var modFile *modfile.File
	var err error

	if _, err := os.Stat(tempGoModPath); err == nil {
		// go.mod exists in temp dir, parse it
		if verbose {
			oc.Printf("[debug] Found existing go.mod in temp directory, parsing it")
		}

		// Parse the existing go.mod
		goModContent, err := os.ReadFile(tempGoModPath)
		if err != nil {
			return fmt.Errorf("failed to read go.mod: %w", err)
		}

		modFile, err = modfile.Parse("go.mod", goModContent, nil)
		if err != nil {
			return fmt.Errorf("failed to parse existing go.mod: %w", err)
		}
	} else if os.IsNotExist(err) {
		// go.mod doesn't exist, create new one
		if verbose {
			oc.Printf("[debug] No existing go.mod found, creating new one")
		}

		modFile = &modfile.File{}
		if err := modFile.AddModuleStmt(modulePath); err != nil {
			return fmt.Errorf("failed to add module statement: %w", err)
		}

		if err := modFile.AddGoStmt(buildEnv.GoVersion); err != nil {
			return fmt.Errorf("failed to add go version: %w", err)
		}

		// Add requirement for tsunami SDK
		if err := modFile.AddRequire("github.com/wavetermdev/waveterm/tsunami", opts.SdkVersion); err != nil {
			return fmt.Errorf("failed to add require directive: %w", err)
		}
	} else {
		return fmt.Errorf("error checking for go.mod in temp directory: %w", err)
	}

	// Add replace directive for tsunami SDK if path is provided
	if opts.SdkReplacePath != "" {
		if err := modFile.AddReplace("github.com/wavetermdev/waveterm/tsunami", "", opts.SdkReplacePath, ""); err != nil {
			return fmt.Errorf("failed to add replace directive: %w", err)
		}
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
		oc.Printf("[debug] Created go.mod with module path: %s", modulePath)
		oc.Printf("[debug] Added require: github.com/wavetermdev/waveterm/tsunami %s", opts.SdkVersion)
		if opts.SdkReplacePath != "" {
			oc.Printf("[debug] Added replace directive: github.com/wavetermdev/waveterm/tsunami => %s", opts.SdkReplacePath)
		}
	}

	// Run go mod tidy to clean up dependencies
	tidyCmd := exec.Command(buildEnv.GoPath, "mod", "tidy")
	tidyCmd.Dir = tempDir

	if verbose {
		oc.Printf("[debug] Running go mod tidy")
	}

	if oc != nil {
		tidyCmd.Stdout = oc
		tidyCmd.Stderr = oc
	} else {
		tidyCmd.Stdout = os.Stdout
		tidyCmd.Stderr = os.Stderr
	}

	if err := tidyCmd.Run(); err != nil {
		oc.Flush()
		return fmt.Errorf("go mod tidy failed (see output for errors)")
	}

	if oc != nil {
		oc.Flush()
	}

	if verbose {
		oc.Printf("[debug] Successfully ran go mod tidy")
	}

	return nil
}

func verifyAppPathFs(fsys fs.FS) error {
	if err := checkFileExistsFS(fsys, MainAppFileName); err != nil {
		return fmt.Errorf("%s check failed: %w", MainAppFileName, err)
	}

	// Check static directory if it exists
	if err := isDirOrNotFoundFS(fsys, "static"); err != nil {
		return fmt.Errorf("static directory check failed: %w", err)
	}

	return nil
}

func GetAppModTime(appPath string) (time.Time, error) {
	if strings.HasSuffix(appPath, ".tsapp") {
		info, err := os.Stat(appPath)
		if err != nil {
			return time.Time{}, fmt.Errorf("failed to get tsapp mod time: %w", err)
		}
		return info.ModTime(), nil
	}

	appGoPath := filepath.Join(appPath, MainAppFileName)
	info, err := os.Stat(appGoPath)
	if err != nil {
		return time.Time{}, fmt.Errorf("failed to get %s mod time: %w", MainAppFileName, err)
	}
	return info.ModTime(), nil
}

func verifyScaffoldFs(fsys fs.FS) error {
	// Check for dist directory
	if err := isDirOrNotFoundFS(fsys, "dist"); err != nil {
		return fmt.Errorf("dist directory check failed: %w", err)
	}
	info, err := fs.Stat(fsys, "dist")
	if err != nil || !info.IsDir() {
		return fmt.Errorf("dist directory must exist in scaffold")
	}

	// Check for app-main.go.tmpl file
	if err := checkFileExistsFS(fsys, "app-main.go.tmpl"); err != nil {
		return fmt.Errorf("app-main.go check failed: %w", err)
	}
	// Check for app-init.go.tmpl file
	if err := checkFileExistsFS(fsys, "app-main.go.tmpl"); err != nil {
		return fmt.Errorf("app-main.go check failed: %w", err)
	}

	// Check for tailwind.css file
	if err := checkFileExistsFS(fsys, "tailwind.css"); err != nil {
		return fmt.Errorf("tailwind.css check failed: %w", err)
	}

	// Check for package.json file
	if err := checkFileExistsFS(fsys, "package.json"); err != nil {
		return fmt.Errorf("package.json check failed: %w", err)
	}

	// Check for nm directory
	if err := isDirOrNotFoundFS(fsys, "nm"); err != nil {
		return fmt.Errorf("nm (node_modules) directory check failed: %w", err)
	}
	info, err = fs.Stat(fsys, "nm")
	if err != nil || !info.IsDir() {
		return fmt.Errorf("nm (node_modules) directory must exist in scaffold")
	}

	return nil
}

func (be *BuildEnv) cleanupTempDir(keepTemp bool, verbose bool) {
	if be == nil || be.cleanupOnce == nil {
		return
	}

	be.cleanupOnce.Do(func() {
		if keepTemp || be.TempDir == "" {
			log.Printf("NOT cleaning tempdir\n")
			return
		}
		if err := os.RemoveAll(be.TempDir); err != nil {
			log.Printf("Failed to remove temp directory %s: %v", be.TempDir, err)
		} else if verbose {
			log.Printf("Removed temp directory: %s", be.TempDir)
		}
	})
}

func setupSignalCleanup(buildEnv *BuildEnv, keepTemp, verbose bool) {
	if keepTemp {
		return
	}
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		defer signal.Stop(sigChan)
		sig := <-sigChan
		if verbose {
			log.Printf("Received signal %v, cleaning up temp directory", sig)
		}
		buildEnv.cleanupTempDir(keepTemp, verbose)
		os.Exit(1)
	}()
}

func TsunamiBuild(opts BuildOpts) error {
	buildEnv, err := TsunamiBuildInternal(opts)
	defer buildEnv.cleanupTempDir(opts.KeepTemp, opts.Verbose)
	if err != nil {
		return err
	}
	setupSignalCleanup(buildEnv, opts.KeepTemp, opts.Verbose)
	return nil
}

func TsunamiBuildInternal(opts BuildOpts) (*BuildEnv, error) {
	oc := opts.OutputCapture

	buildEnv, err := verifyEnvironment(opts.Verbose, opts)
	if err != nil {
		return nil, err
	}

	appFS, canWrite, appCloser, err := pathToFS(opts.AppPath)
	if err != nil {
		return nil, fmt.Errorf("bad app path: %w", err)
	}
	if appCloser != nil {
		defer appCloser()
	}

	if err := verifyAppPathFs(appFS); err != nil {
		return nil, fmt.Errorf("bad app path: %w", err)
	}

	scaffoldFS, _, scaffoldCloser, err := pathToFS(opts.ScaffoldPath)
	if err != nil {
		return nil, fmt.Errorf("bad scaffold path: %w", err)
	}
	if scaffoldCloser != nil {
		defer scaffoldCloser()
	}

	if err := verifyScaffoldFs(scaffoldFS); err != nil {
		return nil, err
	}

	appInfo, err := parseAndValidateAppFile(appFS)
	if err != nil {
		return nil, err
	}

	// Create temporary directory
	tempDir, err := os.MkdirTemp("", "tsunami-build-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %w", err)
	}

	buildEnv.TempDir = tempDir

	oc.Printf("Building tsunami app from %s", opts.AppPath)
	oc.Printf("[debug] using scaffold path %s", opts.ScaffoldPath)

	if opts.Verbose || opts.KeepTemp {
		oc.Printf("[debug] Temp dir: %s", tempDir)
	}

	// Copy files from app path (go.mod, go.sum, static/, *.go)
	copyStats, err := copyFilesFromAppFS(appFS, opts.AppPath, tempDir, opts.Verbose, oc)
	if err != nil {
		return buildEnv, fmt.Errorf("failed to copy files from app path: %w", err)
	}

	// Copy scaffold directory contents selectively
	scaffoldCount, err := copyScaffoldFS(scaffoldFS, tempDir, appInfo.HasAppInit, opts.Verbose, oc)
	if err != nil {
		return buildEnv, fmt.Errorf("failed to copy scaffold directory: %w", err)
	}

	if opts.Verbose {
		oc.Printf("[debug] Copied %d go files, %d static files, %d scaffold files (go.mod: %t, go.sum: %t)",
			copyStats.GoFiles, copyStats.StaticFiles, scaffoldCount, copyStats.GoMod, copyStats.GoSum)
	}

	// Create go.mod file
	appName := GetAppName(opts.AppPath)
	if err := createGoMod(tempDir, opts.AppNS, appName, buildEnv, opts, opts.Verbose); err != nil {
		return buildEnv, err
	}

	// Generate Tailwind CSS
	if err := generateAppTailwindCss(tempDir, opts.Verbose, opts); err != nil {
		return buildEnv, err
	}

	// Build the Go application
	outputPath, err := runGoBuild(tempDir, buildEnv, opts)
	if err != nil {
		return buildEnv, err
	}

	// Generate manifest
	if err := generateManifest(tempDir, outputPath, opts); err != nil {
		return buildEnv, err
	}

	// Move generated files back to original directory
	if opts.MoveFileBack && canWrite {
		if err := moveFilesBack(tempDir, opts.AppPath, opts.Verbose, oc); err != nil {
			return buildEnv, fmt.Errorf("failed to move files back: %w", err)
		}
	} else if opts.MoveFileBack && !canWrite {
		if opts.Verbose {
			oc.Printf("Skipping move files back - app path is not writable: %s", opts.AppPath)
		}
	}

	return buildEnv, nil
}

func moveFilesBack(tempDir, originalDir string, verbose bool, oc *OutputCapture) error {
	// Move go.mod back to original directory
	goModSrc := filepath.Join(tempDir, "go.mod")
	goModDest := filepath.Join(originalDir, "go.mod")
	if err := copyFile(goModSrc, goModDest); err != nil {
		return fmt.Errorf("failed to copy go.mod back: %w", err)
	}
	if verbose {
		oc.Printf("[debug] Moved go.mod back to %s", goModDest)
	}

	// Move go.sum back to original directory (only if it exists)
	goSumSrc := filepath.Join(tempDir, "go.sum")
	if _, err := os.Stat(goSumSrc); err == nil {
		goSumDest := filepath.Join(originalDir, "go.sum")
		if err := copyFile(goSumSrc, goSumDest); err != nil {
			return fmt.Errorf("failed to copy go.sum back: %w", err)
		}
		if verbose {
			oc.Printf("[debug] Moved go.sum back to %s", goSumDest)
		}
	}

	// Ensure static directory exists in original directory
	staticDir := filepath.Join(originalDir, "static")
	if err := os.MkdirAll(staticDir, 0755); err != nil {
		return fmt.Errorf("failed to create static directory: %w", err)
	}
	if verbose {
		oc.Printf("[debug] Ensured static directory exists at %s", staticDir)
	}

	// Move tw.css back to original directory
	twCssSrc := filepath.Join(tempDir, "static", "tw.css")
	twCssDest := filepath.Join(originalDir, "static", "tw.css")
	if err := copyFile(twCssSrc, twCssDest); err != nil {
		return fmt.Errorf("failed to copy tw.css back: %w", err)
	}
	if verbose {
		oc.Printf("[debug] Moved tw.css back to %s", twCssDest)
	}

	// Move manifest.json back to original directory (only if it exists)
	manifestSrc := filepath.Join(tempDir, "manifest.json")
	if _, err := os.Stat(manifestSrc); err == nil {
		manifestDest := filepath.Join(originalDir, "manifest.json")
		if err := copyFile(manifestSrc, manifestDest); err != nil {
			return fmt.Errorf("failed to copy manifest.json back: %w", err)
		}
		if verbose {
			oc.Printf("[debug] Moved manifest.json back to %s", manifestDest)
		}
	}

	return nil
}

func runGoBuild(tempDir string, buildEnv *BuildEnv, opts BuildOpts) (string, error) {
	oc := opts.OutputCapture
	var outputPath string
	var absOutputPath string
	if opts.OutputFile != "" {
		// Convert to absolute path resolved against current working directory
		var err error
		absOutputPath, err = filepath.Abs(opts.OutputFile)
		if err != nil {
			return "", fmt.Errorf("failed to resolve output path: %w", err)
		}
		outputPath = absOutputPath
	} else {
		binDir := filepath.Join(tempDir, "bin")
		if err := os.MkdirAll(binDir, 0755); err != nil {
			return "", fmt.Errorf("failed to create bin directory: %w", err)
		}
		outputPath = "bin/app"
		absOutputPath = filepath.Join(tempDir, "bin", "app")
	}

	goFiles, err := listGoFilesInDir(tempDir)
	if err != nil {
		return "", fmt.Errorf("failed to list go files: %w", err)
	}

	if len(goFiles) == 0 {
		return "", fmt.Errorf("no .go files found in %s", tempDir)
	}

	// Build command with explicit go files
	args := append([]string{"build", "-o", outputPath}, ".")
	buildCmd := exec.Command(buildEnv.GoPath, args...)
	buildCmd.Dir = tempDir

	if oc != nil || opts.Verbose {
		oc.Printf("[debug] Running: %s", strings.Join(buildCmd.Args, " "))
		oc.Printf("Building application...")
	}
	if oc != nil {
		buildCmd.Stdout = oc
		buildCmd.Stderr = oc
	} else {
		buildCmd.Stdout = os.Stdout
		buildCmd.Stderr = os.Stderr
	}

	if err := buildCmd.Run(); err != nil {
		return "", fmt.Errorf("compilation failed (see output for errors)")
	}
	if oc != nil {
		oc.Flush()
	}

	if opts.Verbose {
		oc.Printf("Application built successfully")
		oc.Printf("[debug] Output path: %s", absOutputPath)
	}

	return absOutputPath, nil
}

func generateManifest(tempDir, exePath string, opts BuildOpts) error {
	oc := opts.OutputCapture

	manifestCmd := exec.Command(exePath, "--manifest")
	manifestCmd.Dir = tempDir

	if opts.Verbose {
		oc.Printf("[debug] Running: %s --manifest", exePath)
		oc.Printf("Generating manifest...")
	}

	manifestOutput, err := manifestCmd.Output()
	if err != nil {
		return fmt.Errorf("manifest generation failed: %w", err)
	}

	// Extract manifest between delimiters
	manifestStr := string(manifestOutput)
	startTag := "<AppManifest>"
	endTag := "</AppManifest>"
	startIdx := strings.Index(manifestStr, startTag)
	endIdx := strings.Index(manifestStr, endTag)

	if startIdx == -1 || endIdx == -1 {
		return fmt.Errorf("manifest delimiters not found in output")
	}

	manifestJSON := manifestStr[startIdx+len(startTag) : endIdx]
	manifestJSON = strings.TrimSpace(manifestJSON)

	manifestPath := filepath.Join(tempDir, "manifest.json")
	if err := os.WriteFile(manifestPath, []byte(manifestJSON), 0644); err != nil {
		return fmt.Errorf("failed to write manifest.json: %w", err)
	}

	if opts.Verbose {
		oc.Printf("Manifest generated successfully")
		oc.Printf("[debug] Manifest path: %s", manifestPath)
	}

	return nil
}

func generateAppTailwindCss(tempDir string, verbose bool, opts BuildOpts) error {
	oc := opts.OutputCapture
	// tailwind.css is already in tempDir from scaffold copy
	tailwindOutput := filepath.Join(tempDir, "static", "tw.css")
	tailwindCmd := exec.Command(opts.getNodePath(), "--preserve-symlinks-main", "--preserve-symlinks",
		"node_modules/@tailwindcss/cli/dist/index.mjs",
		"-i", "./tailwind.css",
		"-o", tailwindOutput)
	tailwindCmd.Dir = tempDir
	tailwindCmd.Env = append(os.Environ(), "ELECTRON_RUN_AS_NODE=1")

	if verbose {
		oc.Printf("[debug] Running: %s", strings.Join(tailwindCmd.Args, " "))
	}

	output, err := tailwindCmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("tailwind CSS generation failed (see output for errors)")
	}

	// Process and filter tailwind output
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		// Skip empty lines
		if strings.TrimSpace(line) == "" {
			continue
		}
		// Skip version line (contains ≈ and tailwindcss)
		if strings.Contains(line, "≈") && strings.Contains(line, "tailwindcss") {
			continue
		}
		// Skip "Done in" timing line
		if strings.HasPrefix(strings.TrimSpace(line), "Done in") {
			continue
		}
		// Write remaining lines to output
		oc.Printf("%s", line)
	}
	if verbose {
		oc.Printf("Tailwind CSS generated successfully")
	}
	return nil
}

type CopyStats struct {
	GoFiles     int
	StaticFiles int
	GoMod       bool
	GoSum       bool
}

func copyGoFilesFromFS(fsys fs.FS, destDir string) (int, error) {
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return 0, err
	}

	fileCount := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		if strings.HasSuffix(entry.Name(), ".go") {
			destPath := filepath.Join(destDir, entry.Name())

			if err := CopyFileFromFS(fsys, entry.Name(), destPath); err != nil {
				return 0, fmt.Errorf("failed to copy %s: %w", entry.Name(), err)
			}
			fileCount++
		}
	}

	return fileCount, nil
}

// appPath is just used for logging (we do the copies from appFS)
func copyFilesFromAppFS(appFS fs.FS, appPath, tempDir string, verbose bool, oc *OutputCapture) (*CopyStats, error) {
	stats := &CopyStats{}

	// Copy go.mod if it exists
	goModDest := filepath.Join(tempDir, "go.mod")
	copied, err := CopyFileIfExists(appFS, "go.mod", goModDest)
	if err != nil {
		return nil, err
	}
	stats.GoMod = copied
	if copied && verbose {
		oc.Printf("Copied go.mod from %s", filepath.Join(appPath, "go.mod"))
	}

	// Copy go.sum if it exists
	goSumDest := filepath.Join(tempDir, "go.sum")
	copied, err = CopyFileIfExists(appFS, "go.sum", goSumDest)
	if err != nil {
		return nil, err
	}
	stats.GoSum = copied
	if copied && verbose {
		oc.Printf("Copied go.sum from %s", filepath.Join(appPath, "go.sum"))
	}

	// Copy manifest.json if it exists
	manifestDest := filepath.Join(tempDir, "manifest.json")
	copied, err = CopyFileIfExists(appFS, "manifest.json", manifestDest)
	if err != nil {
		return nil, err
	}
	if copied && verbose {
		oc.Printf("Copied manifest.json from %s", filepath.Join(appPath, "manifest.json"))
	}

	// Copy static directory
	staticDestDir := filepath.Join(tempDir, "static")
	staticCount, err := copyDirFromFS(appFS, "static", staticDestDir, true)
	if err != nil {
		return nil, fmt.Errorf("failed to copy static directory: %w", err)
	}
	stats.StaticFiles = staticCount

	// Copy all *.go files from the root directory
	goCount, err := copyGoFilesFromFS(appFS, tempDir)
	if err != nil {
		return nil, fmt.Errorf("failed to copy go files: %w", err)
	}
	stats.GoFiles = goCount

	return stats, nil
}

func TsunamiRun(opts BuildOpts) error {
	oc := opts.OutputCapture
	buildEnv, err := TsunamiBuildInternal(opts)
	defer buildEnv.cleanupTempDir(opts.KeepTemp, opts.Verbose)
	if err != nil {
		return err
	}
	setupSignalCleanup(buildEnv, opts.KeepTemp, opts.Verbose)

	// Run the built application
	appBinPath := filepath.Join(buildEnv.TempDir, "bin", "app")
	runCmd := exec.Command(appBinPath)
	runCmd.Dir = buildEnv.TempDir

	oc.Printf("Running tsunami app from %s", opts.AppPath)

	runCmd.Stdin = os.Stdin

	if opts.Open {
		// If --open flag is set, we need to capture stderr to parse the listening message
		stderr, err := runCmd.StderrPipe()
		if err != nil {
			return fmt.Errorf("failed to create stderr pipe: %w", err)
		}
		runCmd.Stdout = os.Stdout

		if err := runCmd.Start(); err != nil {
			return fmt.Errorf("failed to start application: %w", err)
		}

		// Monitor stderr for the listening message
		go monitorAndOpenBrowser(stderr, opts.Verbose)

		if err := runCmd.Wait(); err != nil {
			return fmt.Errorf("application exited with error: %w", err)
		}
	} else {
		// Normal execution without browser opening
		if opts.Verbose {
			log.Printf("Executing: %s", appBinPath)
			runCmd.Stdout = os.Stdout
			runCmd.Stderr = os.Stderr
		}

		if err := runCmd.Start(); err != nil {
			return fmt.Errorf("failed to start application: %w", err)
		}

		if err := runCmd.Wait(); err != nil {
			return fmt.Errorf("application exited with error: %w", err)
		}
	}

	return nil
}

func monitorAndOpenBrowser(r io.ReadCloser, verbose bool) {
	defer r.Close()

	scanner := bufio.NewScanner(r)
	browserOpened := false
	if verbose {
		log.Printf("monitoring for browser open\n")
	}

	for scanner.Scan() {
		line := scanner.Text()
		fmt.Println(line)

		if !browserOpened {
			port := ParseTsunamiPort(line)
			if port > 0 {
				url := fmt.Sprintf("http://localhost:%d", port)
				if verbose {
					log.Printf("Opening browser to %s", url)
				}
				go util.OpenBrowser(url, 100*time.Millisecond)
				browserOpened = true
			}
		}
	}
}

func ParseTsunamiPort(line string) int {
	urlRegex := regexp.MustCompile(`\[tsunami\] listening at (http://[^\s]+)`)
	matches := urlRegex.FindStringSubmatch(line)
	if len(matches) < 2 {
		return 0
	}

	u, err := url.Parse(matches[1])
	if err != nil {
		return 0
	}

	portStr := u.Port()
	if portStr == "" {
		return 0
	}

	port, err := strconv.Atoi(portStr)
	if err != nil {
		return 0
	}

	return port
}

func copyScaffoldFS(scaffoldFS fs.FS, destDir string, hasAppInit bool, verbose bool, oc *OutputCapture) (int, error) {
	fileCount := 0

	// Handle nm (node_modules) directory - prefer symlink if possible, otherwise copy
	if _, err := fs.Stat(scaffoldFS, "nm"); err == nil {
		destPath := filepath.Join(destDir, "node_modules")

		// Try to create symlink if we have DirFS
		symlinked := false
		if dirFS, ok := scaffoldFS.(DirFS); ok {
			srcPath := dirFS.JoinOS("nm")
			if err := os.Symlink(srcPath, destPath); err == nil {
				if verbose {
					oc.Printf("[debug] Symlinked nm to node_modules directory")
				}
				fileCount++
				symlinked = true
			}
		}

		// Fallback to recursive copy if symlink failed or not attempted
		if !symlinked {
			dirCount, err := copyDirFromFS(scaffoldFS, "nm", destPath, false)
			if err != nil {
				return 0, fmt.Errorf("failed to copy nm (node_modules) directory: %w", err)
			}
			if verbose {
				oc.Printf("Copied nm to node_modules directory (%d files)", dirCount)
			}
			fileCount += dirCount
		}
	} else if !os.IsNotExist(err) {
		return 0, fmt.Errorf("error checking nm (node_modules): %w", err)
	}

	// Copy package files instead of symlinking
	packageFiles := []string{"package.json", "package-lock.json"}
	for _, fileName := range packageFiles {
		destPath := filepath.Join(destDir, fileName)

		// Check if source exists in FS
		if _, err := fs.Stat(scaffoldFS, fileName); err != nil {
			if os.IsNotExist(err) {
				continue // Skip if doesn't exist
			}
			return 0, fmt.Errorf("error checking %s: %w", fileName, err)
		}

		// Copy file from FS
		if err := CopyFileFromFS(scaffoldFS, fileName, destPath); err != nil {
			return 0, fmt.Errorf("failed to copy %s: %w", fileName, err)
		}
		fileCount++
	}

	// Copy dist directory using FS
	distDestPath := filepath.Join(destDir, "dist")
	dirCount, err := copyDirFromFS(scaffoldFS, "dist", distDestPath, false)
	if err != nil {
		return 0, fmt.Errorf("failed to copy dist directory: %w", err)
	}
	fileCount += dirCount

	// Always copy app-main.go.tmpl => app-main.go
	destPath := filepath.Join(destDir, "app-main.go")
	if err := CopyFileFromFS(scaffoldFS, "app-main.go.tmpl", destPath); err != nil {
		return 0, fmt.Errorf("failed to copy app-main.go.tmpl: %w", err)
	}
	fileCount++

	// Conditionally copy app-init.go.tmpl => app-init.go
	if hasAppInit {
		destPath := filepath.Join(destDir, "app-init.go")
		if err := CopyFileFromFS(scaffoldFS, "app-init.go.tmpl", destPath); err != nil {
			return 0, fmt.Errorf("failed to copy app-init.go.tmpl: %w", err)
		}
		fileCount++
	}

	// Copy files by pattern (*.md, *.json, tailwind.css)
	patterns := []string{"*.md", "*.json", "tailwind.css"}

	for _, pattern := range patterns {
		matches, err := fs.Glob(scaffoldFS, pattern)
		if err != nil {
			return 0, fmt.Errorf("failed to glob pattern %s: %w", pattern, err)
		}

		for _, match := range matches {
			destPath := filepath.Join(destDir, match)
			if err := CopyFileFromFS(scaffoldFS, match, destPath); err != nil {
				return 0, fmt.Errorf("failed to copy %s: %w", match, err)
			}
			fileCount++
		}
	}

	return fileCount, nil
}

func MakeAppPackage(appFS fs.FS, appPath string, verbose bool, outputFile string) error {
	if verbose {
		log.Printf("Creating app package from %s to %s", appPath, outputFile)
	}

	// Create output directory if it doesn't exist
	outputDir := filepath.Dir(outputFile)
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// Create zip file
	zipFile, err := os.Create(outputFile)
	if err != nil {
		return fmt.Errorf("failed to create zip file: %w", err)
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	fileCount := 0

	// Add go.mod if it exists
	if err := addFileToZipIfExists(zipWriter, appFS, "go.mod", &fileCount, verbose); err != nil {
		return fmt.Errorf("failed to add go.mod: %w", err)
	}

	// Add go.sum if it exists
	if err := addFileToZipIfExists(zipWriter, appFS, "go.sum", &fileCount, verbose); err != nil {
		return fmt.Errorf("failed to add go.sum: %w", err)
	}

	// Add manifest.json if it exists
	if err := addFileToZipIfExists(zipWriter, appFS, "manifest.json", &fileCount, verbose); err != nil {
		return fmt.Errorf("failed to add manifest.json: %w", err)
	}

	// Add all *.go files
	if err := addGoFilesToZip(zipWriter, appFS, &fileCount, verbose); err != nil {
		return fmt.Errorf("failed to add go files: %w", err)
	}

	// Add static directory if it exists
	if err := addDirToZipIfExists(zipWriter, appFS, "static", &fileCount, verbose); err != nil {
		return fmt.Errorf("failed to add static directory: %w", err)
	}

	if verbose {
		log.Printf("Package created successfully with %d files", fileCount)
	}

	return nil
}
