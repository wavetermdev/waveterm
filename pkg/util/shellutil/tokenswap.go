// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
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

func encodeEnvVarsForBash(env map[string]string) (string, error) {
	var encoded string
	for k, v := range env {
		// validate key
		if !IsValidEnvVarName(k) {
			return "", fmt.Errorf("invalid env var name: %q", k)
		}
		encoded += fmt.Sprintf("export %s=%s\n", k, HardQuote(v))
	}
	return encoded, nil
}

func encodeEnvVarsForFish(env map[string]string) (string, error) {
	var encoded string
	for k, v := range env {
		// validate key
		if !IsValidEnvVarName(k) {
			return "", fmt.Errorf("invalid env var name: %q", k)
		}
		encoded += fmt.Sprintf("set -x %s %s\n", k, HardQuoteFish(v))
	}
	return encoded, nil
}

func encodeEnvVarsForPowerShell(env map[string]string) (string, error) {
	var encoded string
	for k, v := range env {
		// validate key
		if !IsValidEnvVarName(k) {
			return "", fmt.Errorf("invalid env var name: %q", k)
		}
		encoded += fmt.Sprintf("$env:%s = %s\n", k, HardQuotePowerShell(v))
	}
	return encoded, nil
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
