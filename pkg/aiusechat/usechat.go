// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/user"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/util/ds"
	"github.com/wavetermdev/waveterm/pkg/util/logutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveappstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	APIType_Anthropic = "anthropic"
	APIType_OpenAI    = "openai"
)

const DefaultAPI = APIType_OpenAI
const DefaultMaxTokens = 4 * 1024
const BuilderMaxTokens = 24 * 1024

var (
	globalRateLimitInfo = &uctypes.RateLimitInfo{Unknown: true}
	rateLimitLock       sync.Mutex

	activeToolMap = ds.MakeSyncMap[bool]() // key is toolcallid
	activeChats   = ds.MakeSyncMap[bool]() // key is chatid
)

var SystemPromptText = strings.Join([]string{
	`You are Wave AI, an intelligent assistant embedded within Wave Terminal, a modern terminal application with graphical widgets.`,
	`You appear as a pull-out panel on the left side of a tab, with the tab's widgets laid out on the right.`,
	`Widget context is provided as informationa only.`,
	`Do NOT assume any API access or ability to interact with the widgets except via tools provided (note that some widgets may expose NO tools, so their context is informational only).`,
}, " ")

var SystemPromptText_OpenAI = strings.Join([]string{
	`You are Wave AI, an assistant embedded in Wave Terminal (a terminal with graphical widgets).`,
	`You appear as a pull-out panel on the left; widgets are on the right.`,

	// Capabilities & truthfulness
	`Tools define your only capabilities. If a capability is not provided by a tool, you cannot do it.`,
	`Context from widgets is read-only unless a tool explicitly grants interaction.`,
	`Never fabricate data. If you lack data or access, say so and offer the next best step (e.g., suggest enabling a tool).`,

	// Crisp behavior
	`Be concise and direct. Prefer determinism over speculation. If a brief clarifying question eliminates guesswork, ask it.`,

	// Attached text files
	`User-attached text files may appear inline as <AttachedTextFile_xxxxxxxx file_name="...">\ncontent\n</AttachedTextFile_xxxxxxxx>.`,
	`User-attached directories use the tag <AttachedDirectoryListing_xxxxxxxx directory_name="...">JSON DirInfo</AttachedDirectoryListing_xxxxxxxx>.`,
	`If multiple attached files exist, treat each as a separate source file with its own file_name.`,
	`When the user refers to these files, use their inline content directly; do NOT call any read_text_file or file-access tools to re-read them unless asked.`,

	// Output & formatting
	`When presenting commands or any runnable multi-line code, always use fenced Markdown code blocks.`,
	`Use an appropriate language hint after the opening fence (e.g., "bash" for shell commands, "go" for Go, "json" for JSON).`,
	`For shell commands, do NOT prefix lines with "$" or shell prompts. Use placeholders in ALL_CAPS (e.g., PROJECT_ID) and explain them once after the block if needed.`,
	"Reserve inline code (single backticks) for short references like command names (`grep`, `less`), flags, env vars, file paths, or tiny snippets not meant to be executed.",
	`You may use Markdown (lists, tables, bold/italics) to improve readability.`,
	`Never comment on or justify your formatting choices; just follow these rules.`,
	`When generating code or command blocks, try to keep lines under ~100 characters wide where practical (soft wrap; do not break tokens mid-word). Favor indentation and short variable names to stay compact, but correctness always takes priority.`,

	// Safety & limits
	`If a request would execute dangerous or destructive actions, warn briefly and provide a safer alternative.`,
	`If output is very long, prefer a brief summary plus a copy-ready fenced block or offer a follow-up chunking strategy.`,

	`You can write and edit local files on disk using available tools, but you cannot execute shell commands, run code in the terminal, or read/write remote files.`,
	`If the user asks you to execute commands or run code, or deal with remote files say that these features aren't available yet AND make sure to say that they are coming soon (stay tuned for updates).`,
	`Instead, show them exactly what command or code they could copy-paste to run manually.`,

	// Final reminder
	`You have NO API access to widgets or Wave unless provided via an explicit tool.`,
}, " ")

