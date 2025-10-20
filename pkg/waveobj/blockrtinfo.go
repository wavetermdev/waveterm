// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

type ObjRTInfo struct {
	TsunamiTitle     string `json:"tsunami:title,omitempty"`
	TsunamiShortDesc string `json:"tsunami:shortdesc,omitempty"`
	TsunamiSchemas   any    `json:"tsunami:schemas,omitempty"`

	CmdHasCurCwd bool `json:"cmd:hascurcwd,omitempty"`

	ShellState           string `json:"shell:state,omitempty"`
	ShellType            string `json:"shell:type,omitempty"`
	ShellVersion         string `json:"shell:version,omitempty"`
	ShellUname           string `json:"shell:uname,omitempty"`
	ShellIntegration     bool   `json:"shell:integration,omitempty"`
	ShellInputEmpty      bool   `json:"shell:inputempty,omitempty"`
	ShellLastCmd         string `json:"shell:lastcmd,omitempty"`
	ShellLastCmdExitCode int    `json:"shell:lastcmdexitcode,omitempty"`
}
