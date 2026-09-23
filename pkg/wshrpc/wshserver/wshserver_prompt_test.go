// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import "testing"

func TestBuildPromptRequest(t *testing.T) {
	t.Run("text prompt when options empty", func(t *testing.T) {
		req := buildPromptRequest("What is your name?", "", nil, 0, "")
		if req.QueryText != "What is your name?" {
			t.Fatalf("QueryText = %q, want %q", req.QueryText, "What is your name?")
		}
		if req.Title != "Wave Terminal" {
			t.Fatalf("Title = %q, want %q", req.Title, "Wave Terminal")
		}
		if req.ResponseType != "text" {
			t.Fatalf("ResponseType = %q, want %q", req.ResponseType, "text")
		}
		if !req.PublicText {
			t.Fatalf("PublicText = false, want true")
		}
		if req.PromptType != "confirm" {
			t.Fatalf("PromptType = %q, want %q", req.PromptType, "confirm")
		}
		if req.Markdown {
			t.Fatalf("Markdown = true, want false")
		}
		if len(req.Options) != 0 {
			t.Fatalf("Options = %v, want empty", req.Options)
		}
	})

	t.Run("text prompt keeps custom title", func(t *testing.T) {
		req := buildPromptRequest("Question?", "Custom Title", nil, 0, "")
		if req.Title != "Custom Title" {
			t.Fatalf("Title = %q, want %q", req.Title, "Custom Title")
		}
		if req.ResponseType != "text" {
			t.Fatalf("ResponseType = %q, want %q", req.ResponseType, "text")
		}
	})

	t.Run("options prompt", func(t *testing.T) {
		req := buildPromptRequest("Deploy?", "", []string{"yes", "no"}, 0, "")
		if req.QueryText != "Deploy?" {
			t.Fatalf("QueryText = %q, want %q", req.QueryText, "Deploy?")
		}
		if req.ResponseType != "options" {
			t.Fatalf("ResponseType = %q, want %q", req.ResponseType, "options")
		}
		if len(req.Options) != 2 {
			t.Fatalf("len(Options) = %d, want 2", len(req.Options))
		}
		if req.Options[0] != "yes" || req.Options[1] != "no" {
			t.Fatalf("Options = %v, want [yes no]", req.Options)
		}
		if req.PromptType != "confirm" {
			t.Fatalf("PromptType = %q, want %q", req.PromptType, "confirm")
		}
	})

	t.Run("options prompt with empty slice stays text", func(t *testing.T) {
		req := buildPromptRequest("Q?", "", []string{}, 0, "")
		if req.ResponseType != "text" {
			t.Fatalf("ResponseType = %q, want %q", req.ResponseType, "text")
		}
		if len(req.Options) != 0 {
			t.Fatalf("Options = %v, want empty", req.Options)
		}
	})

	t.Run("timeout and default option are copied", func(t *testing.T) {
		req := buildPromptRequest("Deploy?", "", []string{"yes", "no"}, 120000, "no")
		if req.TimeoutMs != 120000 {
			t.Fatalf("TimeoutMs = %d, want 120000", req.TimeoutMs)
		}
		if req.DefaultOption != "no" {
			t.Fatalf("DefaultOption = %q, want %q", req.DefaultOption, "no")
		}
	})
}
