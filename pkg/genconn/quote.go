// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package genconn

import "regexp"

var (
	safePattern = regexp.MustCompile(`^[a-zA-Z0-9_/.-]+$`)

	needsEscape = map[byte]bool{
		'"':  true,
		'\\': true,
		'$':  true,
		'`':  true,
	}
)

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
		if needsEscape[s[i]] {
			buf = append(buf, '\\')
		}
		buf = append(buf, s[i])
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
