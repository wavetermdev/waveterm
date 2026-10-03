// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var tokenSwapMap map[string]*TokenSwapEntry = make(map[string]*TokenSwapEntry)
var tokenMapLock = &sync.Mutex{}

type TokenSwapEntry struct {
	Token      string             `json:"token"`
	RpcContext *wshrpc.RpcContext `json:"rpccontext,omitempty"`
	Env        map[string]string  `json:"env,omitempty"`
	ScriptText string             `json:"scripttext,omitempty"`
	Exp        time.Time          `json:"-"`
}

type UnpackedTokenType struct {
	Token      string             `json:"token"` // uuid
	RpcContext *wshrpc.RpcContext `json:"rpccontext,omitempty"`
}

func (t *UnpackedTokenType) Pack() (string, error) {
	// convert to json, and then base64 encode
	barr, err := json.Marshal(t)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(barr), nil
}

func UnpackSwapToken(token string) (*UnpackedTokenType, error) {
	// base64 decode, then convert from json
	barr, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return nil, err
	}
	var unpacked UnpackedTokenType
	err = json.Unmarshal(barr, &unpacked)
	if err != nil {
		return nil, err
	}
	return &unpacked, nil
}

func (t *TokenSwapEntry) PackForClient() (string, error) {
	unpackedToken := &UnpackedTokenType{
		Token:      t.Token,
		RpcContext: t.RpcContext,
	}
	return unpackedToken.Pack()
}

func removeExpiredTokens() {
	now := time.Now()
	tokenMapLock.Lock()
	defer tokenMapLock.Unlock()
	for k, v := range tokenSwapMap {
		if v.Exp.Before(now) {
			delete(tokenSwapMap, k)
		}
	}
}

func AddTokenSwapEntry(entry *TokenSwapEntry) error {
	removeExpiredTokens()
	if entry.Token == "" {
		return fmt.Errorf("token cannot be empty")
	}
	tokenMapLock.Lock()
	defer tokenMapLock.Unlock()
	if _, ok := tokenSwapMap[entry.Token]; ok {
		return fmt.Errorf("token already exists: %s", entry.Token)
	}
	tokenSwapMap[entry.Token] = entry
	return nil
}

func GetAndRemoveTokenSwapEntry(token string) *TokenSwapEntry {
	removeExpiredTokens()
	tokenMapLock.Lock()
	defer tokenMapLock.Unlock()
	if entry, ok := tokenSwapMap[token]; ok {
		delete(tokenSwapMap, token)
		return entry
	}
	return nil
}

// sortedEnvKeys returns env's keys in a deterministic (sorted) order so that
// encoding the same env map always produces byte-identical output — required
// both for reproducible tests and so logs/diffs of the encoded script are
// stable across runs.
func sortedEnvKeys(env map[string]string) []string {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func encodeEnvVarsForBash(env map[string]string) (string, error) {
	var encoded string
	for _, k := range sortedEnvKeys(env) {
		// validate key
		if !IsValidEnvVarName(k) {
			return "", fmt.Errorf("invalid env var name: %q", k)
		}
		encoded += fmt.Sprintf("export %s=%s\n", k, HardQuote(env[k]))
	}
	return encoded, nil
}

func encodeEnvVarsForFish(env map[string]string) (string, error) {
	var encoded string
	for _, k := range sortedEnvKeys(env) {
		// validate key
		if !IsValidEnvVarName(k) {
			return "", fmt.Errorf("invalid env var name: %q", k)
		}
		encoded += fmt.Sprintf("set -x %s %s\n", k, HardQuoteFish(env[k]))
	}
	return encoded, nil
}

func encodeEnvVarsForPowerShell(env map[string]string) (string, error) {
	var encoded string
	for _, k := range sortedEnvKeys(env) {
		// validate key
		if !IsValidEnvVarName(k) {
			return "", fmt.Errorf("invalid env var name: %q", k)
		}
		encoded += fmt.Sprintf("$env:%s = %s\n", k, HardQuotePowerShell(env[k]))
	}
	return encoded, nil
}

// PrefixEnvAssignmentsForShell returns cmd prefixed with statements (in the
// given outer shell's own syntax) that set env, in deterministic sorted-key
// order. POSIX shells support the inline "VAR=val cmd" prefix form; fish and
// PowerShell do not support prefixing an arbitrary command this way, so their
// assignments are emitted as separate statements before cmd. Every value is
// hard-quoted for the target dialect — this is the single place a
// swap-token/JWT/ZDOTDIR value is spliced into a command line, so it is the
// only place that can leak an unquoted value into shell reparsing.
func PrefixEnvAssignmentsForShell(shellType string, env map[string]string, cmd string) string {
	if len(env) == 0 {
		return cmd
	}
	keys := sortedEnvKeys(env)
	switch shellType {
	case ShellType_fish:
		var sb strings.Builder
		for _, k := range keys {
			fmt.Fprintf(&sb, "set -x %s %s; ", k, HardQuoteFish(env[k]))
		}
		sb.WriteString(cmd)
		return sb.String()
	case ShellType_pwsh:
		var sb strings.Builder
		for _, k := range keys {
			fmt.Fprintf(&sb, "$env:%s = %s; ", k, HardQuotePowerShell(env[k]))
		}
		sb.WriteString(cmd)
		return sb.String()
	default:
		var sb strings.Builder
		for _, k := range keys {
			sb.WriteString(k)
			sb.WriteByte('=')
			sb.WriteString(HardQuote(env[k]))
			sb.WriteByte(' ')
		}
		sb.WriteString(cmd)
		return sb.String()
	}
}

func EncodeEnvVarsForShell(shellType string, env map[string]string) (string, error) {
	switch shellType {
	case ShellType_bash, ShellType_zsh:
		return encodeEnvVarsForBash(env)
	case ShellType_fish:
		return encodeEnvVarsForFish(env)
	case ShellType_pwsh:
		return encodeEnvVarsForPowerShell(env)
	default:
		return "", fmt.Errorf("unknown or unsupported shell type for env var encoding: %s", shellType)
	}
}
