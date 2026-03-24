// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package google provides Google Generative AI integration for WaveTerm.
//
// This package implements file summarization using Google's Gemini models.
// Unlike other AI provider implementations in the aiusechat package, this
// package does NOT implement full SSE streaming. It uses a simple
// request-response API for file summarization.
//
// # Supported File Types
//
// The package supports the same file types as defined in wshcmd-ai.go:
//   - Images (PNG, JPEG, etc.): up to 7MB
//   - PDFs: up to 5MB
//   - Text files: up to 200KB
//
// Binary files are rejected unless they are recognized as images or PDFs.
//
// # Usage
//
// To summarize a file:
//
//	ctx := context.Background()
//	summary, usage, err := google.SummarizeFile(ctx, "/path/to/file.txt", google.SummarizeOpts{
//		APIKey: "YOUR_API_KEY",
//		Mode:   google.ModeQuickSummary,
//	})
//	if err != nil {
//	    log.Fatal(err)
//	}
//	fmt.Println("Summary:", summary)
//	fmt.Printf("Tokens used: %d\n", usage.TotalTokenCount)
//
// # Configuration
//
// The summarization behavior can be customized by modifying the constants:
//   - SummarizeModel: The Gemini model to use (default: "gemini-2.5-flash-lite")
//   - SummarizePrompt: The prompt sent to the model
//   - GoogleAPIURL: The base URL for the API (for reference, not currently used by the SDK)
package google
