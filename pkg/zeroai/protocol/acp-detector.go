// Package protocol provides ACP CLI detection capabilities
package protocol

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

// CLIInfo represents information about a detected CLI tool
type CLIInfo struct {
	Backend       AcpBackend `json:"backend"`
	Name          string     `json:"name"`
	Path          string     `json:"path"`
	Version       string     `json:"version,omitempty"`
	IsAvailable   bool       `json:"isAvailable"`
	AuthRequired  bool       `json:"authRequired"`
	StdioSupport  bool       `json:"stdioSupport"`
}

// DetectionConfig holds configuration for CLI detection
type DetectionConfig struct {
	// SearchPaths are additional paths to search for CLI executables
	SearchPaths []string
	// Timeout is the timeout for version checks (in seconds)
	Timeout int
	// SkipVersionCheck skips the slow version check
	SkipVersionCheck bool
}

// DefaultDetectionConfig returns the default detection configuration
func DefaultDetectionConfig() *DetectionConfig {
	return &DetectionConfig{
		SearchPaths:      []string{},
		Timeout:          5,
		SkipVersionCheck: false,
	}
}

// DetectCLIs detects available ACP CLI tools on the system
func DetectCLIs(cfg *DetectionConfig) map[AcpBackend]CLIInfo {
	if cfg == nil {
		cfg = DefaultDetectionConfig()
	}

	result := make(map[AcpBackend]CLIInfo)
	var wg sync.WaitGroup
	var mu sync.Mutex

	backends := []AcpBackend{
		AcpBackendClaude,
		AcpBackendQwen,
		AcpBackendCodex,
		AcpBackendGemini,
		AcpBackendOpenCode,
	}

	for _, backend := range backends {
		wg.Add(1)
		go func(b AcpBackend) {
			defer wg.Done()
			info := detectBackendCLI(b, cfg)
			mu.Lock()
			result[b] = info
			mu.Unlock()
		}(backend)
	}

	wg.Wait()

	return result
}

// detectBackendCLI detects a specific backend CLI
func detectBackendCLI(backend AcpBackend, cfg *DetectionConfig) CLIInfo {
	config, err := GetBackendConfig(backend)
	if err != nil {
		return CLIInfo{
			Backend:      backend,
			Name:         string(backend),
			IsAvailable:  false,
			AuthRequired: true,
			StdioSupport: false,
		}
	}

	cliPath := findExecutable(config.CliCommand)
	if cliPath == "" {
		// Try default CLI path if specified
		if config.DefaultCliPath != "" {
			cliPath = findExecutable(config.DefaultCliPath)
		}
	}

	if cliPath == "" {
		return CLIInfo{
			Backend:      backend,
			Name:         config.Name,
			Path:         "",
			IsAvailable:  false,
			AuthRequired: config.AuthRequired,
			StdioSupport: config.SupportsStreaming,
		}
	}

	info := CLIInfo{
		Backend:      backend,
		Name:         config.Name,
		Path:         cliPath,
		IsAvailable:  true,
		AuthRequired: config.AuthRequired,
		StdioSupport: config.SupportsStreaming,
	}

	// Check for version if not skipped
	if !cfg.SkipVersionCheck {
		info.Version = getCLIVersion(cliPath, cfg.Timeout)
	}

	return info
}

// findExecutable finds an executable by name on the system PATH
func findExecutable(execName string) string {
	if runtime.GOOS == "windows" {
		return findExecutableWindows(execName)
	}
	return findExecutableUnix(execName)
}

// findExecutableUnix finds an executable on Unix-like systems
func findExecutableUnix(execName string) string {
	// Check common locations
	commonPaths := []string{
		"/usr/local/bin/",
		"/usr/bin/",
		"/opt/homebrew/bin/",
		"/snap/bin/",
		"~/.local/bin/",
		"~/bin/",
	}

	// First check PATH
	if path, err := exec.LookPath(execName); err == nil {
		return path
	}

	// Then check common locations
	for _, dir := range commonPaths {
		fullPath := expandPath(dir + execName)
		if fileExists(fullPath) && isExecutable(fullPath) {
			return fullPath
		}
	}

	// Try with .exe extension on some systems
	for _, dir := range commonPaths {
		fullPath := expandPath(dir + execName + ".exe")
		if fileExists(fullPath) && isExecutable(fullPath) {
			return fullPath
		}
	}

	return ""
}

