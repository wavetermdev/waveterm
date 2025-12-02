// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package envutil

import (
	"fmt"
	"strings"
)

const MaxEnvSize = 1024 * 1024

// env format:
// KEY=VALUE\0
// keys cannot have '=' or '\0' in them
// values can have '=' but not '\0'

func EnvToMap(envStr string) map[string]string {
	rtn := make(map[string]string)
	envLines := strings.Split(envStr, "\x00")
	for _, line := range envLines {
		if len(line) == 0 {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			rtn[parts[0]] = parts[1]
		}
	}
	return rtn
}

func MapToEnv(envMap map[string]string) string {
	var sb strings.Builder
	for key, val := range envMap {
		sb.WriteString(key)
		sb.WriteByte('=')
		sb.WriteString(val)
		sb.WriteByte('\x00')
	}
	return sb.String()
}

func GetEnv(envStr string, key string) string {
	envMap := EnvToMap(envStr)
	return envMap[key]
}

func SetEnv(envStr string, key string, val string) (string, error) {
	if strings.ContainsAny(key, "=\x00") {
		return "", fmt.Errorf("key cannot contain '=' or '\\x00'")
	}
	if strings.Contains(val, "\x00") {
		return "", fmt.Errorf("value cannot contain '\\x00'")
	}
	if len(key)+len(val)+2+len(envStr) > MaxEnvSize {
		return "", fmt.Errorf("env string too large (max %d bytes)", MaxEnvSize)
	}
	envMap := EnvToMap(envStr)
	envMap[key] = val
	rtnStr := MapToEnv(envMap)
	return rtnStr, nil
}

func RmEnv(envStr string, key string) string {
	envMap := EnvToMap(envStr)
	delete(envMap, key)
	return MapToEnv(envMap)
}

func SliceToEnv(env []string) string {
	var sb strings.Builder
	for _, envVar := range env {
		if len(envVar) == 0 {
			continue
		}
		sb.WriteString(envVar)
		sb.WriteByte('\x00')
	}
	return sb.String()
}

func EnvToSlice(envStr string) []string {
	envLines := strings.Split(envStr, "\x00")
	result := make([]string, 0, len(envLines))
	for _, line := range envLines {
		if len(line) == 0 {
			continue
		}
		result = append(result, line)
	}
	return result
}
