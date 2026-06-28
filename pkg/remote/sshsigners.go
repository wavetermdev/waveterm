// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"context"
	"io"

	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"golang.org/x/crypto/ssh"
)

type failoverSigner struct {
	signer  ssh.Signer
	connCtx context.Context
}

func (f failoverSigner) PublicKey() ssh.PublicKey {
	return f.signer.PublicKey()
}

func (f failoverSigner) Sign(rand io.Reader, data []byte) (*ssh.Signature, error) {
	sig, err := f.signer.Sign(rand, data)
	if err == nil {
		return sig, nil
	}
	blocklogger.Infof(f.connCtx, "[conndebug] agent signing failed for key %s %s (%v); continuing with next identity\n",
		f.signer.PublicKey().Type(), ssh.FingerprintSHA256(f.signer.PublicKey()), err)
	return f.invalidSignature(), nil
}

func (f failoverSigner) SignWithAlgorithm(rand io.Reader, data []byte, algorithm string) (*ssh.Signature, error) {
	if as, ok := f.signer.(ssh.AlgorithmSigner); ok {
		sig, err := as.SignWithAlgorithm(rand, data, algorithm)
		if err == nil {
			return sig, nil
		}
		blocklogger.Infof(f.connCtx, "[conndebug] agent signing failed for key %s %s (%v); continuing with next identity\n",
			f.signer.PublicKey().Type(), ssh.FingerprintSHA256(f.signer.PublicKey()), err)
		return f.invalidSignature(), nil
	}
	return f.Sign(rand, data)
}

func (f failoverSigner) invalidSignature() *ssh.Signature {
	return &ssh.Signature{
		Format: f.signer.PublicKey().Type(),
		Blob:   []byte("invalid-signature-identity-skipped"),
	}
}
