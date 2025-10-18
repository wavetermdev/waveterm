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

	// SummarizeModel is the model used for file summarization
	SummarizeModel = "gemini-2.5-flash-lite"

	// Mode constants
	ModeQuickSummary = "quick"
	ModeUseful       = "useful"
	ModePublicCode   = "publiccode"
	ModeHTMLContent  = "htmlcontent"
	ModeHTMLFull     = "htmlfull"

	// SummarizePrompt is the default prompt used for file summarization
	SummarizePrompt = "Please provide a concise summary of this file. Include the main topics, key points, and any notable information."

	// QuickSummaryPrompt is the prompt for quick file summaries
	QuickSummaryPrompt = `Summarize the following file for another AI agent that is deciding which files to read.

If the content is HTML or web page markup, ignore layout elements such as headers, footers, sidebars, navigation menus, cookie banners, pop-ups, ads, and search boxes. 
Focus only on the visible main content that describes the page’s subject or purpose.

Keep the summary extremely concise — one or two sentences at most.
Explain what the file appears to be and its main purpose or contents.
If it's code, mention the language and what it implements (e.g., a CLI, library, test, or config).
Avoid speculation or verbose explanations.
Do not include markdown, bullets, or formatting — just a plain text summary.`

	// UsefulSummaryPrompt is the prompt for useful file summaries with more detail
	UsefulSummaryPrompt = `You are summarizing a single file so that another AI agent can understand its purpose and structure.

If the content is HTML or web page markup, ignore layout elements such as headers, footers, sidebars, navigation menus, cookie banners, pop-ups, ads, and search boxes. 
Focus only on the visible main content that describes the page’s subject or purpose.

Start with a short overview (2–4 sentences) describing the overall purpose of the file.
If the file is large (more than about 150 lines) or has multiple major sections or functions,
then briefly summarize each major section (1–2 sentences per section) and include an approximate line range in parentheses like "(lines 80–220)".

Keep section summaries extremely concise — only include the most important parts or entry points.
If it's code, mention key functions or classes and what they do.
If it's documentation, describe key topics or sections.
If it's a data or config file, summarize the structure and purpose of the values.

Never produce more text than would fit comfortably on one screen (roughly under 200 words total).
Plain text only — no lists, no markdown, no JSON.`

	// PublicCodeSummaryPrompt is the prompt for public API summaries
	PublicCodeSummaryPrompt = `You are summarizing a SINGLE source file to expose its PUBLIC API to another AI client.

GOAL
Produce a compact, header-like listing of all PUBLIC symbols callers would use.

OUTPUT FORMAT (plain text only; no bullets/markdown/JSON):
1) Public data structures required by public functions (types/structs/interfaces/enums/const groups):
	  <native one-line comment> (lines A–B)
	  <exact single-line declaration>

2) Public functions/methods in order of appearance:
	  <native one-line comment> (lines A–B)
	  <exact single-line signature>

RULES
- PUBLIC means exported/externally visible for the language (Go: capitalized; Java/C#/TS: public; Rust: pub; Python: not underscore-prefixed, etc.).
- Include ALL public functions/methods.
- Include public data structures ONLY if referenced by any public function OR commonly constructed/consumed by callers.
- For multi-line declarations, emit a single-line canonical form by collapsing internal whitespace while preserving tokens and order.
- The one-line comment is either a compressed docstring or, if absent, a concise inferred purpose (≤ 20 words).
- Include approximate line ranges as "(lines A–B)".
- Skip private helpers, tests, examples, and internal-only constants.
- Preserve generics/annotations/modifiers as they appear (e.g., type params, async, const, noexcept).
- No preface or epilogue text—just the listing.

EXAMPLE STYLE (illustrative; use the target language's comment syntax):
// Configuration for the proxy (lines 10–42)
type ProxyConfig struct { ... }

// Creates and configures a new proxy instance (lines 60–92)
func NewProxy(cfg ProxyConfig) (*Proxy, error)

// Handles a single HTTP request (lines 95–168)
func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request)`

	// HTMLContentPrompt is the prompt for converting HTML to content-focused Markdown
	HTMLContentPrompt = `Convert the following stripped HTML into clean Markdown for READING CONTENT ONLY.

- Output Markdown ONLY (no explanations, no JSON, no code fences).
- Keep document title as a single H1 if present (from <title> or first <h1>).
- Preserve headings (h1–h6), paragraphs, strong/emphasis, inline code.
- Convert <a> to [text](absolute_url). If href is relative, resolve against BASE_URL: {{BASE_URL}}. Do not output javascript:void links.
- Preserve lists (ul/ol, nested), blockquotes, and code blocks (<pre><code>) as fenced code (include language if obvious).
- Convert tables to Markdown tables; keep header row; include up to 50 data rows, then append "… (more rows)".
- Keep images ONLY if alt text is descriptive; render as ![alt](absolute_url). Skip tracking pixels and decorative images.
- Discard navigation, site header/footer, sidebars, cookie banners, search bars, newsletter/signup, social share, repetitive link clouds, and legal boilerplate unless they are the ONLY content.
- Preserve in-page structure order; do not invent content; do not summarize prose—extract faithfully.
- Normalize whitespace, collapse repeated blank lines to one.
`

	// HTMLFullPrompt is the prompt for converting HTML to navigation-focused Markdown
	HTMLFullPrompt = `Convert the following stripped HTML into Markdown optimized for SITE NAVIGATION.

- Output Markdown ONLY (no explanations, no JSON, no code fences).
- Start with a top-level title (from <title> or first <h1>) as H1.
- Include primary navigation as a section "## Navigation" with bullet lists of top-level links (use visible link text; dedupe exact duplicates).
- Include secondary nav/footer links under "## Footer Links".
- Then extract the main page content as Markdown (headings, paragraphs, lists, blockquotes, code blocks).
- Convert <a> to [text](absolute_url). If href is relative, resolve against BASE_URL: {{BASE_URL}}.
- Convert tables to Markdown tables; keep header + up to 50 rows, then "… (more rows)".
- Keep images with meaningful alt as ![alt](absolute_url); otherwise skip.
- Preserve order as it appears in the page; do not summarize prose—extract faithfully.
- Normalize whitespace; collapse repeated blank lines.`
)

