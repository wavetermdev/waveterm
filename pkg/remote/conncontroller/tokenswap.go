// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
)

type TokenSwapEntry struct {
	Token      string
	Env        map[string]string
	ScriptText string
}

func encodeEnvVarsForBash(env map[string]string) (string, error) {
	var encoded string
	for k, v := range env {
		// validate key
		if !shellutil.IsValidEnvVarName(k) {
			return "", fmt.Errorf("invalid env var name: %q", k)
		}
		encoded += fmt.Sprintf("export %s=%s\n", k, shellutil.HardQuote(v))
	}
	return encoded, nil
}

func encodeEnvVarsForFish(env map[string]string) (string, error) {
	var encoded string
	for k, v := range env {
		// validate key
		if !shellutil.IsValidEnvVarName(k) {
			return "", fmt.Errorf("invalid env var name: %q", k)
		}
		encoded += fmt.Sprintf("set -x %s %s\n", k, shellutil.HardQuoteFish(v))
	}
	return encoded, nil
}

func encodeEnvVarsForPowerShell(env map[string]string) (string, error) {
	var encoded string
	for k, v := range env {
		// validate key
		if !shellutil.IsValidEnvVarName(k) {
			return "", fmt.Errorf("invalid env var name: %q", k)
		}
		encoded += fmt.Sprintf("$env:%s = %s\n", k, shellutil.HardQuotePowerShell(v))
	}
	return encoded, nil
}

func EncodeEnvVarsForShell(shellType string, env map[string]string) (string, error) {
	switch shellType {
	case shellutil.ShellType_bash, shellutil.ShellType_zsh:
		return encodeEnvVarsForBash(env)
	case shellutil.ShellType_fish:
		return encodeEnvVarsForFish(env)
	case shellutil.ShellType_pwsh:
		return encodeEnvVarsForPowerShell(env)
	default:
		return "", fmt.Errorf("unknown or unsupported shell type for env var encoding: %s", shellType)
	}
}

func (t *TokenSwapEntry) EncodeForShell(shellType string) (string, error) {
	encodedEnv, err := EncodeEnvVarsForShell(shellType, t.Env)
	if err != nil {
		return "", err
	}
	return encodedEnv + "\n" + t.ScriptText, nil
}
