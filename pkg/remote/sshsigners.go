// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"context"
	"io"

	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"golang.org/x/crypto/ssh"
)

// failoverSigner wraps an ssh.Signer so that a signing failure from one
// agent identity does not abort authentication; instead it returns a
// synthesized invalid signature, allowing the SSH client to try the next
// identity (matching OpenSSH's failover behavior).
type failoverSigner struct {
	signer  ssh.Signer
	connCtx context.Context
}

// PublicKey returns the public key of the wrapped signer.
func (f failoverSigner) PublicKey() ssh.PublicKey {
	return f.signer.PublicKey()
}

// Sign signs the data with the wrapped signer. On failure it logs the error
// and returns an invalid placeholder signature so the client can continue to
// the next identity.
func (f failoverSigner) Sign(rand io.Reader, data []byte) (*ssh.Signature, error) {
	sig, err := f.signer.Sign(rand, data)
	if err == nil {
		return sig, nil
	}
	blocklogger.Infof(f.connCtx, "[conndebug] agent signing failed for key %s %s (%v); continuing with next identity\n",
		f.signer.PublicKey().Type(), ssh.FingerprintSHA256(f.signer.PublicKey()), err)
	return f.invalidSignature(f.signer.PublicKey().Type()), nil
}

// SignWithAlgorithm signs the data with the wrapped signer using the requested
// algorithm. On failure it logs the error and returns an invalid placeholder
// signature whose Format matches the requested algorithm, allowing the client
// to try the next identity.
func (f failoverSigner) SignWithAlgorithm(rand io.Reader, data []byte, algorithm string) (*ssh.Signature, error) {
	if as, ok := f.signer.(ssh.AlgorithmSigner); ok {
		sig, err := as.SignWithAlgorithm(rand, data, algorithm)
		if err == nil {
			return sig, nil
		}
		blocklogger.Infof(f.connCtx, "[conndebug] agent signing failed for key %s %s (%v); continuing with next identity\n",
			f.signer.PublicKey().Type(), ssh.FingerprintSHA256(f.signer.PublicKey()), err)
		return f.invalidSignature(algorithm), nil
	}
	return f.Sign(rand, data)
}

// invalidSignature constructs a placeholder ssh.Signature with the given
// format and a clearly-invalid blob. Returning this (rather than an error)
// lets the SSH client move on to the next offered identity.
func (f failoverSigner) invalidSignature(format string) *ssh.Signature {
	return &ssh.Signature{
		Format: format,
		Blob:   []byte("invalid-signature-identity-skipped"),
	}
}