func getWaveAISettings(premium bool, builderMode bool, rtInfo *waveobj.ObjRTInfo) (*uctypes.AIOptsType, error) {
	baseUrl := uctypes.DefaultAIEndpoint
	if os.Getenv("WAVETERM_WAVEAI_ENDPOINT") != "" {
		baseUrl = os.Getenv("WAVETERM_WAVEAI_ENDPOINT")
	}
	maxTokens := DefaultMaxTokens
	if builderMode {
		maxTokens = BuilderMaxTokens
	}
	if rtInfo != nil && rtInfo.WaveAIMaxOutputTokens > 0 {
		maxTokens = rtInfo.WaveAIMaxOutputTokens
	}
	var thinkingMode string
	if premium {
		thinkingMode = uctypes.ThinkingModeBalanced
		if rtInfo != nil && rtInfo.WaveAIThinkingMode != "" {
			thinkingMode = rtInfo.WaveAIThinkingMode
		}
	} else {
		thinkingMode = uctypes.ThinkingModeQuick
	}
	if DefaultAPI == APIType_Anthropic {
		thinkingLevel := uctypes.ThinkingLevelMedium
		return &uctypes.AIOptsType{
			APIType:       APIType_Anthropic,
			Model:         uctypes.DefaultAnthropicModel,
			MaxTokens:     maxTokens,
			ThinkingLevel: thinkingLevel,
			ThinkingMode:  thinkingMode,
			BaseURL:       baseUrl,
		}, nil
	} else if DefaultAPI == APIType_OpenAI {
		var model string
		var thinkingLevel string

		switch thinkingMode {
		case uctypes.ThinkingModeQuick:
			model = uctypes.DefaultOpenAIModel
			thinkingLevel = uctypes.ThinkingLevelLow
		case uctypes.ThinkingModeBalanced:
			model = uctypes.PremiumOpenAIModel
			thinkingLevel = uctypes.ThinkingLevelLow
		case uctypes.ThinkingModeDeep:
			model = uctypes.PremiumOpenAIModel
			thinkingLevel = uctypes.ThinkingLevelMedium
		default:
			model = uctypes.PremiumOpenAIModel
			thinkingLevel = uctypes.ThinkingLevelLow
		}

		return &uctypes.AIOptsType{
			APIType:       APIType_OpenAI,
			Model:         model,
			MaxTokens:     maxTokens,
			ThinkingLevel: thinkingLevel,
			ThinkingMode:  thinkingMode,
			BaseURL:       baseUrl,
		}, nil
	}
	return nil, fmt.Errorf("invalid API type: %s", DefaultAPI)
}

func shouldUseChatCompletionsAPI(model string) bool {
	m := strings.ToLower(model)
	// Chat Completions API is required for older models: gpt-3.5-*, gpt-4, gpt-4-turbo, o1-*
	return strings.HasPrefix(m, "gpt-3.5") ||
		strings.HasPrefix(m, "gpt-4-") ||
		m == "gpt-4" ||
		strings.HasPrefix(m, "o1-")
}

func shouldUsePremium() bool {
	info := GetGlobalRateLimit()
	if info == nil || info.Unknown {
		return true
	}
	if info.PReq > 0 {
		return true
	}
	nowEpoch := time.Now().Unix()
	if nowEpoch >= info.ResetEpoch {
		return true
	}
	return false
}

func updateRateLimit(info *uctypes.RateLimitInfo) {
	if info == nil {
		return
	}
	rateLimitLock.Lock()
	defer rateLimitLock.Unlock()
	globalRateLimitInfo = info
	go func() {
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_WaveAIRateLimit,
			Data:  info,
		})
	}()
}

func GetGlobalRateLimit() *uctypes.RateLimitInfo {
	rateLimitLock.Lock()
	defer rateLimitLock.Unlock()
	return globalRateLimitInfo
}

func runAIChatStep(ctx context.Context, sseHandler *sse.SSEHandlerCh, backend UseChatBackend, chatOpts uctypes.WaveChatOpts, cont *uctypes.WaveContinueResponse) (*uctypes.WaveStopReason, []uctypes.GenAIMessage, error) {
	if chatOpts.Config.APIType == APIType_OpenAI && shouldUseChatCompletionsAPI(chatOpts.Config.Model) {
		return nil, nil, fmt.Errorf("Chat completions API not available (must use newer OpenAI models)")
	}
	stopReason, messages, rateLimitInfo, err := backend.RunChatStep(ctx, sseHandler, chatOpts, cont)
	updateRateLimit(rateLimitInfo)
	return stopReason, messages, err
}

