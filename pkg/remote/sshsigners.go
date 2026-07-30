// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"context"
	"io"

	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"golang.org/x/crypto/ssh"
)

// failoverSigner wraps an ssh.Signer to implement SSH agent identity failover.
// When signing with one agent identity fails, instead of aborting the entire
// authentication attempt, it produces a synthesized invalid signature that
// causes the SSH client to try the next available identity, matching OpenSSH's
// default multi-identity authentication behavior. It implements both
// ssh.Signer and ssh.AlgorithmSigner.
type failoverSigner struct {
	signer  ssh.Signer
	connCtx context.Context
}

// PublicKey returns the public key associated with the wrapped signer.
// It implements ssh.Signer.
func (f failoverSigner) PublicKey() ssh.PublicKey {
	return f.signer.PublicKey()
}

// Sign signs the given data using the wrapped signer. If signing succeeds, the
// valid signature is returned. If signing fails (e.g. because the agent cannot
// authenticate with this particular identity), the error is logged via
// blocklogger and an invalid placeholder signature is returned instead of an
// error, allowing the SSH client to proceed to the next offered identity.
// It implements ssh.Signer.
func (f failoverSigner) Sign(rand io.Reader, data []byte) (*ssh.Signature, error) {
	sig, err := f.signer.Sign(rand, data)
	if err == nil {
		return sig, nil
	}
	blocklogger.Infof(f.connCtx, "[conndebug] agent signing failed for key %s %s (%v); continuing with next identity\n",
		f.signer.PublicKey().Type(), ssh.FingerprintSHA256(f.signer.PublicKey()), err)
	return f.invalidSignature(f.signer.PublicKey().Type()), nil
}

// SignWithAlgorithm signs the given data using the wrapped signer with the
// requested signature algorithm. If the wrapped signer supports
// ssh.AlgorithmSigner, the algorithm is forwarded; if signing fails in that
// case an invalid signature with the requested algorithm format is returned.
// If the wrapped signer does not implement ssh.AlgorithmSigner, it falls back
// to Sign. It implements ssh.AlgorithmSigner.
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
// format and an obviously-invalid blob. Returning this sentinel signature
// instead of propagating the signing error causes the SSH client to skip
// this identity and move on to the next one offered by the agent.
func (f failoverSigner) invalidSignature(format string) *ssh.Signature {
	return &ssh.Signature{
		Format: format,
		Blob:   []byte("invalid-signature-identity-skipped"),
	}
}
