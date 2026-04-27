// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveattach

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	dbSubdir       = "db"
	dbFileName     = "waveterm.db"
	socketFileName = "wave.sock"
)

func ResolveDataDir() (string, error) {
	if v := os.Getenv("WAVETERM_DATA_HOME"); v != "" {
		return v, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home dir: %w", err)
	}
	var candidates []string
	switch runtime.GOOS {
	case "darwin":
		candidates = []string{
			filepath.Join(home, "Library", "Application Support", "waveterm"),
			filepath.Join(home, "Library", "Application Support", "waveterm-dev"),
			filepath.Join(home, ".waveterm"),
			filepath.Join(home, ".waveterm-dev"),
		}
	case "linux":
		xdgData := os.Getenv("XDG_DATA_HOME")
		if xdgData == "" {
			xdgData = filepath.Join(home, ".local", "share")
		}
		candidates = []string{
			filepath.Join(xdgData, "waveterm"),
			filepath.Join(xdgData, "waveterm-dev"),
			filepath.Join(home, ".waveterm"),
			filepath.Join(home, ".waveterm-dev"),
		}
	default:
		candidates = []string{
			filepath.Join(home, ".waveterm"),
			filepath.Join(home, ".waveterm-dev"),
		}
	}
	for _, candidate := range candidates {
		if st, err := os.Stat(candidate); err == nil && st.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("Wave data directory not found. Is Wave running? (set $WAVETERM_DATA_HOME to override)")
}

func loadJwtPrivateKey(dataDir string) (ed25519.PrivateKey, error) {
	dbPath := filepath.Join(dataDir, dbSubdir, dbFileName)
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("Wave database not found at %s: %w", dbPath, err)
	}
	dsn := fmt.Sprintf("file:%s?mode=ro&_journal_mode=WAL&_busy_timeout=5000", dbPath)
	db, err := sqlx.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening wave db: %w", err)
	}
	defer db.Close()

	var rawJSON string
	if err := db.Get(&rawJSON, "SELECT data FROM db_mainserver LIMIT 1"); err != nil {
		return nil, fmt.Errorf("querying db_mainserver (Wave schema may have changed): %w", err)
	}
	var ms struct {
		JwtPrivateKey string `json:"jwtprivatekey"`
	}
	if err := json.Unmarshal([]byte(rawJSON), &ms); err != nil {
		return nil, fmt.Errorf("parsing mainserver JSON: %w", err)
	}
	if ms.JwtPrivateKey == "" {
		return nil, fmt.Errorf("jwtprivatekey is empty in db_mainserver")
	}
	keyBytes, err := base64.StdEncoding.DecodeString(ms.JwtPrivateKey)
	if err != nil {
		return nil, fmt.Errorf("base64 decoding jwt private key: %w", err)
	}
	if len(keyBytes) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("jwt private key has wrong length: got %d, want %d", len(keyBytes), ed25519.PrivateKeySize)
	}
	return ed25519.PrivateKey(keyBytes), nil
}

func Connect() (*wshutil.WshRpc, string, error) {
	dataDir, err := ResolveDataDir()
	if err != nil {
		return nil, "", err
	}
	sockPath := filepath.Join(dataDir, socketFileName)
	if _, err := os.Stat(sockPath); err != nil {
		return nil, "", fmt.Errorf("Wave socket not found at %s: %w", sockPath, err)
	}

	privKey, err := loadJwtPrivateKey(dataDir)
	if err != nil {
		return nil, "", err
	}
	if err := wavejwt.SetPrivateKey([]byte(privKey)); err != nil {
		return nil, "", fmt.Errorf("setting jwt private key: %w", err)
	}

	routeId := "waveattach-" + uuid.NewString()
	rpcCtx := wshrpc.RpcContext{
		SockName: sockPath,
		RouteId:  routeId,
	}
	jwtToken, err := wshutil.MakeClientJWTToken(rpcCtx)
	if err != nil {
		return nil, "", fmt.Errorf("creating jwt: %w", err)
	}
	rpcClient, err := wshutil.SetupDomainSocketRpcClient(sockPath, nil, "waveattach")
	if err != nil {
		return nil, "", fmt.Errorf("connecting to %s: %w", sockPath, err)
	}
	authRtn, err := wshclient.AuthenticateCommand(rpcClient, jwtToken, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
	if err != nil {
		return nil, "", fmt.Errorf("authenticating: %w", err)
	}
	return rpcClient, authRtn.RouteId, nil
}
