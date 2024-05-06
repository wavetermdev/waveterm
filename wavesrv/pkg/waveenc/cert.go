// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveenc

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"time"
)

func CreateSelfSignedLocalHostTlsCert() (*tls.Certificate, error) {
	serialNumber, err := rand.Int(rand.Reader, big.NewInt(1000000000))
	if err != nil {
		return nil, err
	}
	notBeforeTime, err := time.Parse("2006-01-02", "2020-01-01")
	if err != nil {
		return nil, err
	}
	notAfterTime, err := time.Parse("2006-01-02", "2030-01-01")
	if err != nil {
		return nil, err
	}
	certTemplate := &x509.Certificate{
		SerialNumber:          serialNumber,
		Subject:               pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:             notBeforeTime,
		NotAfter:              notAfterTime,
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:              []string{"localhost"},
		IsCA:                  true,
	}
	privateKey, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return nil, err
	}
	publicKey := privateKey.Public()
	derBytes, err := x509.CreateCertificate(rand.Reader, certTemplate, certTemplate, publicKey, privateKey)
	if err != nil {
		return nil, err
	}
	var tlsCert tls.Certificate
	tlsCert.Certificate = append(tlsCert.Certificate, derBytes)
	tlsCert.PrivateKey = privateKey
	return &tlsCert, nil
}
