// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package genconn

import "regexp"

var (
	safePattern   = regexp.MustCompile(`^[a-zA-Z0-9_/.-]+$`)
	psSafePattern = regexp.MustCompile(`^[a-zA-Z0-9_.-]+$`)
)

// TODO: fish quoting is slightly different
// specifically \` will cause an inconsistency between fish and bash/zsh :/
// might need a specific fish quoting function, and an explicit fish shell detection
func HardQuote(s string) string {
	if s == "" {
		return "\"\""
	}

	if safePattern.MatchString(s) {
		return s
	}

	buf := make([]byte, 0, len(s)+5)
	buf = append(buf, '"')

	for i := 0; i < len(s); i++ {
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

func HardQuotePowerShell(s string) string {
	if s == "" {
		return "\"\""
	}

	if psSafePattern.MatchString(s) {
		return s
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
