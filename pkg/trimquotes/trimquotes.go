// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package trimquotes

import (
	"strconv"
)

func TrimQuotes(s string) (string, bool) {
	if len(s) > 2 && s[0] == '"' {
		trimmed, err := strconv.Unquote(s)
		if err != nil {
			return s, false
		}
		return trimmed, true
	}
	return s, false
}

func TryTrimQuotes(s string) string {
	trimmed, _ := TrimQuotes(s)
	return trimmed
}

func ReplaceQuotes(s string, shouldReplace bool) string {
	if shouldReplace {
		return strconv.Quote(s)
	}
	return s
}
