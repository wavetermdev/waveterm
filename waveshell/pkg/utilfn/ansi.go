// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package utilfn

func AnsiResetColor() string {
	return "\033[0m"
}

func AnsiGreenColor() string {
	return "\033[32m"
}

func AnsiRedColor() string {
	return "\033[31m"
}
