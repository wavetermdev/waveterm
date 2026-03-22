// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/projectctx"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func GetProjectInstructionsToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:             "project_instructions",
		DisplayName:      "Project Instructions",
		Description:      "Read project instructions (WAVE.md, CLAUDE.md, .cursorrules). No params = table of contents. With sections=[...] = full content. Optional file_ext filter.",
		ShortDescription: "Read project coding instructions",
		ToolLogName:      "project:instructions",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"sections": map[string]any{
					"type":        "array",
					"description": "List of section headings to retrieve (e.g., [\"Database\", \"Controllers & Validation\"]). Omit to get table of contents.",
					"items": map[string]any{
						"type": "string",
					},
				},
				"file_ext": map[string]any{
					"type":        "string",
					"description": "Optional file extension to filter sections by technology (e.g., 'php', 'vue', 'ts').",
				},
			},
		},
		ToolCallDesc: func(input any, output any, _ *uctypes.UIMessageDataToolUse) string {
			inputMap, _ := input.(map[string]any)
			sections, _ := inputMap["sections"].([]any)
			if len(sections) > 0 {
				return fmt.Sprintf("reading %d project instruction sections", len(sections))
			}
			return "listing project instruction sections"
		},
		ToolTextCallback: makeProjectInstructionsCallback(tabId),
	}
}

func makeProjectInstructionsCallback(tabId string) func(any) (string, error) {
	return func(input any) (string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		cwd := getTerminalCwd(ctx, tabId)
		if cwd == "" {
			return "No terminal found in this tab.", nil
		}

		files := projectctx.FindAllInstructionsFiles(cwd)
		if len(files) == 0 {
			return "No project instructions file found. Looked for: WAVE.md, CLAUDE.md, GEMINI.md, AGENTS.md, .cursorrules", nil
		}

		// Parse all files
		var allInstructions []*projectctx.ProjectInstructions
		for _, filePath := range files {
			pi, err := projectctx.ParseInstructions(filePath)
			if err != nil {
				continue
			}
			allInstructions = append(allInstructions, pi)
		}

		if len(allInstructions) == 0 {
			return "Instructions files found but could not be parsed.", nil
		}

		inputMap, _ := input.(map[string]any)
		fileExt, _ := inputMap["file_ext"].(string)
		sectionsRaw, _ := inputMap["sections"].([]any)

		// Mode 1: Table of contents (no sections requested)
		if len(sectionsRaw) == 0 {
			return formatTableOfContents(allInstructions, fileExt), nil
		}

		// Mode 2: Return requested sections
		requestedSections := make([]string, len(sectionsRaw))
		for i, s := range sectionsRaw {
			requestedSections[i] = fmt.Sprintf("%v", s)
		}
		return formatRequestedSections(allInstructions, requestedSections, fileExt), nil
	}
}

func formatTableOfContents(instructions []*projectctx.ProjectInstructions, fileExt string) string {
	var sb strings.Builder
	sb.WriteString("Project instruction files found:\n\n")

	for _, pi := range instructions {
		sb.WriteString(fmt.Sprintf("📄 **%s** (%d sections, %d bytes)\n", pi.FileName, len(pi.Sections), pi.RawSize))

		for _, section := range pi.Sections {
			if fileExt != "" && !projectctx.SectionMatchesExt(section, fileExt) {
				continue
			}
			tags := ""
			if len(section.Tags) > 0 {
				tags = " [" + strings.Join(section.Tags, ", ") + "]"
			}
			lines := strings.Count(section.Content, "\n") + 1
			sb.WriteString(fmt.Sprintf("  - %s (%d lines)%s\n", section.Heading, lines, tags))
		}
		sb.WriteString("\n")
	}

	sb.WriteString("Call project_instructions with sections=[\"Section Name\", ...] to read specific sections.")
	return sb.String()
}

func formatRequestedSections(instructions []*projectctx.ProjectInstructions, requested []string, fileExt string) string {
	var sb strings.Builder

	requestedLower := make(map[string]bool)
	for _, r := range requested {
		requestedLower[strings.ToLower(r)] = true
	}

	found := 0
	for _, pi := range instructions {
		for _, section := range pi.Sections {
			if !requestedLower[strings.ToLower(section.Heading)] {
				continue
			}
			if fileExt != "" && !projectctx.SectionMatchesExt(section, fileExt) {
				continue
			}
			sb.WriteString(fmt.Sprintf("## %s (from %s)\n", section.Heading, pi.FileName))
			sb.WriteString(section.Content)
			sb.WriteString("\n\n")
			found++
		}
	}

	if found == 0 {
		return fmt.Sprintf("No sections found matching: %s", strings.Join(requested, ", "))
	}

	result := sb.String()
	const maxLen = 12000
	if len(result) > maxLen {
		result = result[:maxLen] + "\n... [truncated]"
	}
	return result
}
