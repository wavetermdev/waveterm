// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"context"
	_ "embed"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

var (
	//go:embed shellintegration/zsh_zprofile.sh
	ZshStartup_Zprofile string

	//go:embed shellintegration/zsh_zshrc.sh
	ZshStartup_Zshrc string

	//go:embed shellintegration/zsh_zlogin.sh
	ZshStartup_Zlogin string

	//go:embed shellintegration/zsh_zshenv.sh
	ZshStartup_Zshenv string

	//go:embed shellintegration/bash_bashrc.sh
	BashStartup_Bashrc string

	//go:embed shellintegration/bash_preexec.sh
	BashStartup_Preexec string

	//go:embed shellintegration/fish_wavefish.sh
	FishStartup_Wavefish string

	//go:embed shellintegration/pwsh_wavepwsh.sh
	PwshStartup_wavepwsh string

	ZshExtendedHistoryPattern = regexp.MustCompile(`^: [0-9]+:`)
)

const DefaultTermType = "xterm-256color"
const DefaultTermRows = 24
const DefaultTermCols = 80

var cachedMacUserShell string
var macUserShellOnce = &sync.Once{}
var userShellRegexp = regexp.MustCompile(`^UserShell: (.*)$`)

var gitBashCache = utilds.MakeSyncCache(findInstalledGitBash)

const DefaultShellPath = "/bin/bash"

const (
	ShellType_bash    = "bash"
	ShellType_zsh     = "zsh"
	ShellType_fish    = "fish"
	ShellType_pwsh    = "pwsh"
	ShellType_unknown = "unknown"
)

const (
	// there must be no spaces in these integration dir paths
	ZshIntegrationDir  = "shell/zsh"
	BashIntegrationDir = "shell/bash"
	PwshIntegrationDir = "shell/pwsh"
	FishIntegrationDir = "shell/fish"
	WaveHomeBinDir     = "bin"
	ZshHistoryFileName = ".zsh_history"
)

func DetectLocalShellPath() string {
	if runtime.GOOS == "windows" {
		if pwshPath, lpErr := exec.LookPath("pwsh"); lpErr == nil {
			return pwshPath
		}
		if powershellPath, lpErr := exec.LookPath("powershell"); lpErr == nil {
			return powershellPath
		}
		return "powershell.exe"
	}
	shellPath := GetMacUserShell()
	if shellPath == "" {
		shellPath = os.Getenv("SHELL")
	}
	if shellPath == "" {
		return DefaultShellPath
	}
	return shellPath
}

func GetMacUserShell() string {
	if runtime.GOOS != "darwin" {
		return ""
	}
	macUserShellOnce.Do(func() {
		cachedMacUserShell = internalMacUserShell()
	})
	return cachedMacUserShell
}

