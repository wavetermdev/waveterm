// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/google"
)

func printUsage() {
	fmt.Println("Usage: go run main-testsummarize.go [--help] [--mode MODE] <filename>")
	fmt.Println("Examples:")
	fmt.Println("  go run main-testsummarize.go README.md")
	fmt.Println("  go run main-testsummarize.go --mode useful /path/to/image.png")
	fmt.Println("  go run main-testsummarize.go -m publiccode document.pdf")
	fmt.Println("")
	fmt.Println("Supported file types:")
	fmt.Println("  - Text files (up to 200KB)")
	fmt.Println("  - Images (up to 7MB)")
	fmt.Println("  - PDFs (up to 5MB)")
	fmt.Println("")
	fmt.Println("Flags:")
	fmt.Println("  --mode, -m  Summarization mode (default: quick)")
	fmt.Println("              Options: quick, useful, publiccode, htmlcontent, htmlfull")
	fmt.Println("")
	fmt.Println("Environment variables:")
	fmt.Println("  GOOGLE_APIKEY (required)")
}

func main() {
	var showHelp bool
	var mode string
	flag.BoolVar(&showHelp, "help", false, "Show usage information")
	flag.StringVar(&mode, "mode", "quick", "Summarization mode")
	flag.StringVar(&mode, "m", "quick", "Summarization mode (shorthand)")
	flag.Parse()

	if showHelp {
		printUsage()
		os.Exit(0)
	}

	apiKey := os.Getenv("GOOGLE_APIKEY")
	if apiKey == "" {
		fmt.Println("Error: GOOGLE_APIKEY environment variable not set")
		printUsage()
		os.Exit(1)
	}

	args := flag.Args()
	if len(args) == 0 {
		fmt.Println("Error: filename required")
		printUsage()
		os.Exit(1)
	}

	filename := args[0]

	// Check if file exists
	if _, err := os.Stat(filename); os.IsNotExist(err) {
		fmt.Printf("Error: file '%s' does not exist\n", filename)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	fmt.Printf("Summarizing file: %s\n", filename)
	fmt.Printf("Model: %s\n", google.SummarizeModel)
	fmt.Printf("Mode: %s\n", mode)

	startTime := time.Now()
	summary, usage, err := google.SummarizeFile(ctx, filename, google.SummarizeOpts{
		APIKey: apiKey,
		Mode:   mode,
	})
	latency := time.Since(startTime)

	fmt.Printf("Latency: %d ms\n", latency.Milliseconds())
	fmt.Println("===")
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("\nSummary:")
	fmt.Println("---")
	fmt.Println(summary)
	fmt.Println("---")

	if usage != nil {
		fmt.Println("\nUsage Statistics:")
		fmt.Printf("  Prompt tokens: %d\n", usage.PromptTokenCount)
		fmt.Printf("  Cached tokens: %d\n", usage.CachedContentTokenCount)
		fmt.Printf("  Response tokens: %d\n", usage.CandidatesTokenCount)
		fmt.Printf("  Total tokens: %d\n", usage.TotalTokenCount)
	}
}