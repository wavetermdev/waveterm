// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package projectctx

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Supported instruction file names, checked in order of priority.
var instructionFiles = []string{
	"WAVE.md",
	"CLAUDE.md",
	"GEMINI.md",
	"AGENTS.md",
	".cursorrules",
	".github/copilot-instructions.md",
}

// Section represents a parsed section of the instructions file.
type Section struct {
	Heading string
	Content string
	Tags    []string // inferred technology tags
}

// ProjectInstructions holds parsed project instructions.
type ProjectInstructions struct {
	FilePath    string
	FileName    string
	RawSize     int
	Sections    []Section
	ProjectInfo string // first section (Project/overview)
}

// FindInstructionsFile looks for a known instructions file in the given directory.
// Returns the first found file path (for backward compat / system prompt check).
func FindInstructionsFile(dir string) string {
	for _, name := range instructionFiles {
		path := filepath.Join(dir, name)
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return ""
}

// FindAllInstructionsFiles returns all existing instructions files in the directory.
// WAVE.md is always first (highest priority), then others in order.
func FindAllInstructionsFiles(dir string) []string {
	var found []string
	for _, name := range instructionFiles {
		path := filepath.Join(dir, name)
		if _, err := os.Stat(path); err == nil {
			found = append(found, path)
		}
	}
	return found
}

// ParseInstructions reads and parses an instructions file into sections.
func ParseInstructions(filePath string) (*ProjectInstructions, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("reading instructions: %w", err)
	}

	content := string(data)
	lines := strings.Split(content, "\n")

	pi := &ProjectInstructions{
		FilePath: filePath,
		FileName: filepath.Base(filePath),
		RawSize:  len(data),
	}

	var currentSection *Section
	var sectionLines []string

	flushSection := func() {
		if currentSection != nil {
			currentSection.Content = strings.TrimSpace(strings.Join(sectionLines, "\n"))
			currentSection.Tags = inferTags(currentSection.Heading, currentSection.Content)
			pi.Sections = append(pi.Sections, *currentSection)
		}
	}

	for _, line := range lines {
		if strings.HasPrefix(line, "## ") {
			flushSection()
			heading := strings.TrimPrefix(line, "## ")
			currentSection = &Section{Heading: heading}
			sectionLines = nil
		} else if strings.HasPrefix(line, "# ") && currentSection == nil {
			// Top-level heading, skip but capture as project info start
			continue
		} else {
			sectionLines = append(sectionLines, line)
		}
	}
	flushSection()

	// Extract project info from first section
	if len(pi.Sections) > 0 && isOverviewSection(pi.Sections[0].Heading) {
		pi.ProjectInfo = pi.Sections[0].Content
	}

	return pi, nil
}

// GetFilteredContext returns sections relevant to the given file extension/technology.
// Always includes: Project overview, Architecture, Conventions.
// Adds technology-specific sections based on the file being edited.
func GetFilteredContext(pi *ProjectInstructions, fileExt string) string {
	if pi == nil || len(pi.Sections) == 0 {
		return ""
	}

	techTags := extToTags(fileExt)
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("<project_instructions source=%q>\n", pi.FileName))

	for _, section := range pi.Sections {
		if shouldInclude(section, techTags) {
			sb.WriteString(fmt.Sprintf("## %s\n", section.Heading))
			sb.WriteString(section.Content)
			sb.WriteString("\n\n")
		}
	}

	sb.WriteString("</project_instructions>")
	result := sb.String()

	// Truncate if too long
	const maxLen = 8000
	if len(result) > maxLen {
		result = result[:maxLen] + "\n... [truncated]\n</project_instructions>"
	}

	return result
}

// GetFullContext returns all sections (with truncation).
func GetFullContext(pi *ProjectInstructions) string {
	return GetFilteredContext(pi, "")
}

// alwaysInclude are section heading keywords that are always relevant.
var alwaysIncludeKeywords = []string{
	"project", "stack", "architektura", "architecture",
	"conventions", "konwencje", "replies", "structure",
	"foundational", "overview", "opis",
}

func isOverviewSection(heading string) bool {
	h := strings.ToLower(heading)
	return strings.Contains(h, "project") || strings.Contains(h, "overview") ||
		strings.Contains(h, "opis") || strings.Contains(h, "stack")
}

// SectionMatchesExt checks if a section is relevant to the given file extension.
func SectionMatchesExt(section Section, fileExt string) bool {
	techTags := extToTags(fileExt)
	return shouldInclude(section, techTags)
}

func shouldInclude(section Section, techTags []string) bool {
	h := strings.ToLower(section.Heading)

	// Always include core sections
	for _, kw := range alwaysIncludeKeywords {
		if strings.Contains(h, kw) {
			return true
		}
	}

	// If no tech filter, include everything
	if len(techTags) == 0 {
		return true
	}

	// Include if section matches any tech tag
	for _, tag := range techTags {
		for _, sectionTag := range section.Tags {
			if tag == sectionTag {
				return true
			}
		}
		// Also check heading directly
		if strings.Contains(h, tag) {
			return true
		}
	}

	return false
}

// inferTags extracts technology tags from section heading and content.
func inferTags(heading string, content string) []string {
	combined := strings.ToLower(heading + " " + content[:min(len(content), 500)])
	var tags []string

	tagKeywords := map[string][]string{
		"php":        {"php", "laravel", "artisan", "composer", "eloquent", "blade", "pint"},
		"vue":        {"vue", "inertia", "v-model", "v-if", "composition api"},
		"javascript": {"javascript", "js", "node", "npm", "vite", "typescript", "ts"},
		"css":        {"css", "tailwind", "scss", "sass", "less"},
		"database":   {"database", "mysql", "migration", "eloquent", "query", "sql", "db"},
		"docker":     {"docker", "container", "compose"},
		"testing":    {"test", "phpunit", "pest", "jest", "vitest"},
		"api":        {"api", "endpoint", "route", "controller", "rest"},
		"auth":       {"auth", "permission", "role", "guard", "sanctum"},
		"frontend":   {"frontend", "component", "layout", "ui", "inertia"},
		"backend":    {"backend", "controller", "middleware", "service", "job", "queue"},
	}

	for tag, keywords := range tagKeywords {
		for _, kw := range keywords {
			if strings.Contains(combined, kw) {
				tags = append(tags, tag)
				break
			}
		}
	}

	return tags
}

// extToTags maps file extension to relevant technology tags.
func extToTags(ext string) []string {
	ext = strings.TrimPrefix(strings.ToLower(ext), ".")
	switch ext {
	case "php":
		return []string{"php", "backend", "database", "api"}
	case "vue":
		return []string{"vue", "javascript", "frontend", "css"}
	case "ts", "tsx", "js", "jsx":
		return []string{"javascript", "frontend"}
	case "css", "scss", "less":
		return []string{"css", "frontend"}
	case "sql":
		return []string{"database"}
	case "yml", "yaml":
		return []string{"docker"}
	case "blade.php":
		return []string{"php", "frontend"}
	default:
		return nil // no filter = include all
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