// findExecutableWindows finds an executable on Windows
func findExecutableWindows(execName string) string {
	cmds := []struct {
		name   string
		args   []string
		output string
	}{
		// PowerShell Get-Command
		{"powershell.exe", []string{"-NoProfile", "-Command", fmt.Sprintf("Get-Command -ErrorAction SilentlyContinue %s | Select-Object -ExpandProperty Source", execName)}, ""},
		// where (legacy)
		{"cmd.exe", []string{"/c", fmt.Sprintf("where %s 2>nul", execName)}, ""},
		// Get-Command with .exe
		{"powershell.exe", []string{"-NoProfile", "-Command", fmt.Sprintf("Get-Command -ErrorAction SilentlyContinue %s.exe | Select-Object -ExpandProperty Source", execName)}, ""},
	}

	for _, cmd := range cmds {
		output, err := exec.Command(cmd.name, cmd.args...).CombinedOutput()
		if err == nil && len(output) > 0 {
			path := strings.TrimSpace(string(output))
			if fileExists(path) {
				return path
			}
		}
	}

	// Check common Windows paths
	windowsPaths := []string{
		"C:\\Program Files\\",
		"C:\\Program Files (x86)\\",
		"%LOCALAPPDATA%\\",
		"%APPDATA%\\",
	}

	for _, dir := range windowsPaths {
		expanded := expandPath(dir)
		if matches, _ := findInDirectory(expanded, execName); len(matches) > 0 {
			return matches[0]
		}
	}

	return ""
}

// expandPath expands ~ and environment variables in a path
func expandPath(path string) string {
	path = strings.ReplaceAll(path, "~/", "")
	path = strings.ReplaceAll(path, "~", "")

	// Expand environment variables on Windows
	if runtime.GOOS == "windows" {
		path = os.ExpandEnv(path)
	}

	// Handle simple environment variables like $HOME on Unix
	if strings.HasPrefix(path, "$") {
		envName := strings.TrimPrefix(path, "$")
		if envValue := strings.TrimSpace(envName); envValue != "" {
			return envValue
		}
	}

	return path
}

// fileExists checks if a file exists
func fileExists(path string) bool {
	if path == "" {
		return false
	}
	_, err := exec.Command("test", "-f", path).CombinedOutput()
	if err != nil && runtime.GOOS == "windows" {
		// Windows fallback
		_, err = exec.Command("cmd.exe", "/c", "if exist "+path+" (echo 1)").CombinedOutput()
		return err == nil
	}
	return err == nil
}

// isExecutable checks if a file is executable
func isExecutable(path string) bool {
	if path == "" {
		return false
	}
	_, err := exec.Command("test", "-x", path).CombinedOutput()
	if err != nil && runtime.GOOS == "windows" {
		// Windows fallback - .exe files are executable
		return strings.HasSuffix(strings.ToLower(path), ".exe") || strings.HasSuffix(strings.ToLower(path), ". bat")
	}
	return err == nil
}

// findInDirectory recursively finds files matching a pattern
func findInDirectory(dir, pattern string) ([]string, error) {
	var matches []string

	if runtime.GOOS == "windows" {
		// Use PowerShell for Windows
		output, err := exec.Command(
			"powershell.exe",
			"-NoProfile",
			"-Command",
			fmt.Sprintf("Get-ChildItem -Path '%s' -Recurse -Filter '*%s*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName", dir, pattern),
		).CombinedOutput()
		if err == nil {
			lines := strings.Split(strings.TrimSpace(string(output)), "\n")
			for _, line := range lines {
				if line != "" {
					matches = append(matches, line)
				}
			}
		}
	} else {
		// Use find for Unix
		output, err := exec.Command("find", dir, "-iname", "*"+pattern+"*", "-type", "f").CombinedOutput()
		if err == nil {
			lines := strings.Split(strings.TrimSpace(string(output)), "\n")
			for _, line := range lines {
				if line != "" {
					matches = append(matches, line)
				}
			}
		}
	}

	return matches, nil
}

