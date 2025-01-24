// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"log"
	"math"
	"regexp"
)

var (
	safePattern       = regexp.MustCompile(`^[a-zA-Z0-9_/.-]+$`)
	envVarNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
)

func IsValidEnvVarName(name string) bool {
	return envVarNamePattern.MatchString(name)
}

func HardQuote(s string) string {
	if s == "" {
		return "\"\""
	}

	if safePattern.MatchString(s) {
		return s
	}

	lenS := len(s)
	if lenS > math.MaxInt-5 {
		log.Fatalf("string is too long to quote: %d", lenS)
	}

	buf := make([]byte, 0, lenS+5)
	buf = append(buf, '"')

	for i := 0; i < lenS; i++ {
		switch s[i] {
		case '"', '\\', '$', '`':
			buf = append(buf, '\\', s[i])
		case '\n':
			buf = append(buf, '\\', '\n')
		default:
			buf = append(buf, s[i])
		}
	}

	buf = append(buf, '"')
	return string(buf)
}

// does not encode newlines or backticks
func HardQuoteFish(s string) string {
	if s == "" {
		return "\"\""
	}

	if safePattern.MatchString(s) {
		return s
	}

	lenS := len(s)
	if lenS > math.MaxInt-5 {
		log.Fatalf("string is too long to quote: %d", lenS)
	}

	buf := make([]byte, 0, lenS+5)
	buf = append(buf, '"')

	for i := 0; i < lenS; i++ {
		switch s[i] {
		case '"', '\\', '$':
			buf = append(buf, '\\', s[i])
		default:
			buf = append(buf, s[i])
		}
	}

	buf = append(buf, '"')
	return string(buf)
}

func HardQuotePowerShell(s string) string {
	if s == "" {
		return "\"\""
	}

	lenS := len(s)
	if lenS > math.MaxInt-5 {
		log.Fatalf("string is too long to quote: %d", lenS)
	}

	buf := make([]byte, 0, lenS+5)
	buf = append(buf, '"')

	for i := 0; i < lenS; i++ {
		c := s[i]
		// In PowerShell, backtick (`) is the escape character
		switch c {
		case '"', '`', '$':
			buf = append(buf, '`')
		case '\n':
			buf = append(buf, '`', 'n') // PowerShell uses `n for newline
		}
		buf = append(buf, c)
	}

	buf = append(buf, '"')
	return string(buf)
}

func SoftQuote(s string) string {
	if s == "" {
		return "\"\""
	}

	lenS := len(s)

	// Handle special case of ~ paths
	if lenS > 0 && s[0] == '~' {
		// If it's just ~ or ~/something with no special chars, leave it as is
		if lenS == 1 || (lenS > 1 && s[1] == '/' && safePattern.MatchString(s[2:])) {
			return s
		}

		// Otherwise quote everything after the ~ (including the /)
		if lenS > 1 && s[1] == '/' {
			return "~" + SoftQuote(s[1:])
		}
	}

	if safePattern.MatchString(s) {
		return s
	}

	if lenS > math.MaxInt-5 {
		log.Fatalf("string is too long to quote: %d", lenS)
	}

	buf := make([]byte, 0, lenS+5)
	buf = append(buf, '"')

	for i := 0; i < lenS; i++ {
		c := s[i]
		// In soft quote, we don't escape $ to allow expansion
		if c == '"' || c == '\\' || c == '`' {
			buf = append(buf, '\\')
		}
		buf = append(buf, c)
	}

	buf = append(buf, '"')
	return string(buf)
}
