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

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
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

	//go:embed shellintegration/fish_wavefish.sh
	FishStartup_Wavefish string

	//go:embed shellintegration/pwsh_wavepwsh.sh
	PwshStartup_wavepwsh string
)

const DefaultTermType = "xterm-256color"
const DefaultTermRows = 24
const DefaultTermCols = 80

var cachedMacUserShell string
var macUserShellOnce = &sync.Once{}
var userShellRegexp = regexp.MustCompile(`^UserShell: (.*)$`)

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
	if runtime.GOOS == "windows" {
		wshDstPath = wshDstPath + ".exe"
	}
	err = utilfn.AtomicRenameCopy(wshDstPath, wshFullPath, 0755)
	if err != nil {
		return fmt.Errorf("error copying wsh binary to bin: %v", err)
	}
	wshBaseName := filepath.Base(wshFullPath)
	log.Printf("wsh binary successfully copied from %q to %q\n", wshBaseName, wshDstPath)
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