func getUsage(msgs []uctypes.GenAIMessage) uctypes.AIUsage {
	var rtn uctypes.AIUsage
	var found bool
	for _, msg := range msgs {
		if usage := msg.GetUsage(); usage != nil {
			if !found {
				rtn = *usage
				found = true
			} else {
				rtn.InputTokens += usage.InputTokens
				rtn.OutputTokens += usage.OutputTokens
				rtn.NativeWebSearchCount += usage.NativeWebSearchCount
			}
		}
	}
	return rtn
}

func GetChatUsage(chat *uctypes.AIChat) uctypes.AIUsage {
	usage := getUsage(chat.NativeMessages)
	usage.APIType = chat.APIType
	usage.Model = chat.Model
	return usage
}

func updateToolUseDataInChat(backend UseChatBackend, chatOpts uctypes.WaveChatOpts, toolCallID string, toolUseData *uctypes.UIMessageDataToolUse) {
	if err := backend.UpdateToolUseData(chatOpts.ChatId, toolCallID, toolUseData); err != nil {
		log.Printf("failed to update tool use data in chat: %v\n", err)
	}
}

func processToolCallInternal(backend UseChatBackend, toolCall uctypes.WaveToolCall, chatOpts uctypes.WaveChatOpts, toolDef *uctypes.ToolDefinition, sseHandler *sse.SSEHandlerCh) uctypes.AIToolResult {
	if toolCall.ToolUseData == nil {
		return uctypes.AIToolResult{
			ToolName:  toolCall.Name,
			ToolUseID: toolCall.ID,
			ErrorText: "Invalid Tool Call",
		}
	}

	if toolCall.ToolUseData.Status == uctypes.ToolUseStatusError {
		errorMsg := toolCall.ToolUseData.ErrorMessage
		if errorMsg == "" {
			errorMsg = "Unspecified Tool Error"
		}
		return uctypes.AIToolResult{
			ToolName:  toolCall.Name,
			ToolUseID: toolCall.ID,
			ErrorText: errorMsg,
		}
	}

	if toolDef != nil && toolDef.ToolVerifyInput != nil {
		if err := toolDef.ToolVerifyInput(toolCall.Input, toolCall.ToolUseData); err != nil {
			errorMsg := fmt.Sprintf("Input validation failed: %v", err)
			toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
			toolCall.ToolUseData.ErrorMessage = errorMsg
			return uctypes.AIToolResult{
				ToolName:  toolCall.Name,
				ToolUseID: toolCall.ID,
				ErrorText: errorMsg,
			}
		}
		// ToolVerifyInput can modify the toolusedata.  re-send it here.
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, toolCall.ToolUseData)
	}

	if toolCall.ToolUseData.Approval == uctypes.ApprovalNeedsApproval {
		log.Printf("  waiting for approval...\n")
		approval := WaitForToolApproval(toolCall.ID)
		log.Printf("  approval result: %q\n", approval)
		if approval != "" {
			toolCall.ToolUseData.Approval = approval
		}

		if !toolCall.ToolUseData.IsApproved() {
			errorMsg := "Tool use denied or timed out"
			if approval == uctypes.ApprovalUserDenied {
				errorMsg = "Tool use denied by user"
			} else if approval == uctypes.ApprovalTimeout {
				errorMsg = "Tool approval timed out"
			}
			toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
			toolCall.ToolUseData.ErrorMessage = errorMsg
			return uctypes.AIToolResult{
				ToolName:  toolCall.Name,
				ToolUseID: toolCall.ID,
				ErrorText: errorMsg,
			}
		}

		// this still happens here because we need to update the FE to say the tool call was approved
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, toolCall.ToolUseData)
	}

	toolCall.ToolUseData.RunTs = time.Now().UnixMilli()
	result := ResolveToolCall(toolDef, toolCall, chatOpts)

	if result.ErrorText != "" {
		toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
		toolCall.ToolUseData.ErrorMessage = result.ErrorText
	} else {
		toolCall.ToolUseData.Status = uctypes.ToolUseStatusCompleted
	}

	return result
}

