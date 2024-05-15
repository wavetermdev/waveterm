// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"context"
	"os"
	"os/exec"
	"os/user"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/wavebase"
)

const DefaultTermType = "xterm-256color"
const DefaultTermRows = 24
const DefaultTermCols = 80

var cachedMacUserShell string
var macUserShellOnce = &sync.Once{}
var userShellRegexp = regexp.MustCompile(`^UserShell: (.*)$`)

const DefaultShellPath = "/bin/bash"

func DetectLocalShellPath() string {
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

// dscl . -read /User/[username] UserShell
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

func WaveshellEnvVars(termType string) map[string]string {
	rtn := make(map[string]string)
	if termType != "" {
		rtn["TERM"] = termType
	}
	rtn["WAVETERM"], _ = os.Executable()
	rtn["WAVETERM_VERSION"] = wavebase.WaveVersion
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
