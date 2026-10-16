// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatgpt

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"

	"github.com/skratchdot/open-golang/open"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type protectedStore struct{}

func secureBackend(backend string) bool {
	return runtime.GOOS != "linux" || (backend != "" && backend != "basic_text" && backend != "unknown")
}
func (protectedStore) Load() ([]byte, error) {
	b, err := os.ReadFile(filepath.Join(wavebase.GetWaveConfigDir(), "chatgpt.enc"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r, err := wshclient.ElectronDecryptCommand(wshclient.GetBareRpcClient(), wshrpc.CommandElectronDecryptData{CipherText: string(b)}, &wshrpc.RpcOpts{Route: wshutil.ElectronRoute, Timeout: 5000})
	if err != nil {
		return nil, errors.New("OS decryption unavailable")
	}
	if !secureBackend(r.StorageBackend) {
		return nil, errors.New("OS keyring unavailable")
	}
	return []byte(r.PlainText), nil
}
func (protectedStore) Save(b []byte) error {
	r, err := wshclient.ElectronEncryptCommand(wshclient.GetBareRpcClient(), wshrpc.CommandElectronEncryptData{PlainText: string(b)}, &wshrpc.RpcOpts{Route: wshutil.ElectronRoute, Timeout: 5000})
	if err != nil {
		return errors.New("OS encryption unavailable")
	}
	if !secureBackend(r.StorageBackend) {
		return errors.New("OS keyring unavailable")
	}
	return AtomicWrite(filepath.Join(wavebase.GetWaveConfigDir(), "chatgpt.enc"), []byte(r.CipherText))
}

// AtomicWrite publishes owner-only local state without exposing partial token rotations.
func AtomicWrite(path string, b []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".wave-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

var Default = NewManager(protectedStore{}, open.Run)