func processToolCall(backend UseChatBackend, toolCall uctypes.WaveToolCall, chatOpts uctypes.WaveChatOpts, sseHandler *sse.SSEHandlerCh, metrics *uctypes.AIMetrics) uctypes.AIToolResult {
	inputJSON, _ := json.Marshal(toolCall.Input)
	logutil.DevPrintf("TOOLUSE name=%s id=%s input=%s approval=%q\n", toolCall.Name, toolCall.ID, utilfn.TruncateString(string(inputJSON), 40), toolCall.ToolUseData.Approval)

	toolDef := chatOpts.GetToolDefinition(toolCall.Name)
	result := processToolCallInternal(backend, toolCall, chatOpts, toolDef, sseHandler)

	if result.ErrorText != "" {
		log.Printf("  error=%s\n", result.ErrorText)
		metrics.ToolUseErrorCount++
	} else {
		log.Printf("  result=%s\n", utilfn.TruncateString(result.Text, 40))
	}

	if toolDef != nil && toolDef.ToolLogName != "" {
		metrics.ToolDetail[toolDef.ToolLogName]++
	}

	if toolCall.ToolUseData != nil {
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, toolCall.ToolUseData)
	}

	return result
}

func processToolCalls(backend UseChatBackend, stopReason *uctypes.WaveStopReason, chatOpts uctypes.WaveChatOpts, sseHandler *sse.SSEHandlerCh, metrics *uctypes.AIMetrics) {
	for _, toolCall := range stopReason.ToolCalls {
		activeToolMap.Set(toolCall.ID, true)
		defer activeToolMap.Delete(toolCall.ID)
	}

	// Send all data-tooluse packets at the beginning
	for _, toolCall := range stopReason.ToolCalls {
		if toolCall.ToolUseData != nil {
			log.Printf("AI data-tooluse %s\n", toolCall.ID)
			_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
			updateToolUseDataInChat(backend, chatOpts, toolCall.ID, toolCall.ToolUseData)
			if toolCall.ToolUseData.Approval == uctypes.ApprovalNeedsApproval && chatOpts.RegisterToolApproval != nil {
				chatOpts.RegisterToolApproval(toolCall.ID)
			}
		}
	}

	var toolResults []uctypes.AIToolResult
	for _, toolCall := range stopReason.ToolCalls {
		result := processToolCall(backend, toolCall, chatOpts, sseHandler, metrics)
		toolResults = append(toolResults, result)
	}

	toolResultMsgs, err := backend.ConvertToolResultsToNativeChatMessage(toolResults)
	if err != nil {
		log.Printf("Failed to convert tool results to native chat messages: %v", err)
	} else {
		for _, msg := range toolResultMsgs {
			chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, msg)
		}
	}
}

