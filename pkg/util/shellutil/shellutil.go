// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"context"
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

	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
)

const DefaultTermType = "xterm-256color"
const DefaultTermRows = 24
const DefaultTermCols = 80

var cachedMacUserShell string
var macUserShellOnce = &sync.Once{}
var userShellRegexp = regexp.MustCompile(`^UserShell: (.*)$`)

const DefaultShellPath = "/bin/bash"

const WaveAppPathVarName = "WAVETERM_APP_PATH"
const AppPathBinDir = "bin"

const (
	ZshIntegrationDir  = "zsh-integration"
	BashIntegrationDir = "bash-integration"
	WaveHomeBinDir     = "bin"

	ZshStartup_Zprofile = `
# Source the original zprofile
[ -f ~/.zprofile ] && source ~/.zprofile
`

	ZshStartup_Zshrc = `
# Source the original zshrc
[ -f ~/.zshrc ] && source ~/.zshrc

export PATH={{.WSHBINDIR}}:$PATH
`

	ZshStartup_Zlogin = `
# Source the original zlogin
[ -f ~/.zlogin ] && source ~/.zlogin
`

	ZshStartup_Zshenv = `
[ -f ~/.zshenv ] && source ~/.zshenv
`

	BashStartup_Bashrc = `
# Source /etc/profile if it exists
if [ -f /etc/profile ]; then
    . /etc/profile
fi

# Source the first of ~/.bash_profile, ~/.bash_login, or ~/.profile that exists
if [ -f ~/.bash_profile ]; then
    . ~/.bash_profile
elif [ -f ~/.bash_login ]; then
    . ~/.bash_login
elif [ -f ~/.profile ]; then
    . ~/.profile
fi

export PATH={{.WSHBINDIR}}:$PATH
`
)

func DetectLocalShellPath() string {
	if runtime.GOOS == "windows" {
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

func WaveshellLocalEnvVars(termType string) map[string]string {
	rtn := make(map[string]string)
	if termType != "" {
		rtn["TERM"] = termType
	}
	rtn["TERM_PROGRAM"] = "waveterm"
	rtn["WAVETERM"], _ = os.Executable()
	rtn["WAVETERM_VERSION"] = wavebase.WaveVersion
	rtn["WAVETERM_WSHBINDIR"] = filepath.Join(wavebase.GetWaveHomeDir(), WaveHomeBinDir)
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
			if newEnvVal == "" {
				continue
			}
			newEnv = append(newEnv, envKey+"="+newEnvVal)
			found[envKey] = true
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

func GetBashRcFileOverride() string {
	return filepath.Join(wavebase.GetWaveHomeDir(), BashIntegrationDir, ".bashrc")
}

func GetZshZDotDir() string {
	return filepath.Join(wavebase.GetWaveHomeDir(), ZshIntegrationDir)
}

func GetWshBinaryPath(version string, goos string, goarch string) string {
	ext := ""
	if goos == "windows" {
		ext = ".exe"
	}
	return filepath.Join(os.Getenv(WaveAppPathVarName), AppPathBinDir, fmt.Sprintf("wsh-%s-%s.%s%s", version, goos, goarch, ext))
}

func InitRcFiles(waveHome string, wshBinDir string) error {
	// ensure directiries exist
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

	// write files to directory
	zprofilePath := filepath.Join(zshDir, ".zprofile")
	err = os.WriteFile(zprofilePath, []byte(ZshStartup_Zprofile), 0644)
	if err != nil {
		return fmt.Errorf("error writing zsh-integration .zprofile: %v", err)
	}
	err = utilfn.WriteTemplateToFile(filepath.Join(zshDir, ".zshrc"), ZshStartup_Zshrc, map[string]string{"WSHBINDIR": fmt.Sprintf(`"%s"`, wshBinDir)})
	if err != nil {
		return fmt.Errorf("error writing zsh-integration .zshrc: %v", err)
	}
	zloginPath := filepath.Join(zshDir, ".zlogin")
	err = os.WriteFile(zloginPath, []byte(ZshStartup_Zlogin), 0644)
	if err != nil {
		return fmt.Errorf("error writing zsh-integration .zlogin: %v", err)
	}
	zshenvPath := filepath.Join(zshDir, ".zshenv")
	err = os.WriteFile(zshenvPath, []byte(ZshStartup_Zshenv), 0644)
	if err != nil {
		return fmt.Errorf("error writing zsh-integration .zshenv: %v", err)
	}
	err = utilfn.WriteTemplateToFile(filepath.Join(bashDir, ".bashrc"), BashStartup_Bashrc, map[string]string{"WSHBINDIR": fmt.Sprintf(`"%s"`, wshBinDir)})
	if err != nil {
		return fmt.Errorf("error writing bash-integration .bashrc: %v", err)
	}

	return nil
}

func initCustomShellStartupFilesInternal() error {
	log.Printf("initializing wsh and shell startup files\n")
	waveHome := wavebase.GetWaveHomeDir()
	binDir := filepath.Join(waveHome, WaveHomeBinDir)
	err := InitRcFiles(waveHome, `$WAVETERM_WSHBINDIR`)
	if err != nil {
		return err
	}

	err = wavebase.CacheEnsureDir(binDir, WaveHomeBinDir, 0755, WaveHomeBinDir)
	if err != nil {
		return err
	}

	// copy the correct binary to bin
	wshFullPath := GetWshBinaryPath(wavebase.WaveVersion, runtime.GOOS, runtime.GOARCH)
	if _, err := os.Stat(wshFullPath); err != nil {
		log.Printf("error (non-fatal), could not resolve wsh binary %q: %v\n", wshFullPath, err)
		return nil
	}
	wshDstPath := filepath.Join(binDir, "wsh")
	err = utilfn.AtomicRenameCopy(wshDstPath, wshFullPath, 0755)
	if err != nil {
		return fmt.Errorf("error copying wsh binary to bin: %v", err)
	}
	log.Printf("wsh binary successfully %q copied to %q\n", computeWshBaseName(), wshDstPath)
	return nil
}

func computeWshBaseName() string {
	return fmt.Sprintf("wsh-%s-%s.%s", wavebase.WaveVersion, runtime.GOOS, runtime.GOARCH)
}
