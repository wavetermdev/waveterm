// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavejwt

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	IssuerWaveTerm = "waveterm"
)

var (
	globalLock sync.Mutex
	publicKey  ed25519.PublicKey
	privateKey ed25519.PrivateKey
)

type WaveJwtClaims struct {
	jwt.RegisteredClaims
	RouteId string `json:"routeid,omitempty"`
	Sock    string `json:"sock,omitempty"`
	BlockId string `json:"blockid,omitempty"`
	TabId   string `json:"tabid,omitempty"`
	Conn    string `json:"conn,omitempty"`
	CType   string `json:"ctype,omitempty"`
}

type KeyPair struct {
	PublicKey  []byte
	PrivateKey []byte
}

func GenerateKeyPair() (*KeyPair, error) {
	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate key pair: %w", err)
	}

	return &KeyPair{
		PublicKey:  pubKey,
		PrivateKey: privKey,
	}, nil
}

func SetPublicKey(keyData []byte) error {
	if len(keyData) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key size: expected %d, got %d", ed25519.PublicKeySize, len(keyData))
	}
	globalLock.Lock()
	defer globalLock.Unlock()
	publicKey = ed25519.PublicKey(keyData)
	return nil
}

func GetPublicKey() []byte {
	globalLock.Lock()
	defer globalLock.Unlock()
	return publicKey
}

func GetPublicKeyBase64() string {
	pubKey := GetPublicKey()
	if len(pubKey) == 0 {
		return ""
	}
	return base64.StdEncoding.EncodeToString(pubKey)
}

func SetPrivateKey(keyData []byte) error {
	if len(keyData) != ed25519.PrivateKeySize {
		return fmt.Errorf("invalid private key size: expected %d, got %d", ed25519.PrivateKeySize, len(keyData))
	}
	globalLock.Lock()
	defer globalLock.Unlock()
	privateKey = ed25519.PrivateKey(keyData)
	return nil
}

func ValidateAndExtract(tokenStr string) (*WaveJwtClaims, error) {
	globalLock.Lock()
	pubKey := publicKey
	globalLock.Unlock()

	if pubKey == nil {
		return nil, fmt.Errorf("public key not set")
	}

	token, err := jwt.ParseWithClaims(tokenStr, &WaveJwtClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodEd25519); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return pubKey, nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	claims, ok := token.Claims.(*WaveJwtClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
}

func Sign(claims *WaveJwtClaims) (string, error) {
	globalLock.Lock()
	privKey := privateKey
	globalLock.Unlock()

	if privKey == nil {
		return "", fmt.Errorf("private key not set")
	}

	if claims.IssuedAt == nil {
		claims.IssuedAt = jwt.NewNumericDate(time.Now())
	}
	if claims.Issuer == "" {
		claims.Issuer = IssuerWaveTerm
	}
	if claims.ExpiresAt == nil {
		claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(time.Hour * 24 * 365))
	}

	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	tokenStr, err := token.SignedString(privKey)
	if err != nil {
		return "", fmt.Errorf("error signing token: %w", err)
	}

	return tokenStr, nil
}