func RunAIChat(ctx context.Context, sseHandler *sse.SSEHandlerCh, backend UseChatBackend, chatOpts uctypes.WaveChatOpts) (*uctypes.AIMetrics, error) {
	if !activeChats.SetUnless(chatOpts.ChatId, true) {
		return nil, fmt.Errorf("chat %s is already running", chatOpts.ChatId)
	}
	defer activeChats.Delete(chatOpts.ChatId)

	stepNum := chatstore.DefaultChatStore.CountUserMessages(chatOpts.ChatId)
	metrics := &uctypes.AIMetrics{
		ChatId:   chatOpts.ChatId,
		StepNum:  stepNum,
		Usage: uctypes.AIUsage{
			APIType: chatOpts.Config.APIType,
			Model:   chatOpts.Config.Model,
		},
		WidgetAccess:  chatOpts.WidgetAccess,
		ToolDetail:    make(map[string]int),
		ThinkingLevel: chatOpts.Config.ThinkingLevel,
		ThinkingMode:  chatOpts.Config.ThinkingMode,
	}
	firstStep := true
	var cont *uctypes.WaveContinueResponse
	for {
		if chatOpts.TabStateGenerator != nil {
			tabState, tabTools, tabId, tabErr := chatOpts.TabStateGenerator()
			if tabErr == nil {
				chatOpts.TabState = tabState
				chatOpts.TabTools = tabTools
				chatOpts.TabId = tabId
			}
		}
		if chatOpts.BuilderAppGenerator != nil {
			appGoFile, appStaticFiles, platformInfo, appErr := chatOpts.BuilderAppGenerator()
			if appErr == nil {
				chatOpts.AppGoFile = appGoFile
				chatOpts.AppStaticFiles = appStaticFiles
				chatOpts.PlatformInfo = platformInfo
			}
		}
		stopReason, rtnMessage, err := runAIChatStep(ctx, sseHandler, backend, chatOpts, cont)
		metrics.RequestCount++
		if chatOpts.Config.IsPremiumModel() {
			metrics.PremiumReqCount++
		}
		if chatOpts.Config.IsWaveProxy() {
			metrics.ProxyReqCount++
		}
		if len(rtnMessage) > 0 {
			usage := getUsage(rtnMessage)
			log.Printf("usage: input=%d output=%d websearch=%d\n", usage.InputTokens, usage.OutputTokens, usage.NativeWebSearchCount)
			metrics.Usage.InputTokens += usage.InputTokens
			metrics.Usage.OutputTokens += usage.OutputTokens
			metrics.Usage.NativeWebSearchCount += usage.NativeWebSearchCount
			if usage.Model != "" && metrics.Usage.Model != usage.Model {
				metrics.Usage.Model = "mixed"
			}
		}
		if firstStep && err != nil {
			metrics.HadError = true
			return metrics, fmt.Errorf("failed to stream %s chat: %w", chatOpts.Config.APIType, err)
		}
		if err != nil {
			metrics.HadError = true
			_ = sseHandler.AiMsgError(err.Error())
			_ = sseHandler.AiMsgFinish("", nil)
			break
		}
		for _, msg := range rtnMessage {
			if msg != nil {
				chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, msg)
			}
		}
		firstStep = false
		if stopReason != nil && stopReason.Kind == uctypes.StopKindPremiumRateLimit && chatOpts.Config.APIType == APIType_OpenAI && chatOpts.Config.Model == uctypes.PremiumOpenAIModel {
			log.Printf("Premium rate limit hit with gpt-5.1, switching to gpt-5-mini\n")
			cont = &uctypes.WaveContinueResponse{
				Model:            uctypes.DefaultOpenAIModel,
				ContinueFromKind: uctypes.StopKindPremiumRateLimit,
			}
			continue
		}
		if stopReason != nil && stopReason.Kind == uctypes.StopKindToolUse {
			metrics.ToolUseCount += len(stopReason.ToolCalls)
			processToolCalls(backend, stopReason, chatOpts, sseHandler, metrics)
			cont = &uctypes.WaveContinueResponse{
				Model:            chatOpts.Config.Model,
				ContinueFromKind: uctypes.StopKindToolUse,
			}
			continue
		}
		break
	}
	return metrics, nil
}

func ResolveToolCall(toolDef *uctypes.ToolDefinition, toolCall uctypes.WaveToolCall, chatOpts uctypes.WaveChatOpts) (result uctypes.AIToolResult) {
	result = uctypes.AIToolResult{
		ToolName:  toolCall.Name,
		ToolUseID: toolCall.ID,
	}

	defer func() {
		if r := recover(); r != nil {
			result.ErrorText = fmt.Sprintf("panic in tool execution: %v", r)
			result.Text = ""
		}
	}()

	if toolDef == nil {
		result.ErrorText = fmt.Sprintf("tool '%s' not found", toolCall.Name)
		return
	}

	// Try ToolTextCallback first, then ToolAnyCallback
	if toolDef.ToolTextCallback != nil {
		text, err := toolDef.ToolTextCallback(toolCall.Input)
		if err != nil {
			result.ErrorText = err.Error()
		} else {
			result.Text = text
			// Recompute tool description with the result
			if toolDef.ToolCallDesc != nil && toolCall.ToolUseData != nil {
				toolCall.ToolUseData.ToolDesc = toolDef.ToolCallDesc(toolCall.Input, text, toolCall.ToolUseData)
			}
		}
	} else if toolDef.ToolAnyCallback != nil {
		output, err := toolDef.ToolAnyCallback(toolCall.Input, toolCall.ToolUseData)
		if err != nil {
			result.ErrorText = err.Error()
		} else {
			// Marshal the result to JSON
			jsonBytes, marshalErr := json.Marshal(output)
			if marshalErr != nil {
				result.ErrorText = fmt.Sprintf("failed to marshal tool output: %v", marshalErr)
			} else {
				result.Text = string(jsonBytes)
				// Recompute tool description with the result
				if toolDef.ToolCallDesc != nil && toolCall.ToolUseData != nil {
					toolCall.ToolUseData.ToolDesc = toolDef.ToolCallDesc(toolCall.Input, output, toolCall.ToolUseData)
				}
			}
		}
	} else {
		result.ErrorText = fmt.Sprintf("tool '%s' has no callback functions", toolCall.Name)
	}

	return
}

