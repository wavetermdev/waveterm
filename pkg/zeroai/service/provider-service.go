// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package service

import (
	"context"
	"fmt"
	"os/exec"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type ProviderService struct{}

func NewProviderService() *ProviderService {
	return &ProviderService{}
}

func (ps *ProviderService) ListProviders() ([]*wshrpc.ZeroAiProviderInfo, error) {
	config := wconfig.GetWatcher().GetFullConfig()

	providers := make([]*wshrpc.ZeroAiProviderInfo, 0, len(config.ZeroAiProviders))

	for id, prov := range config.ZeroAiProviders {
		info := &wshrpc.ZeroAiProviderInfo{
			ID:                id,
			DisplayName:       prov.DisplayName,
			DisplayIcon:       prov.DisplayIcon,
			CliCommand:        prov.CliCommand,
			CliPath:           prov.CliPath,
			CliArgs:           prov.CliArgs,
			EnvVars:           prov.EnvVars,
			SupportsStreaming: prov.SupportsStreaming,
			DefaultModel:      prov.DefaultModel,
			AvailableModels:   prov.AvailableModels,
			AuthRequired:      prov.AuthRequired,
			IsCustom:          true,
			IsAvailable:       ps.checkProviderAvailable(prov.CliCommand, prov.CliPath),
		}
		providers = append(providers, info)
	}

	return providers, nil
}

func (ps *ProviderService) SaveProvider(data wshrpc.CommandZeroAiSaveProviderData) error {
	if data.CliCommand == "" {
		return fmt.Errorf("cli:command is required")
	}

	providerMap := waveobj.MetaMapType{
		"display:name":      data.DisplayName,
		"cli:command":       data.CliCommand,
		"supportsStreaming": data.SupportsStreaming,
		"authRequired":      data.AuthRequired,
	}
	if data.CliPath != "" {
		providerMap["cli:path"] = data.CliPath
	}
	if len(data.CliArgs) > 0 {
		providerMap["cli:args"] = data.CliArgs
	}
	if data.EnvVars != nil {
		providerMap["env:vars"] = data.EnvVars
	}
	if data.DefaultModel != "" {
		providerMap["defaultModel"] = data.DefaultModel
	}
	if len(data.AvailableModels) > 0 {
		providerMap["availableModels"] = data.AvailableModels
	}
	if data.DisplayIcon != "" {
		providerMap["display:icon"] = data.DisplayIcon
	}

	existing, cerrs := wconfig.ReadWaveHomeConfigFile("zeroai.json")
	if len(cerrs) > 0 {
		return fmt.Errorf("error reading config: %v", cerrs[0])
	}
	if existing == nil {
		existing = make(waveobj.MetaMapType)
	}
	existing[data.ProviderID] = providerMap

	return wconfig.WriteWaveHomeConfigFile("zeroai.json", existing)
}

func (ps *ProviderService) DeleteProvider(providerID string) error {
	existing, cerrs := wconfig.ReadWaveHomeConfigFile("zeroai.json")
	if len(cerrs) > 0 {
		return fmt.Errorf("error reading config: %v", cerrs[0])
	}
	if existing == nil {
		return fmt.Errorf("provider %s not found", providerID)
	}

	if _, exists := existing[providerID]; !exists {
		return fmt.Errorf("provider %s not found", providerID)
	}

	delete(existing, providerID)
	return wconfig.WriteWaveHomeConfigFile("zeroai.json", existing)
}

func (ps *ProviderService) TestProvider(ctx context.Context, providerID string) (*wshrpc.ZeroAiTestProviderResult, error) {
	config := wconfig.GetWatcher().GetFullConfig()
	prov, exists := config.ZeroAiProviders[providerID]
	if !exists {
		return nil, fmt.Errorf("provider %s not found", providerID)
	}

	cliPath := prov.CliPath
	if cliPath == "" {
		cliPath = prov.CliCommand
	}

	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, cliPath, "--version")
	output, err := cmd.CombinedOutput()
	latency := time.Since(start).Milliseconds()

	result := &wshrpc.ZeroAiTestProviderResult{
		LatencyMs: latency,
	}

	if err != nil {
		result.Success = false
		result.Error = fmt.Sprintf("%s: %s", err, string(output))
		return result, nil
	}

	result.Success = true
	result.Version = string(output)
	return result, nil
}

func (ps *ProviderService) checkProviderAvailable(cliCommand, cliPath string) bool {
	path := cliPath
	if path == "" {
		path = cliCommand
	}
	_, err := exec.LookPath(path)
	return err == nil
}
