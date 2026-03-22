// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/woveterm/wove/pkg/aiusechat/uctypes"
	"github.com/woveterm/wove/pkg/waveobj"
	"github.com/woveterm/wove/pkg/wcore"
	"github.com/woveterm/wove/pkg/wshrpc"
	"github.com/woveterm/wove/pkg/wshrpc/wshclient"
	"github.com/woveterm/wove/pkg/wshutil"
	"github.com/woveterm/wove/pkg/wstore"
)

type WebNavigateToolInput struct {
	WidgetId string `json:"widget_id"`
	Url      string `json:"url"`
}

func parseWebNavigateInput(input any) (*WebNavigateToolInput, error) {
	result := &WebNavigateToolInput{}

	if input == nil {
		return nil, fmt.Errorf("input is required")
	}

	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	if result.WidgetId == "" {
		return nil, fmt.Errorf("widget_id is required")
	}

	if result.Url == "" {
		return nil, fmt.Errorf("url is required")
	}

	return result, nil
}

func GetWebNavigateToolDefinition(tabId string) uctypes.ToolDefinition {

	return uctypes.ToolDefinition{
		Name:        "web_navigate",
		DisplayName: "Navigate Web Widget",
		Description: "Navigate web widget to a URL.",
		ToolLogName: "web:navigate",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the web browser widget",
				},
				"url": map[string]any{
					"type":        "string",
					"description": "URL to navigate to",
				},
			},
			"required":             []string{"widget_id", "url"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseWebNavigateInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("navigating web widget %s to %q", parsed.WidgetId, parsed.Url)
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseWebNavigateInput(input)
			if err != nil {
				return nil, err
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, err
			}

			blockORef := waveobj.MakeORef(waveobj.OType_Block, fullBlockId)
			meta := map[string]any{
				"url": parsed.Url,
			}

			err = wstore.UpdateObjectMeta(ctx, blockORef, meta, false)
			if err != nil {
				return nil, fmt.Errorf("failed to update web block URL: %w", err)
			}

			wcore.SendWaveObjUpdate(blockORef)
			return true, nil
		},
	}
}

// webSelectorInput holds parsed input for web selector tools.
type webSelectorInput struct {
	WidgetId string
	Selector string
}

func parseWebSelectorInput(input any) (*webSelectorInput, error) {
	inputMap, ok := input.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid input format")
	}
	widgetId, ok := inputMap["widget_id"].(string)
	if !ok || widgetId == "" {
		return nil, fmt.Errorf("missing or invalid widget_id parameter")
	}
	selector, _ := inputMap["selector"].(string)
	if selector == "" {
		selector = "body"
	}
	return &webSelectorInput{WidgetId: widgetId, Selector: selector}, nil
}

// webReadContent resolves a web widget, reloads it, and fetches content via CSS selector.
func webReadContent(tabId string, input *webSelectorInput, opts *wshrpc.WebSelectorOpts) (string, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancelFn()

	fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, input.WidgetId)
	if err != nil {
		return "", fmt.Errorf("resolving block: %w", err)
	}

	rpcClient := wshclient.GetBareRpcClient()
	blockInfo, err := wshclient.BlockInfoCommand(rpcClient, fullBlockId, nil)
	if err != nil {
		return "", fmt.Errorf("getting block info: %w", err)
	}

	// Reload the page before reading to ensure fresh content
	reloadData := wshrpc.CommandWebSelectorData{
		WorkspaceId: blockInfo.WorkspaceId,
		BlockId:     fullBlockId,
		TabId:       blockInfo.TabId,
		Selector:    "body",
		Opts:        &wshrpc.WebSelectorOpts{Reload: true},
	}
	_, _ = wshclient.WebSelectorCommand(rpcClient, reloadData, &wshrpc.RpcOpts{
		Route:   wshutil.ElectronRoute,
		Timeout: 15000,
	})

	// Fetch content with the requested options
	data := wshrpc.CommandWebSelectorData{
		WorkspaceId: blockInfo.WorkspaceId,
		BlockId:     fullBlockId,
		TabId:       blockInfo.TabId,
		Selector:    input.Selector,
		Opts:        opts,
	}
	results, err := wshclient.WebSelectorCommand(rpcClient, data, &wshrpc.RpcOpts{
		Route:   wshutil.ElectronRoute,
		Timeout: 10000,
	})
	if err != nil {
		return "", fmt.Errorf("reading web content: %w", err)
	}
	if len(results) == 0 {
		return "", fmt.Errorf("no elements matched selector %q", input.Selector)
	}

	text := strings.Join(results, "\n")
	const maxLen = 50000
	if len(text) > maxLen {
		text = text[:maxLen] + "\n... [truncated]"
	}
	return text, nil
}

func webToolCallDesc(toolAction string) func(any, any, *uctypes.UIMessageDataToolUse) string {
	return func(input any, output any, _ *uctypes.UIMessageDataToolUse) string {
		parsed, err := parseWebSelectorInput(input)
		if err != nil {
			return fmt.Sprintf("error: %v", err)
		}
		return fmt.Sprintf("%s from web widget %s (selector: %s)", toolAction, parsed.WidgetId, parsed.Selector)
	}
}

var webSelectorSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"widget_id": map[string]any{
			"type":        "string",
			"description": "8-character widget ID of the web browser widget",
		},
		"selector": map[string]any{
			"type":        "string",
			"description": "CSS selector to target elements (e.g. 'body', 'main', 'article', '.content', '#main-text'). Defaults to 'body'.",
		},
	},
	"required": []string{"widget_id"},
}

func GetWebReadTextToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:             "web_read_text",
		DisplayName:      "Read Web Page Text",
		Description:      "Get page text by CSS selector. Auto-refreshes. Returns clean text, no HTML.",
		ShortDescription: "Read text from web widget",
		ToolLogName:      "web:readtext",
		InputSchema:      webSelectorSchema,
		ToolCallDesc:     webToolCallDesc("reading text"),
		ToolTextCallback: func(input any) (string, error) {
			parsed, err := parseWebSelectorInput(input)
			if err != nil {
				return "", err
			}
			return webReadContent(tabId, parsed, &wshrpc.WebSelectorOpts{InnerText: true, All: true, Highlight: true})
		},
	}
}

func GetWebReadHTMLToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:             "web_read_html",
		DisplayName:      "Read Web Page HTML",
		Description:      "Get innerHTML by CSS selector. Auto-refreshes. For inspecting page structure and attributes.",
		ShortDescription: "Read HTML from web widget",
		ToolLogName:      "web:readhtml",
		InputSchema:      webSelectorSchema,
		ToolCallDesc:     webToolCallDesc("reading HTML"),
		ToolTextCallback: func(input any) (string, error) {
			parsed, err := parseWebSelectorInput(input)
			if err != nil {
				return "", err
			}
			return webReadContent(tabId, parsed, &wshrpc.WebSelectorOpts{Inner: true, All: true, Highlight: true})
		},
	}
}

const seoAuditJS = `
const data = {};

// Title
data.title = document.title || '';

// Meta tags
const metas = {};
document.querySelectorAll('meta[name], meta[property]').forEach(m => {
    const key = m.getAttribute('name') || m.getAttribute('property');
    if (key) metas[key] = m.getAttribute('content') || '';
});
data.meta = metas;

// Canonical
const canonical = document.querySelector('link[rel="canonical"]');
data.canonical = canonical ? canonical.getAttribute('href') : null;

// Hreflang
const hreflangs = [];
document.querySelectorAll('link[rel="alternate"][hreflang]').forEach(l => {
    hreflangs.push({ lang: l.getAttribute('hreflang'), href: l.getAttribute('href') });
});
if (hreflangs.length) data.hreflang = hreflangs;

// JSON-LD
const jsonLd = [];
document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try { jsonLd.push(JSON.parse(s.textContent)); } catch(e) { jsonLd.push({ error: e.message, raw: s.textContent.slice(0, 500) }); }
});
if (jsonLd.length) data.jsonLd = jsonLd;

// Open Graph
const og = {};
document.querySelectorAll('meta[property^="og:"]').forEach(m => {
    og[m.getAttribute('property')] = m.getAttribute('content') || '';
});
if (Object.keys(og).length) data.openGraph = og;

// Twitter Card
const tw = {};
document.querySelectorAll('meta[name^="twitter:"]').forEach(m => {
    tw[m.getAttribute('name')] = m.getAttribute('content') || '';
});
if (Object.keys(tw).length) data.twitterCard = tw;

// Headings structure
const headings = {};
['h1','h2','h3'].forEach(tag => {
    const els = document.querySelectorAll(tag);
    if (els.length) headings[tag] = Array.from(els).map(e => e.innerText.trim().slice(0, 100));
});
data.headings = headings;

// Images without alt
const imgsNoAlt = [];
document.querySelectorAll('img:not([alt]), img[alt=""]').forEach(img => {
    imgsNoAlt.push(img.src?.slice(0, 200) || img.getAttribute('data-src')?.slice(0, 200) || '[inline]');
});
if (imgsNoAlt.length) data.imagesWithoutAlt = imgsNoAlt;

// Links count
data.links = {
    internal: document.querySelectorAll('a[href^="/"], a[href^="' + location.origin + '"]').length,
    external: document.querySelectorAll('a[href^="http"]').length - document.querySelectorAll('a[href^="' + location.origin + '"]').length,
    nofollow: document.querySelectorAll('a[rel*="nofollow"]').length,
};

// URL
data.url = location.href;

return JSON.stringify(data, null, 2);
`

func GetWebSEOAuditToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:             "web_seo_audit",
		DisplayName:      "SEO Audit",
		Description:      "Full SEO audit: title, meta, canonical, hreflang, JSON-LD, OG, Twitter Card, headings, alt text, links. Auto-refreshes.",
		ShortDescription: "SEO audit of web page",
		ToolLogName:      "web:seoaudit",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the web browser widget",
				},
			},
			"required": []string{"widget_id"},
		},
		ToolCallDesc: func(input any, output any, _ *uctypes.UIMessageDataToolUse) string {
			inputMap, _ := input.(map[string]any)
			widgetId, _ := inputMap["widget_id"].(string)
			return fmt.Sprintf("running SEO audit on web widget %s", widgetId)
		},
		ToolTextCallback: func(input any) (string, error) {
			parsed, err := parseWebSelectorInput(input)
			if err != nil {
				return "", err
			}
			return webReadContent(tabId, parsed, &wshrpc.WebSelectorOpts{ExecJs: seoAuditJS})
		},
	}
}
