// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellapi

var GetZshShellStateCmds = []string{
	`echo zsh v${ZSH_VERSION};`,
	`pwd;`,
	`typeset -p +H -m '*';`,
	GetGitBranchCmdStr + ";",
}
