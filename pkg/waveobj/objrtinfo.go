// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

type ObjRTInfo struct {
	ShellHasCurCwd       bool   `json:"shell:hascurcwd,omitempty"`
	ShellState           string `json:"shell:state,omitempty"`
	ShellType            string `json:"shell:type,omitempty"`
	ShellVersion         string `json:"shell:version,omitempty"`
	ShellUname           string `json:"shell:uname,omitempty"`
	ShellIntegration     bool   `json:"shell:integration,omitempty"`
	ShellInputEmpty      bool   `json:"shell:inputempty,omitempty"`
	ShellLastCmd         string `json:"shell:lastcmd,omitempty"`
	ShellLastCmdExitCode int    `json:"shell:lastcmdexitcode,omitempty"`

	WaveAIChatId          string `json:"waveai:chatid,omitempty"`
	WaveAIMode            string `json:"waveai:mode,omitempty"`
	WaveAIMaxOutputTokens int    `json:"waveai:maxoutputtokens,omitempty"`
}