// dscl . -read /Users/[username] UserShell
// defaults to /bin/bash
func internalMacUserShell() string {
	osUser, err := user.Current()
	if err != nil {
		return DefaultShellPath
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	userStr := "/Users/" + osUser.Username
	out, err := exec.CommandContext(ctx, "dscl", ".", "-read", userStr, "UserShell").CombinedOutput()
	if err != nil {
		return DefaultShellPath
	}
	outStr := strings.TrimSpace(string(out))
	m := userShellRegexp.FindStringSubmatch(outStr)
	if m == nil {
		return DefaultShellPath
	}
	return m[1]
}

func hasDirPart(dir string, part string) bool {
	dir = filepath.Clean(dir)
	part = strings.ToLower(part)
	for {
		base := strings.ToLower(filepath.Base(dir))
		if base == part {
			return true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return false
}

func FindGitBash(config *wconfig.FullConfigType, rescan bool) string {
	if runtime.GOOS != "windows" {
		return ""
	}

	if config != nil && config.Settings.TermGitBashPath != "" {
		return config.Settings.TermGitBashPath
	}

	path, _ := gitBashCache.Get(rescan)
	return path
}

func findInstalledGitBash() (string, error) {
	// Try PATH first (skip system32, and only accept if in a Git directory)
	pathEnv := os.Getenv("PATH")
	pathDirs := filepath.SplitList(pathEnv)
	for _, dir := range pathDirs {
		dir = strings.Trim(dir, `"`)
		if hasDirPart(dir, "system32") {
			continue
		}
		if !hasDirPart(dir, "git") {
			continue
		}
		bashPath := filepath.Join(dir, "bash.exe")
		if _, err := os.Stat(bashPath); err == nil {
			return bashPath, nil
		}
	}

	// Try scoop location
	userProfile := os.Getenv("USERPROFILE")
	if userProfile != "" {
		scoopPath := filepath.Join(userProfile, "scoop", "apps", "git", "current", "bin", "bash.exe")
		if _, err := os.Stat(scoopPath); err == nil {
			return scoopPath, nil
		}
	}

	// Try LocalAppData\programs\git\bin
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData != "" {
		localPath := filepath.Join(localAppData, "programs", "git", "bin", "bash.exe")
		if _, err := os.Stat(localPath); err == nil {
			return localPath, nil
		}
	}

	// Try C:\Program Files\Git\bin
	programFilesPath := filepath.Join("C:\\", "Program Files", "Git", "bin", "bash.exe")
	if _, err := os.Stat(programFilesPath); err == nil {
		return programFilesPath, nil
	}

	return "", nil
}

func DefaultTermSize() waveobj.TermSize {
	return waveobj.TermSize{Rows: DefaultTermRows, Cols: DefaultTermCols}
}

func WaveshellLocalEnvVars(termType string) map[string]string {
	rtn := make(map[string]string)
	if termType != "" {
		rtn["TERM"] = termType
	}
	// these are not necessary since they should be set with the swap token, but no harm in setting them here
	rtn["TERM_PROGRAM"] = "waveterm"
	rtn["WAVETERM"], _ = os.Executable()
	rtn["WAVETERM_VERSION"] = wavebase.WaveVersion
	rtn["WAVETERM_WSHBINDIR"] = filepath.Join(wavebase.GetWaveDataDir(), WaveHomeBinDir)
	return rtn
}

func UpdateCmdEnv(cmd *exec.Cmd, envVars map[string]string) {
	if len(envVars) == 0 {
		return
	}
	found := make(map[string]bool)
	var newEnv []string
	for _, envStr := range cmd.Env {
		envKey := GetEnvStrKey(envStr)
		newEnvVal, ok := envVars[envKey]
		if ok {
			found[envKey] = true
			if newEnvVal != "" {
				newEnv = append(newEnv, envKey+"="+newEnvVal)
			}
		} else {
			newEnv = append(newEnv, envStr)
		}
	}
	for envKey, envVal := range envVars {
		if found[envKey] {
			continue
		}
		newEnv = append(newEnv, envKey+"="+envVal)
	}
	cmd.Env = newEnv
}

func GetEnvStrKey(envStr string) string {
	eqIdx := strings.Index(envStr, "=")
	if eqIdx == -1 {
		return envStr
	}
	return envStr[0:eqIdx]
}

var initStartupFilesOnce = &sync.Once{}

// in a Once block so it can be called multiple times
// we run it at startup, but also before launching local shells so we know everything is initialized before starting the shell
func InitCustomShellStartupFiles() error {
	var err error
	initStartupFilesOnce.Do(func() {
		err = initCustomShellStartupFilesInternal()
	})
	return err
}

func GetLocalBashRcFileOverride() string {
	return filepath.Join(wavebase.GetWaveDataDir(), BashIntegrationDir, ".bashrc")
}

func GetLocalWaveFishFilePath() string {
	return filepath.Join(wavebase.GetWaveDataDir(), FishIntegrationDir, "wave.fish")
}

func GetLocalWavePowershellEnv() string {
	return filepath.Join(wavebase.GetWaveDataDir(), PwshIntegrationDir, "wavepwsh.ps1")
}

func GetLocalZshZDotDir() string {
	return filepath.Join(wavebase.GetWaveDataDir(), ZshIntegrationDir)
}

func HasWaveZshHistory() (bool, int64) {
	zshDir := GetLocalZshZDotDir()
	historyFile := filepath.Join(zshDir, ZshHistoryFileName)
	fileInfo, err := os.Stat(historyFile)
	if err != nil {
		return false, 0
	}
	return true, fileInfo.Size()
}

func IsExtendedZshHistoryFile(fileName string) (bool, error) {
	file, err := os.Open(fileName)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	defer file.Close()

	buf := make([]byte, 1024)
	n, err := file.Read(buf)
	if err != nil {
		return false, err
	}

	content := string(buf[:n])
	lines := strings.Split(content, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		return ZshExtendedHistoryPattern.MatchString(line), nil
	}

	return false, nil
}

func GetLocalWshBinaryPath(version string, goos string, goarch string) (string, error) {
	ext := ""
	if goarch == "amd64" {
		goarch = "x64"
	}
	if goarch == "aarch64" {
		goarch = "arm64"
	}
	if goos == "windows" {
		ext = ".exe"
	}
	if !wavebase.SupportedWshBinaries[fmt.Sprintf("%s-%s", goos, goarch)] {
		return "", fmt.Errorf("unsupported wsh platform: %s-%s", goos, goarch)
	}
	baseName := fmt.Sprintf("wsh-%s-%s.%s%s", version, goos, goarch, ext)
	return filepath.Join(wavebase.GetWaveAppBinPath(), baseName), nil
}

// absWshBinDir must be an absolute, expanded path (no ~ or $HOME, etc.)
// it will be hard-quoted appropriately for the shell
func InitRcFiles(waveHome string, absWshBinDir string) error {
	// ensure directories exist
	zshDir := filepath.Join(waveHome, ZshIntegrationDir)
	err := wavebase.CacheEnsureDir(zshDir, ZshIntegrationDir, 0755, ZshIntegrationDir)
	if err != nil {
		return err
	}
	bashDir := filepath.Join(waveHome, BashIntegrationDir)
	err = wavebase.CacheEnsureDir(bashDir, BashIntegrationDir, 0755, BashIntegrationDir)
	if err != nil {
		return err
	}
	fishDir := filepath.Join(waveHome, FishIntegrationDir)
	err = wavebase.CacheEnsureDir(fishDir, FishIntegrationDir, 0755, FishIntegrationDir)
	if err != nil {
		return err
	}
	pwshDir := filepath.Join(waveHome, PwshIntegrationDir)
	err = wavebase.CacheEnsureDir(pwshDir, PwshIntegrationDir, 0755, PwshIntegrationDir)
	if err != nil {
		return err
	}

	var pathSep string
	if runtime.GOOS == "windows" {
		pathSep = ";"
	} else {
		pathSep = ":"
	}
	params := map[string]string{
		"WSHBINDIR":      HardQuote(absWshBinDir),
		"WSHBINDIR_PWSH": HardQuotePowerShell(absWshBinDir),
		"PATHSEP":        pathSep,
	}

	// write files to directory
	err = utilfn.WriteTemplateToFile(filepath.Join(zshDir, ".zprofile"), ZshStartup_Zprofile, params)
	if err != nil {
		return fmt.Errorf("error writing zsh-integration .zprofile: %v", err)
	}
	err = utilfn.WriteTemplateToFile(filepath.Join(zshDir, ".zshrc"), ZshStartup_Zshrc, params)
	if err != nil {
		return fmt.Errorf("error writing zsh-integration .zshrc: %v", err)
	}
	err = utilfn.WriteTemplateToFile(filepath.Join(zshDir, ".zlogin"), ZshStartup_Zlogin, params)
	if err != nil {
		return fmt.Errorf("error writing zsh-integration .zlogin: %v", err)
	}
	err = utilfn.WriteTemplateToFile(filepath.Join(zshDir, ".zshenv"), ZshStartup_Zshenv, params)
	if err != nil {
		return fmt.Errorf("error writing zsh-integration .zshenv: %v", err)
	}
	err = utilfn.WriteTemplateToFile(filepath.Join(bashDir, ".bashrc"), BashStartup_Bashrc, params)
	if err != nil {
		return fmt.Errorf("error writing bash-integration .bashrc: %v", err)
	}
	err = os.WriteFile(filepath.Join(bashDir, "bash_preexec.sh"), []byte(BashStartup_Preexec), 0644)
	if err != nil {
		return fmt.Errorf("error writing bash-integration bash_preexec.sh: %v", err)
	}
	err = utilfn.WriteTemplateToFile(filepath.Join(fishDir, "wave.fish"), FishStartup_Wavefish, params)
	if err != nil {
		return fmt.Errorf("error writing fish-integration wave.fish: %v", err)
	}
	err = utilfn.WriteTemplateToFile(filepath.Join(pwshDir, "wavepwsh.ps1"), PwshStartup_wavepwsh, params)
	if err != nil {
		return fmt.Errorf("error writing pwsh-integration wavepwsh.ps1: %v", err)
	}

	return nil
}

func initCustomShellStartupFilesInternal() error {
	log.Printf("initializing wsh and shell startup files\n")
	waveDataHome := wavebase.GetWaveDataDir()
	binDir := filepath.Join(waveDataHome, WaveHomeBinDir)
	err := InitRcFiles(waveDataHome, binDir)
	if err != nil {
		return err
	}

	err = wavebase.CacheEnsureDir(binDir, WaveHomeBinDir, 0755, WaveHomeBinDir)
	if err != nil {
		return err
	}

	// copy the correct binary to bin
	wshFullPath, err := GetLocalWshBinaryPath(wavebase.WaveVersion, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		log.Printf("error (non-fatal), could not resolve wsh binary path: %v\n", err)
	}
	if _, err := os.Stat(wshFullPath); err != nil {
		log.Printf("error (non-fatal), could not resolve wsh binary %q: %v\n", wshFullPath, err)
		return nil
	}
	wshDstPath := filepath.Join(binDir, "wsh")
	waveDstPath := filepath.Join(binDir, "wave")
	if runtime.GOOS == "windows" {
		wshDstPath = wshDstPath + ".exe"
		waveDstPath = waveDstPath + ".exe"
	}
	err = utilfn.AtomicRenameCopy(wshDstPath, wshFullPath, 0755)
	if err != nil {
		return fmt.Errorf("error copying wsh binary to bin: %v", err)
	}
	err = utilfn.AtomicRenameCopy(waveDstPath, wshFullPath, 0755)
	if err != nil {
		return fmt.Errorf("error copying wave binary to bin: %v", err)
	}
	wshBaseName := filepath.Base(wshFullPath)
	log.Printf("wsh binary successfully copied from %q to %q and %q\n", wshBaseName, wshDstPath, waveDstPath)
	return nil
}

func GetShellTypeFromShellPath(shellPath string) string {
	shellBase := filepath.Base(shellPath)
	if strings.Contains(shellBase, "bash") {
		return ShellType_bash
	}
	if strings.Contains(shellBase, "zsh") {
		return ShellType_zsh
	}
	if strings.Contains(shellBase, "fish") {
		return ShellType_fish
	}
	if strings.Contains(shellBase, "pwsh") || strings.Contains(shellBase, "powershell") {
		return ShellType_pwsh
	}
	return ShellType_unknown
}

var (
	bashVersionRegexp = regexp.MustCompile(`\bversion\s+(\d+\.\d+)`)
	zshVersionRegexp  = regexp.MustCompile(`\bzsh\s+(\d+\.\d+)`)
	fishVersionRegexp = regexp.MustCompile(`\bversion\s+(\d+\.\d+)`)
	pwshVersionRegexp = regexp.MustCompile(`(?:PowerShell\s+)?(\d+\.\d+)`)
)

func DetectShellTypeAndVersion() (string, string, error) {
	shellPath := DetectLocalShellPath()
	return DetectShellTypeAndVersionFromPath(shellPath)
}

func DetectShellTypeAndVersionFromPath(shellPath string) (string, string, error) {
	shellType := GetShellTypeFromShellPath(shellPath)
	if shellType == ShellType_unknown {
		return shellType, "", fmt.Errorf("unknown shell type: %s", shellPath)
	}

	shellBase := filepath.Base(shellPath)
	if shellType == ShellType_pwsh && strings.Contains(shellBase, "powershell") && !strings.Contains(shellBase, "pwsh") {
		return "powershell", "", nil
	}

	version, err := getShellVersion(shellPath, shellType)
	if err != nil {
		return shellType, "", err
	}

	return shellType, version, nil
}

func getShellVersion(shellPath string, shellType string) (string, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()

	var cmd *exec.Cmd
	var versionRegex *regexp.Regexp

	switch shellType {
	case ShellType_bash:
		cmd = exec.CommandContext(ctx, shellPath, "--version")
		versionRegex = bashVersionRegexp
	case ShellType_zsh:
		cmd = exec.CommandContext(ctx, shellPath, "--version")
		versionRegex = zshVersionRegexp
	case ShellType_fish:
		cmd = exec.CommandContext(ctx, shellPath, "--version")
		versionRegex = fishVersionRegexp
	case ShellType_pwsh:
		cmd = exec.CommandContext(ctx, shellPath, "--version")
		versionRegex = pwshVersionRegexp
	default:
		return "", fmt.Errorf("unsupported shell type: %s", shellType)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to get version for %s: %w", shellType, err)
	}

	outputStr := strings.TrimSpace(string(output))
	matches := versionRegex.FindStringSubmatch(outputStr)
	if len(matches) < 2 {
		return "", fmt.Errorf("failed to parse version from output: %q", outputStr)
	}

	return matches[1], nil
}

func FixupWaveZshHistory() error {
	if runtime.GOOS != "darwin" {
		return nil
	}

	hasHistory, size := HasWaveZshHistory()
	if !hasHistory {
		return nil
	}

	zshDir := GetLocalZshZDotDir()
	waveHistFile := filepath.Join(zshDir, ZshHistoryFileName)

	if size == 0 {
		err := os.Remove(waveHistFile)
		if err != nil {
			log.Printf("error removing wave zsh history file %s: %v\n", waveHistFile, err)
		}
		return nil
	}

	log.Printf("merging wave zsh history %s into ~/.zsh_history\n", waveHistFile)

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("error getting home directory: %w", err)
	}
	realHistFile := filepath.Join(homeDir, ".zsh_history")

	isExtended, err := IsExtendedZshHistoryFile(realHistFile)
	if err != nil {
		return fmt.Errorf("error checking if history is extended: %w", err)
	}

	hasExtendedStr := "false"
	if isExtended {
		hasExtendedStr = "true"
	}

	quotedWaveHistFile := utilfn.ShellQuote(waveHistFile, true, -1)

	script := fmt.Sprintf(`
		HISTFILE=~/.zsh_history
		HISTSIZE=999999
		SAVEHIST=999999
		has_extended_history=%s
		[[ $has_extended_history == true ]] && setopt EXTENDED_HISTORY
		fc -RI
		fc -RI %s
		fc -W
	`, hasExtendedStr, quotedWaveHistFile)

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()

	cmd := exec.CommandContext(ctx, "zsh", "-f", "-i", "-c", script)
	cmd.Stdin = nil
	envStr := envutil.SliceToEnv(os.Environ())
	envStr = envutil.RmEnv(envStr, "ZDOTDIR")
	cmd.Env = envutil.EnvToSlice(envStr)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("error executing zsh history fixup script: %w, output: %s", err, string(output))
	}

	err = os.Remove(waveHistFile)
	if err != nil {
		log.Printf("error removing wave zsh history file %s: %v\n", waveHistFile, err)
	}
	log.Printf("successfully merged wave zsh history %s into ~/.zsh_history\n", waveHistFile)

	return nil
}

func FormatOSC(oscNum int, parts ...string) string {
	if len(parts) == 0 {
		return fmt.Sprintf("\x1b]%d\x07", oscNum)
	}
	return fmt.Sprintf("\x1b]%d;%s\x07", oscNum, strings.Join(parts, ";"))
}
