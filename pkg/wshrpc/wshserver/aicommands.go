// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/waveai"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// AiSendMessageCommand handles sending AI messages
func (ws *WshServer) AiSendMessageCommand(ctx context.Context, data wshrpc.AiMessageData) error {
	// This is a no-op, the message is just passed through
	return nil
}

// AiAttachFileCommand reads a file and prepares it for AI chat attachment
func (ws *WshServer) AiAttachFileCommand(ctx context.Context, filePath string) (*wshrpc.FileAttachment, error) {
	attachment, err := waveai.ReadFileForAIAttachment(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file for AI attachment: %w", err)
	}
	return &attachment, nil
}
