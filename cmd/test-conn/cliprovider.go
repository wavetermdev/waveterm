// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/userinput"
)

type CLIProvider struct {
	AutoAccept bool
}

func (p *CLIProvider) GetUserInput(ctx context.Context, request *userinput.UserInputRequest) (*userinput.UserInputResponse, error) {
	response := &userinput.UserInputResponse{
		Type:      request.ResponseType,
		RequestId: request.RequestId,
	}

	if request.Title != "" {
		fmt.Printf("\n=== %s ===\n", request.Title)
	}
	fmt.Printf("%s\n", request.QueryText)

	if p.AutoAccept {
		fmt.Printf("Auto-accepting (use -i for interactive mode)\n")
		response.Confirm = true
		response.Text = "yes"
		return response, nil
	}

	reader := bufio.NewReader(os.Stdin)
	fmt.Printf("Accept? [y/n]: ")
	text, err := reader.ReadString('\n')
	if err != nil {
		response.ErrorMsg = fmt.Sprintf("error reading input: %v", err)
		return response, err
	}

	text = strings.TrimSpace(strings.ToLower(text))
	if text == "y" || text == "yes" {
		response.Confirm = true
		response.Text = "yes"
	} else {
		response.Confirm = false
		response.Text = "no"
	}

	return response, nil
}
