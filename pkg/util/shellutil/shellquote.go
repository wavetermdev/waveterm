// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"log"
	"regexp"
	"strings"
)

const (
	MaxQuoteSize = 10000000 // 10MB
)

var (
	safePattern       = regexp.MustCompile(`^[a-zA-Z0-9_@:,+=/.-]+$`)
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

	if !checkQuoteSize(s) {
		return ""
	}

	buf := make([]byte, 0, len(s)+5)
	buf = append(buf, '"')

	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '"', '\\', '$', '`':
			buf = append(buf, '\\', s[i])
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

	if !checkQuoteSize(s) {
		return ""
	}

	buf := make([]byte, 0, len(s)+5)
	buf = append(buf, '"')

	for i := 0; i < len(s); i++ {
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

	if !checkQuoteSize(s) {
		return ""
	}

	buf := make([]byte, 0, len(s)+5)
	buf = append(buf, '"')

	for i := 0; i < len(s); i++ {
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

	// Handle special case of ~ paths
	if len(s) > 0 && s[0] == '~' {
		// If it's just ~ or ~/something with no special chars, leave it as is
		if len(s) == 1 || (len(s) > 1 && s[1] == '/' && safePattern.MatchString(s[2:])) {
			return s
		}

		// Otherwise quote everything after the ~ (including the /)
		if len(s) > 1 && s[1] == '/' {
			return "~" + SoftQuote(s[1:])
		}
	}

	if safePattern.MatchString(s) {
		return s
	}

	if !checkQuoteSize(s) {
		return ""
	}

	buf := make([]byte, 0, len(s)+5)
	buf = append(buf, '"')

	for i := 0; i < len(s); i++ {
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

// QuoteForShellType hard-quotes a single argv element for the given outer
// shell's syntax. This is the single place that knows which quoting dialect
// a shell type requires; callers must never hand-embed quote characters
// themselves (see SerializeCommandForShell).
func QuoteForShellType(shellType string, s string) string {
	switch shellType {
	case ShellType_fish:
		return HardQuoteFish(s)
	case ShellType_pwsh:
		return HardQuotePowerShell(s)
	default:
		// bash, zsh, unknown, and any POSIX-compatible outer shell (e.g. the
		// "sh -c" wrapper used for WSL) all use POSIX double-quote rules.
		return HardQuote(s)
	}
}

// SerializeCommandForShell serializes an argv slice (argv[0] is the
// executable, the rest are its arguments) into a single command-line string
// that is safe to hand to the given outer shell type as a raw command string
// (an SSH exec request payload, or a "-c" argument). Every element is
// hard-quoted independently, so no element can be word-split, glob-expanded,
// or reinterpreted as a flag by the outer shell — this is the one place argv
// boundaries get flattened into shell syntax, and it must be the only one.
//
// PowerShell additionally requires the call operator "&" before a quoted
// executable path, or the quoted string is treated as a string literal
// instead of being invoked — that dialect quirk is centralized here so
// callers never need their own compensating "& " hack.
func SerializeCommandForShell(shellType string, argv []string) string {
	if len(argv) == 0 {
		return ""
	}
	quoted := make([]string, 0, len(argv)+1)
	if shellType == ShellType_pwsh {
		quoted = append(quoted, "&")
	}
	for _, a := range argv {
		quoted = append(quoted, QuoteForShellType(shellType, a))
	}
	return strings.Join(quoted, " ")
}

func checkQuoteSize(s string) bool {
	if len(s) > MaxQuoteSize {
		log.Printf("string too long to quote: %s", s)
		return false
	}
	return true
}