// getCLIVersion attempts to get the version of a CLI tool
func getCLIVersion(cliPath string, timeoutSeconds int) string {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSeconds)*time.Second)
	defer cancel()

	// Try common version flags
	versionFlags := []string{
		"--version",
		"version",
		"-v",
		"--v",
		"-V",
		"--V",
	}

	for _, flag := range versionFlags {
		cmd := exec.CommandContext(ctx, cliPath, flag)
		output, err := cmd.CombinedOutput()
		if err == nil && len(output) > 0 {
			version := strings.TrimSpace(string(output))
			if version != "" && !strings.Contains(strings.ToLower(version), "error") {
				// Clean up version string (take first line, truncate if too long)
				lines := strings.Split(version, "\n")
				if len(lines[0]) > 50 {
					return lines[0][:50] + "..."
				}
				return lines[0]
			}
		}
	}

	return ""
}

// DetectCLI detects a specific CLI tool
func DetectCLI(backend AcpBackend) (CLIInfo, error) {
	return detectBackendCLI(backend, &DetectionConfig{
		Timeout:          5,
		SkipVersionCheck: false,
	}).ToBackendInfo()
}

// DetectCLIsParallel detects CLIs in parallel with context support
func DetectCLIsParallel(ctx context.Context) map[AcpBackend]CLIInfo {
	result := make(map[AcpBackend]CLIInfo)
	backends := []AcpBackend{
		AcpBackendClaude,
		AcpBackendQwen,
		AcpBackendCodex,
		AcpBackendGemini,
		AcpBackendOpenCode,
	}

	type detectionResult struct {
		backend AcpBackend
		info    CLIInfo
	}

	ch := make(chan detectionResult, len(backends))

	for _, backend := range backends {
		go func(b AcpBackend) {
			info := detectBackendCLI(b, &DetectionConfig{
				Timeout:          5,
				SkipVersionCheck: false,
			})
			select {
			case ch <- detectionResult{backend: b, info: info}:
			case <-ctx.Done():
				return
			}
		}(backend)
	}

	for i := 0; i < len(backends); i++ {
		select {
		case res := <-ch:
			result[res.backend] = res.info
		case <-ctx.Done():
			return result
		}
	}

	return result
}

// ToBackendInfo converts CLIInfo to backend-specific info
func (info CLIInfo) ToBackendInfo() (CLIInfo, error) {
	if !info.IsAvailable {
		return info, fmt.Errorf("CLI %s is not available", info.Name)
	}
	return info, nil
}

// String returns a string representation of CLIInfo
func (info CLIInfo) String() string {
	status := "available"
	if !info.IsAvailable {
		status = "not found"
	}
	versionInfo := ""
	if info.Version != "" {
		versionInfo = fmt.Sprintf(" (v%s)", info.Version)
	}
	return fmt.Sprintf("%s%s: %s%s",
		info.Name,
		versionInfo,
		status,
		map[bool]string{true: " [auth required]", false: ""}[info.AuthRequired],
	)
}

// GetAvailableCLIs returns a list of available CLI tools
func GetAvailableCLIs() []CLIInfo {
	detected := DetectCLIs(nil)
	var available []CLIInfo
	for _, info := range detected {
		if info.IsAvailable {
			available = append(available, info)
		}
	}
	return available
}

// GetCLIPaths returns a map of backend to CLI paths
func GetCLIPaths() map[AcpBackend]string {
	info := DetectCLIs(nil)
	result := make(map[AcpBackend]string)
	for backend, cliInfo := range info {
		if cliInfo.IsAvailable {
			result[backend] = cliInfo.Path
		}
	}
	return result
}

// IsCLIAvailable checks if a specific CLI is available
func IsCLIAvailable(backend AcpBackend) bool {
	info, err := DetectCLI(backend)
	return err == nil && info.IsAvailable
}
