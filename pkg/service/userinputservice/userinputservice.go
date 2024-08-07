// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package userinputservice

import (
	"github.com/wavetermdev/thenextwave/pkg/userinput"
)

type UserInputService struct {
}

func (uis *UserInputService) SendUserInputResponse(response *userinput.UserInputResponse) {
	select {
	case userinput.MainUserInputHandler.Channels[response.RequestId] <- response:
	default:
	}
}