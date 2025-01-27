// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func main() {
	// Ensure at least one argument is provided
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "Usage: go run main.go <file1> <file2> ...")
		os.Exit(1)
	}

	// Get the current working directory
	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error getting current working directory: %v\n", err)
		os.Exit(1)
	}

	for _, filePath := range os.Args[1:] {
		if filePath == "" || filePath == "--" {
			continue
		}
		// Convert file path to an absolute path
		absPath, err := filepath.Abs(filePath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error resolving absolute path for %q: %v\n", filePath, err)
			continue
		}

		finfo, err := os.Stat(absPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error getting file info for %q: %v\n", absPath, err)
			continue
		}
		if finfo.IsDir() {
			fmt.Fprintf(os.Stderr, "%q is a directory, skipping\n", absPath)
			continue
		}

		// Get the path relative to the current working directory
		relPath, err := filepath.Rel(cwd, absPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error resolving relative path for %q: %v\n", absPath, err)
			continue
		}

		// Open the file
		file, err := os.Open(absPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error opening file %q: %v\n", absPath, err)
			continue
		}
		defer file.Close()

		// Print start delimiter with quoted relative path
		fmt.Printf("@@@start file %q\n", relPath)

		// Copy file contents to stdout
		reader := bufio.NewReader(file)
		for {
			line, err := reader.ReadString('\n')
			fmt.Print(line) // Print each line
			if err == io.EOF {
				break
			}
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error reading file %q: %v\n", relPath, err)
				break
			}
		}

		// Print end delimiter with quoted relative path
		fmt.Printf("@@@end file %q\n", relPath)
	}
}