// SummarizeOpts contains options for file summarization
type SummarizeOpts struct {
	APIKey string
	Mode   string
}

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

func getMaxFileSize(mimeType, mode string) (int, string) {
	if mimeType == "application/pdf" {
		return 5 * 1024 * 1024, "5MB"
	}
	if strings.HasPrefix(mimeType, "image/") {
		return 7 * 1024 * 1024, "7MB"
	}
	if mode == ModeHTMLContent || mode == ModeHTMLFull {
		return 500 * 1024, "500KB"
	}
	return 200 * 1024, "200KB"
}

// SummarizeFile reads a file and generates a summary using Google's Generative AI.
// It supports images, PDFs, and text files based on the limits defined in wshcmd-ai.go.
// Returns the summary text, usage information, and any error encountered.
func SummarizeFile(ctx context.Context, filename string, opts SummarizeOpts) (string, *GoogleUsage, error) {
	if opts.Mode == "" {
		return "", nil, fmt.Errorf("mode is required")
	}

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
	maxSize, sizeStr := getMaxFileSize(mimeType, opts.Mode)
	if len(data) > maxSize {
		return "", nil, fmt.Errorf("file exceeds maximum size of %s for %s files", sizeStr, mimeType)
	}

	// Create client
	client, err := genai.NewClient(ctx, option.WithAPIKey(opts.APIKey))
	if err != nil {
		return "", nil, fmt.Errorf("creating Google AI client: %w", err)
	}
	defer client.Close()

	// Create model
	model := client.GenerativeModel(SummarizeModel)

	// Select prompt based on mode
	var prompt string
	switch opts.Mode {
	case ModeQuickSummary:
		prompt = QuickSummaryPrompt
	case ModeUseful:
		prompt = UsefulSummaryPrompt
	case ModePublicCode:
		prompt = PublicCodeSummaryPrompt
	case ModeHTMLContent:
		prompt = HTMLContentPrompt
	case ModeHTMLFull:
		prompt = HTMLFullPrompt
	default:
		prompt = SummarizePrompt
	}

	// Prepare the content parts
	var parts []genai.Part

	// Add the prompt
	parts = append(parts, genai.Text(prompt))

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
