// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveai

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const MaxTerminalContentForTitle = 4000 // Maximum bytes of terminal content to analyze

// GenerateTabTitle uses AI to generate a short, meaningful title for a tab based on its terminal content
func GenerateTabTitle(ctx context.Context, tabId string) (string, error) {
	// Get the tab
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return "", fmt.Errorf("error getting tab: %w", err)
	}

	// If no blocks, return default
	if len(tab.BlockIds) == 0 {
		return "", fmt.Errorf("tab has no blocks")
	}

	// Get terminal content from the first block (usually the primary terminal)
	blockId := tab.BlockIds[0]
	terminalContent, err := getTerminalContent(ctx, blockId, MaxTerminalContentForTitle)
	if err != nil {
		return "", fmt.Errorf("error getting terminal content: %w", err)
	}

	if terminalContent == "" {
		return "", fmt.Errorf("no terminal content available")
	}

	// Generate title using AI
	title, err := generateTitleFromContent(ctx, terminalContent)
	if err != nil {
		return "", fmt.Errorf("error generating title: %w", err)
	}

	return title, nil
}

// getTerminalContent reads the last N bytes of terminal output from a block
func getTerminalContent(ctx context.Context, blockId string, maxBytes int) (string, error) {
	// Read the terminal file
	_, data, err := filestore.WFS.ReadFile(ctx, blockId, wavebase.BlockFile_Term)
	if err != nil {
		if err == fs.ErrNotExist {
			return "", nil
		}
		return "", fmt.Errorf("error reading terminal file: %w", err)
	}

	// If data is larger than maxBytes, take the last maxBytes
	if len(data) > maxBytes {
		data = data[len(data)-maxBytes:]
	}

	return string(data), nil
}

// generateTitleFromContent uses AI to generate a short title from terminal content
func generateTitleFromContent(ctx context.Context, content string) (string, error) {
	// Get AI settings
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	aiSettings := fullConfig.Settings.GetAiSettings()

	// Build AI options
	aiOpts := &wshrpc.WaveAIOptsType{
		APIType: aiSettings.AiApiType,
		BaseURL: aiSettings.AiBaseURL,
		Model:   aiSettings.AiModel,
	}

	// If no API type set, use Vertex AI Anthropic if available, otherwise cloud
	if aiOpts.APIType == "" {
		if aiOpts.BaseURL != "" {
			aiOpts.APIType = APIType_VertexAIAnthropic
		} else {
			aiOpts.APIType = APIType_OpenAI // Will use cloud backend
		}
	}

	// Set model if not specified
	if aiOpts.Model == "" {
		if aiOpts.APIType == APIType_VertexAIAnthropic {
			aiOpts.Model = "claude-3-5-haiku@20241022"
		} else {
			aiOpts.Model = "default"
		}
	}

	// Prepare the prompt
	prompt := fmt.Sprintf(`Based on this terminal output, generate a SHORT tab title (maximum 12 characters, preferably 6-10).
The title should capture the main activity or purpose. Use abbreviations if needed.

Examples:
- "npm install react" → "NPM Setup"
- "cd ~/projects/myapp && git status" → "Git MyApp"
- "docker ps -a" → "Docker"
- "python train.py" → "Train ML"
- "ssh user@server" → "SSH Srv"

Terminal output:
%s

Respond with ONLY the title text, nothing else. Keep it under 12 characters.`, content)

	// Create AI request
	request := wshrpc.WaveAIStreamRequest{
		Opts: aiOpts,
		Prompt: []wshrpc.WaveAIPromptMessageType{
			{
				Role:    "user",
				Content: prompt,
			},
		},
	}

	// Stream the completion
	responseChan := RunAICommand(ctx, request)

	// Collect the response
	var titleBuilder strings.Builder
	for respUnion := range responseChan {
		if respUnion.Error != nil {
			return "", fmt.Errorf("AI error: %w", respUnion.Error)
		}
		if respUnion.Response.Text != "" {
			titleBuilder.WriteString(respUnion.Response.Text)
		}
	}

	title := strings.TrimSpace(titleBuilder.String())

	// Ensure it's not too long (strict 14 char limit from UI)
	if len(title) > 14 {
		title = title[:14]
	}

	log.Printf("Generated tab title: %q", title)
	return title, nil
}
