// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

type ObjRTInfo struct {
	TsunamiAppMeta any `json:"tsunami:appmeta,omitempty" tstype:"AppMeta"`
	TsunamiSchemas any `json:"tsunami:schemas,omitempty"`

	ShellHasCurCwd       bool   `json:"shell:hascurcwd,omitempty"`
	ShellState           string `json:"shell:state,omitempty"`
	ShellType            string `json:"shell:type,omitempty"`
	ShellVersion         string `json:"shell:version,omitempty"`
	ShellUname           string `json:"shell:uname,omitempty"`
	ShellIntegration     bool   `json:"shell:integration,omitempty"`
	ShellInputEmpty      bool   `json:"shell:inputempty,omitempty"`
	ShellLastCmd         string `json:"shell:lastcmd,omitempty"`
	ShellLastCmdExitCode int    `json:"shell:lastcmdexitcode,omitempty"`

	BuilderLayout map[string]float64 `json:"builder:layout,omitempty"`
	BuilderAppId  string             `json:"builder:appid,omitempty"`
	BuilderEnv    map[string]string  `json:"builder:env,omitempty"`

	WaveAIChatId          string `json:"waveai:chatid,omitempty"`
	WaveAIThinkingMode    string `json:"waveai:thinkingmode,omitempty"`
	WaveAIMaxOutputTokens int    `json:"waveai:maxoutputtokens,omitempty"`
}