func WaveAIPostMessageWrap(ctx context.Context, sseHandler *sse.SSEHandlerCh, message *uctypes.AIMessage, chatOpts uctypes.WaveChatOpts) error {
	startTime := time.Now()

	// Convert AIMessage to native chat message using backend
	backend, err := GetBackendByAPIType(chatOpts.Config.APIType)
	if err != nil {
		return err
	}
	convertedMessage, err := backend.ConvertAIMessageToNativeChatMessage(*message)
	if err != nil {
		return fmt.Errorf("message conversion failed: %w", err)
	}

	// Post message to chat store
	if err := chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, convertedMessage); err != nil {
		return fmt.Errorf("failed to store message: %w", err)
	}

	metrics, err := RunAIChat(ctx, sseHandler, backend, chatOpts)
	if metrics != nil {
		metrics.RequestDuration = int(time.Since(startTime).Milliseconds())
		for _, part := range message.Parts {
			if part.Type == uctypes.AIMessagePartTypeText {
				metrics.TextLen += len(part.Text)
			} else if part.Type == uctypes.AIMessagePartTypeFile {
				mimeType := strings.ToLower(part.MimeType)
				if strings.HasPrefix(mimeType, "image/") {
					metrics.ImageCount++
				} else if mimeType == "application/pdf" {
					metrics.PDFCount++
				} else {
					metrics.TextDocCount++
				}
			}
		}
		log.Printf("WaveAI call metrics: requests=%d tools=%d premium=%d proxy=%d images=%d pdfs=%d textdocs=%d textlen=%d duration=%dms error=%v\n",
			metrics.RequestCount, metrics.ToolUseCount, metrics.PremiumReqCount, metrics.ProxyReqCount,
			metrics.ImageCount, metrics.PDFCount, metrics.TextDocCount, metrics.TextLen, metrics.RequestDuration, metrics.HadError)

		sendAIMetricsTelemetry(ctx, metrics)
	}
	return err
}

func sendAIMetricsTelemetry(ctx context.Context, metrics *uctypes.AIMetrics) {
	event := telemetrydata.MakeTEvent("waveai:post", telemetrydata.TEventProps{
		WaveAIAPIType:              metrics.Usage.APIType,
		WaveAIModel:                metrics.Usage.Model,
		WaveAIChatId:               metrics.ChatId,
		WaveAIStepNum:              metrics.StepNum,
		WaveAIInputTokens:          metrics.Usage.InputTokens,
		WaveAIOutputTokens:         metrics.Usage.OutputTokens,
		WaveAINativeWebSearchCount: metrics.Usage.NativeWebSearchCount,
		WaveAIRequestCount:         metrics.RequestCount,
		WaveAIToolUseCount:         metrics.ToolUseCount,
		WaveAIToolUseErrorCount:    metrics.ToolUseErrorCount,
		WaveAIToolDetail:           metrics.ToolDetail,
		WaveAIPremiumReq:           metrics.PremiumReqCount,
		WaveAIProxyReq:             metrics.ProxyReqCount,
		WaveAIHadError:             metrics.HadError,
		WaveAIImageCount:           metrics.ImageCount,
		WaveAIPDFCount:             metrics.PDFCount,
		WaveAITextDocCount:         metrics.TextDocCount,
		WaveAITextLen:              metrics.TextLen,
		WaveAIFirstByteMs:          metrics.FirstByteLatency,
		WaveAIRequestDurMs:         metrics.RequestDuration,
		WaveAIWidgetAccess:         metrics.WidgetAccess,
		WaveAIThinkingLevel:        metrics.ThinkingLevel,
		WaveAIThinkingMode:         metrics.ThinkingMode,
	})
	_ = telemetry.RecordTEvent(ctx, event)
}

// PostMessageRequest represents the request body for posting a message
type PostMessageRequest struct {
	TabId        string            `json:"tabid,omitempty"`
	BuilderId    string            `json:"builderid,omitempty"`
	BuilderAppId string            `json:"builderappid,omitempty"`
	ChatID       string            `json:"chatid"`
	Msg          uctypes.AIMessage `json:"msg"`
	WidgetAccess bool              `json:"widgetaccess,omitempty"`
}

func WaveAIPostMessageHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow POST method
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req PostMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate chatid is present and is a UUID
	if req.ChatID == "" {
		http.Error(w, "chatid is required in request body", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(req.ChatID); err != nil {
		http.Error(w, "chatid must be a valid UUID", http.StatusBadRequest)
		return
	}

	// Get RTInfo from TabId or BuilderId
	var rtInfo *waveobj.ObjRTInfo
	if req.TabId != "" {
		oref := waveobj.MakeORef(waveobj.OType_Tab, req.TabId)
		rtInfo = wstore.GetRTInfo(oref)
	} else if req.BuilderId != "" {
		oref := waveobj.MakeORef(waveobj.OType_Builder, req.BuilderId)
		rtInfo = wstore.GetRTInfo(oref)
	}

	// Get WaveAI settings
	premium := shouldUsePremium()
	builderMode := req.BuilderId != ""
	aiOpts, err := getWaveAISettings(premium, builderMode, rtInfo)
	if err != nil {
		http.Error(w, fmt.Sprintf("WaveAI configuration error: %v", err), http.StatusInternalServerError)
		return
	}

	// Get client ID from database
	client, err := wstore.DBGetSingleton[*waveobj.Client](r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get client: %v", err), http.StatusInternalServerError)
		return
	}

	// Call the core WaveAIPostMessage function
	chatOpts := uctypes.WaveChatOpts{
		ChatId:               req.ChatID,
		ClientId:             client.OID,
		Config:               *aiOpts,
		WidgetAccess:         req.WidgetAccess,
		RegisterToolApproval: RegisterToolApproval,
		AllowNativeWebSearch: true,
		BuilderId:            req.BuilderId,
		BuilderAppId:         req.BuilderAppId,
	}
	if chatOpts.Config.APIType == APIType_OpenAI {
		if chatOpts.BuilderId != "" {
			chatOpts.SystemPrompt = []string{}
		} else {
			chatOpts.SystemPrompt = []string{SystemPromptText_OpenAI}
		}
	} else {
		chatOpts.SystemPrompt = []string{SystemPromptText}
	}

	if req.TabId != "" {
		chatOpts.TabStateGenerator = func() (string, []uctypes.ToolDefinition, string, error) {
			tabState, tabTools, err := GenerateTabStateAndTools(r.Context(), req.TabId, req.WidgetAccess)
			return tabState, tabTools, req.TabId, err
		}
	}

	if req.BuilderAppId != "" {
		chatOpts.BuilderAppGenerator = func() (string, string, string, error) {
			return generateBuilderAppData(req.BuilderAppId)
		}
	}

	if req.BuilderAppId != "" {
		chatOpts.Tools = append(chatOpts.Tools,
			GetBuilderWriteAppFileToolDefinition(req.BuilderAppId, req.BuilderId),
			GetBuilderEditAppFileToolDefinition(req.BuilderAppId, req.BuilderId),
			GetBuilderListFilesToolDefinition(req.BuilderAppId),
		)
	}

	// Validate the message
	if err := req.Msg.Validate(); err != nil {
		http.Error(w, fmt.Sprintf("Message validation failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Create SSE handler and set up streaming
	sseHandler := sse.MakeSSEHandlerCh(w, r.Context())
	defer sseHandler.Close()

	if err := WaveAIPostMessageWrap(r.Context(), sseHandler, &req.Msg, chatOpts); err != nil {
		http.Error(w, fmt.Sprintf("Failed to post message: %v", err), http.StatusInternalServerError)
		return
	}
}

func WaveAIGetChatHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow GET method
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get chatid from URL parameters
	chatID := r.URL.Query().Get("chatid")
	if chatID == "" {
		http.Error(w, "chatid parameter is required", http.StatusBadRequest)
		return
	}

	// Validate chatid is a UUID
	if _, err := uuid.Parse(chatID); err != nil {
		http.Error(w, "chatid must be a valid UUID", http.StatusBadRequest)
		return
	}

	// Get chat from store
	chat := chatstore.DefaultChatStore.Get(chatID)
	if chat == nil {
		http.Error(w, "chat not found", http.StatusNotFound)
		return
	}

	// Set response headers for JSON
	w.Header().Set("Content-Type", "application/json")

	// Encode and return the chat
	if err := json.NewEncoder(w).Encode(chat); err != nil {
		http.Error(w, fmt.Sprintf("Failed to encode response: %v", err), http.StatusInternalServerError)
		return
	}
}

// CreateWriteTextFileDiff generates a diff for write_text_file or edit_text_file tool calls.
// Returns the original content, modified content, and any error.
// For Anthropic, this returns an unimplemented error.
func CreateWriteTextFileDiff(ctx context.Context, chatId string, toolCallId string) ([]byte, []byte, error) {
	aiChat := chatstore.DefaultChatStore.Get(chatId)
	if aiChat == nil {
		return nil, nil, fmt.Errorf("chat not found: %s", chatId)
	}

	backend, err := GetBackendByAPIType(aiChat.APIType)
	if err != nil {
		return nil, nil, err
	}

	funcCallInput := backend.GetFunctionCallInputByToolCallId(*aiChat, toolCallId)
	if funcCallInput == nil {
		return nil, nil, fmt.Errorf("tool call not found: %s", toolCallId)
	}

	toolName := funcCallInput.Name
	if toolName != "write_text_file" && toolName != "edit_text_file" {
		return nil, nil, fmt.Errorf("tool call %s is not a write_text_file or edit_text_file (got: %s)", toolCallId, toolName)
	}

	var backupFileName string
	if funcCallInput.ToolUseData != nil {
		backupFileName = funcCallInput.ToolUseData.WriteBackupFileName
	}

	var parsedArguments any
	if err := json.Unmarshal([]byte(funcCallInput.Arguments), &parsedArguments); err != nil {
		return nil, nil, fmt.Errorf("failed to unmarshal arguments: %w", err)
	}

	if toolName == "edit_text_file" {
		originalContent, modifiedContent, err := EditTextFileDryRun(parsedArguments, backupFileName)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to generate diff: %w", err)
		}
		return originalContent, modifiedContent, nil
	}

	params, err := parseWriteTextFileInput(parsedArguments)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse write_text_file input: %w", err)
	}

	var originalContent []byte
	if backupFileName != "" {
		originalContent, err = os.ReadFile(backupFileName)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to read backup file: %w", err)
		}
	} else {
		expandedPath, err := wavebase.ExpandHomeDir(params.Filename)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to expand path: %w", err)
		}
		originalContent, err = os.ReadFile(expandedPath)
		if err != nil && !os.IsNotExist(err) {
			return nil, nil, fmt.Errorf("failed to read original file: %w", err)
		}
	}

	modifiedContent := []byte(params.Contents)
	return originalContent, modifiedContent, nil
}

