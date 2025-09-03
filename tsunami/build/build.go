package build

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/tsunami/util"
	"golang.org/x/mod/modfile"
)

type BuildOpts struct {
	Dir            string
	Verbose        bool
	Open           bool
	ScaffoldPath   string
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

func verifyScaffoldPath(scaffoldPath string) error {
	if scaffoldPath == "" {
		return fmt.Errorf("scaffoldPath cannot be empty")
	}

	// Check if directory exists
	info, err := os.Stat(scaffoldPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("scaffoldPath directory %q does not exist", scaffoldPath)
		}
		return fmt.Errorf("error accessing scaffoldPath directory %q: %w", scaffoldPath, err)
	}

	if !info.IsDir() {
		return fmt.Errorf("scaffoldPath %q is not a directory", scaffoldPath)
	}

	// Check for dist directory
	distPath := filepath.Join(scaffoldPath, "dist")
	if err := IsDirOrNotFound(distPath); err != nil {
		return fmt.Errorf("dist directory check failed in scaffoldPath %q: %w", scaffoldPath, err)
	}
	info, err = os.Stat(distPath)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("dist directory must exist in scaffoldPath %q", scaffoldPath)
	}

	// Check for app-main.go file
	appMainPath := filepath.Join(scaffoldPath, "app-main.go")
	if err := CheckFileExists(appMainPath); err != nil {
		return fmt.Errorf("app-main.go check failed in scaffoldPath %q: %w", scaffoldPath, err)
	}

	// Check for tailwind.css file
	tailwindPath := filepath.Join(scaffoldPath, "tailwind.css")
	if err := CheckFileExists(tailwindPath); err != nil {
		return fmt.Errorf("tailwind.css check failed in scaffoldPath %q: %w", scaffoldPath, err)
	}

	// Check for package.json file
	packageJsonPath := filepath.Join(scaffoldPath, "package.json")
	if err := CheckFileExists(packageJsonPath); err != nil {
		return fmt.Errorf("package.json check failed in scaffoldPath %q: %w", scaffoldPath, err)
	}

	// Check for node_modules directory
	nodeModulesPath := filepath.Join(scaffoldPath, "node_modules")
	if err := IsDirOrNotFound(nodeModulesPath); err != nil {
		return fmt.Errorf("node_modules directory check failed in scaffoldPath %q: %w", scaffoldPath, err)
	}
	info, err = os.Stat(nodeModulesPath)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("node_modules directory must exist in scaffoldPath %q", scaffoldPath)
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

	if err := verifyScaffoldPath(opts.ScaffoldPath); err != nil {
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
	staticSrcDir := filepath.Join(opts.Dir, "static")
	staticDestDir := filepath.Join(tempDir, "static")
	staticCount, err := copyDirRecursive(staticSrcDir, staticDestDir, true)
	if err != nil {
		return nil, fmt.Errorf("failed to copy static directory: %w", err)
	}

	// Copy scaffold directory contents selectively
	scaffoldCount, err := copyScaffoldSelective(opts.ScaffoldPath, tempDir)
	if err != nil {
		return nil, fmt.Errorf("failed to copy scaffold directory: %w", err)
	}

	if opts.Verbose {
		log.Printf("Copied %d go files, %d static files, %d scaffold files\n", goCount, staticCount, scaffoldCount)
	}

	// Copy app-main.go from scaffold to main-app.go in temp dir
	appMainSrc := filepath.Join(tempDir, "app-main.go")
	appMainDest := filepath.Join(tempDir, "main-app.go")
	if err := os.Rename(appMainSrc, appMainDest); err != nil {
		return nil, fmt.Errorf("failed to rename app-main.go to main-app.go: %w", err)
	}

	// Create go.mod file
	appDirName := filepath.Base(opts.Dir)
	if err := createGoMod(tempDir, appDirName, buildEnv.GoVersion, opts, opts.Verbose); err != nil {
		return nil, fmt.Errorf("failed to create go.mod: %w", err)
	}

	// Generate Tailwind CSS
	if err := generateAppTailwindCss(tempDir, opts.Verbose); err != nil {
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

func generateAppTailwindCss(tempDir string, verbose bool) error {
	// tailwind.css is already in tempDir from scaffold copy
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
			log.Printf("Executing: %s", appPath)
			runCmd.Stdout = os.Stdout
			runCmd.Stderr = os.Stderr
		}

		if err := runCmd.Run(); err != nil {
			return fmt.Errorf("failed to run application: %w", err)
		}
	}

	return nil
}

func monitorAndOpenBrowser(stdout io.ReadCloser, verbose bool) {
	defer stdout.Close()

	scanner := bufio.NewScanner(stdout)
	urlRegex := regexp.MustCompile(`\[tsunami\] listening at (http://[^\s]+)`)
	browserOpened := false
	if verbose {
		log.Printf("monitoring for browser open\n")
	}

	for scanner.Scan() {
		line := scanner.Text()
		if verbose {
			log.Println(line)
		}

		if !browserOpened && len(urlRegex.FindStringSubmatch(line)) > 1 {
			matches := urlRegex.FindStringSubmatch(line)
			url := matches[1]
			if verbose {
				log.Printf("Opening browser to %s", url)
			}
			go util.OpenBrowser(url, 100*time.Millisecond)
			browserOpened = true
		}
	}

	// Continue reading and printing output if verbose
	if verbose {
		for scanner.Scan() {
			log.Println(scanner.Text())
		}
	}
}
