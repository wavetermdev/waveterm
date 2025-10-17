// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package google

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/google/generative-ai-go/genai"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"google.golang.org/api/option"
)

const (
	// GoogleAPIURL is the base URL for the Google Generative AI API
	GoogleAPIURL = "https://generativelanguage.googleapis.com"

	// SummarizePrompt is the prompt used for file summarization
	SummarizePrompt = "Please provide a concise summary of this file. Include the main topics, key points, and any notable information."

	// SummarizeModel is the model used for file summarization
	SummarizeModel = "gemini-2.5-flash-lite"
)

// GoogleUsage represents token usage information from Google's Generative AI API
type GoogleUsage struct {
	PromptTokenCount        int32 `json:"prompt_token_count"`
	CachedContentTokenCount int32 `json:"cached_content_token_count"`
	CandidatesTokenCount    int32 `json:"candidates_token_count"`
	TotalTokenCount         int32 `json:"total_token_count"`
}

func detectMimeType(data []byte) string {
	mimeType := http.DetectContentType(data)
	return strings.Split(mimeType, ";")[0]
}

func getMaxFileSize(mimeType string) (int, string) {
	if mimeType == "application/pdf" {
		return 5 * 1024 * 1024, "5MB"
	}
	if strings.HasPrefix(mimeType, "image/") {
		return 7 * 1024 * 1024, "7MB"
	}
	return 200 * 1024, "200KB"
}

// SummarizeFile reads a file and generates a summary using Google's Generative AI.
// It supports images, PDFs, and text files based on the limits defined in wshcmd-ai.go.
// Returns the summary text, usage information, and any error encountered.
func SummarizeFile(ctx context.Context, filename string, apiKey string) (string, *GoogleUsage, error) {
	// Read the file
	data, err := os.ReadFile(filename)
	if err != nil {
		return "", nil, fmt.Errorf("reading file: %w", err)
	}

	// Detect MIME type
	mimeType := detectMimeType(data)

	isPDF := mimeType == "application/pdf"
	isImage := strings.HasPrefix(mimeType, "image/")

	if !isPDF && !isImage {
		mimeType = "text/plain"
		if utilfn.ContainsBinaryData(data) {
			return "", nil, fmt.Errorf("file contains binary data and cannot be summarized")
		}
	}

	// Validate file size
	maxSize, sizeStr := getMaxFileSize(mimeType)
	if len(data) > maxSize {
		return "", nil, fmt.Errorf("file exceeds maximum size of %s for %s files", sizeStr, mimeType)
	}

	// Create client
	client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return "", nil, fmt.Errorf("creating Google AI client: %w", err)
	}
	defer client.Close()

	// Create model
	model := client.GenerativeModel(SummarizeModel)

	// Prepare the content parts
	var parts []genai.Part

	// Add the prompt
	parts = append(parts, genai.Text(SummarizePrompt))

	// Add the file content based on type
	if isImage {
		// For images, use Blob
		parts = append(parts, genai.Blob{
			MIMEType: mimeType,
			Data:     data,
		})
	} else if isPDF {
		// For PDFs, use Blob
		parts = append(parts, genai.Blob{
			MIMEType: mimeType,
			Data:     data,
		})
	} else {
		// For text files, convert to string
		parts = append(parts, genai.Text(string(data)))
	}

	// Generate content
	resp, err := model.GenerateContent(ctx, parts...)
	if err != nil {
		return "", nil, fmt.Errorf("generating content: %w", err)
	}

	// Check if we got any candidates
	if len(resp.Candidates) == 0 {
		return "", nil, fmt.Errorf("no response candidates returned")
	}

	// Extract the text from the first candidate
	candidate := resp.Candidates[0]
	if candidate.Content == nil || len(candidate.Content.Parts) == 0 {
		return "", nil, fmt.Errorf("no content in response")
	}

	var summary strings.Builder
	for _, part := range candidate.Content.Parts {
		if textPart, ok := part.(genai.Text); ok {
			summary.WriteString(string(textPart))
		}
	}

	// Convert usage metadata
	var usage *GoogleUsage
	if resp.UsageMetadata != nil {
		usage = &GoogleUsage{
			PromptTokenCount:        resp.UsageMetadata.PromptTokenCount,
			CachedContentTokenCount: resp.UsageMetadata.CachedContentTokenCount,
			CandidatesTokenCount:    resp.UsageMetadata.CandidatesTokenCount,
			TotalTokenCount:         resp.UsageMetadata.TotalTokenCount,
		}
	}

	return summary.String(), usage, nil
}