type StaticFileInfo struct {
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	Modified     string `json:"modified"`
	ModifiedTime string `json:"modified_time"`
}

func generateBuilderAppData(appId string) (string, string, string, error) {
	appGoFile := ""
	fileData, err := waveappstore.ReadAppFile(appId, "app.go")
	if err == nil {
		appGoFile = string(fileData.Contents)
	}

	staticFilesJSON := ""
	allFiles, err := waveappstore.ListAllAppFiles(appId)
	if err == nil {
		var staticFiles []StaticFileInfo
		for _, entry := range allFiles.Entries {
			if strings.HasPrefix(entry.Name, "static/") {
				staticFiles = append(staticFiles, StaticFileInfo{
					Name:         entry.Name,
					Size:         entry.Size,
					Modified:     entry.Modified,
					ModifiedTime: entry.ModifiedTime,
				})
			}
		}

		if len(staticFiles) > 0 {
			staticFilesBytes, marshalErr := json.Marshal(staticFiles)
			if marshalErr == nil {
				staticFilesJSON = string(staticFilesBytes)
			}
		}
	}

	platformInfo := wavebase.GetSystemSummary()
	if currentUser, userErr := user.Current(); userErr == nil && currentUser.Username != "" {
		platformInfo = fmt.Sprintf("Local Machine: %s, User: %s", platformInfo, currentUser.Username)
	} else {
		platformInfo = fmt.Sprintf("Local Machine: %s", platformInfo)
	}

	return appGoFile, staticFilesJSON, platformInfo, nil
}
