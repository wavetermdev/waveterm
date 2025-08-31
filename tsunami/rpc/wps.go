// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package rpc

const (
	Event_BlockClose = "blockclose"
)

type WaveEvent struct {
	Event   string   `json:"event"`
	Scopes  []string `json:"scopes,omitempty"`
	Sender  string   `json:"sender,omitempty"`
	Persist int      `json:"persist,omitempty"`
	Data    any      `json:"data,omitempty"`
}

func (e WaveEvent) HasScope(scope string) bool {
	for _, s := range e.Scopes {
		if s == scope {
			return true
		}
	}
	return false
}

type SubscriptionRequest struct {
	Event     string   `json:"event"`
	Scopes    []string `json:"scopes,omitempty"`
	AllScopes bool     `json:"allscopes,omitempty"`
}