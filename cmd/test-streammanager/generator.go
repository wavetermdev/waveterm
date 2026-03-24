// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"io"
)

// Base64 charset: all printable, easy to inspect manually
const Base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

type TestDataGenerator struct {
	totalBytes int64
	generated  int64
}

func NewTestDataGenerator(totalBytes int64) *TestDataGenerator {
	return &TestDataGenerator{totalBytes: totalBytes}
}

func (g *TestDataGenerator) Read(p []byte) (n int, err error) {
	if g.generated >= g.totalBytes {
		return 0, io.EOF
	}

	remaining := g.totalBytes - g.generated
	toRead := int64(len(p))
	if toRead > remaining {
		toRead = remaining
	}

	// Sequential pattern using base64 chars (0-63 cycling)
	for i := int64(0); i < toRead; i++ {
		p[i] = Base64Chars[(g.generated+i)%64]
	}

	g.generated += toRead
	return int(toRead), nil
}
