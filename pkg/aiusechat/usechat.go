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
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/anthropic"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/openai"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/telemetry"
	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/util/ds"
	"github.com/wavetermdev/waveterm/pkg/util/logutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
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
const DefaultAIEndpoint = "https://cfapi.waveterm.dev/api/waveai"
const DefaultMaxTokens = 4 * 1024

//go:embed tsunami/system.md
var tsunamiSystemDoc string

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

	`You cannot yet execute shell commands, run code in the terminal, or directly edit files on disk. You also cannot read remote files.`,
	`If the user asks you to do one of those things, say that these features aren’t available yet AND make sure to say that they are coming soon (stay tuned for updates).`,
	`Instead, show them exactly what command or code they could copy-paste to perform it manually.`,

	// Final reminder
	`You have NO API access to widgets or Wave unless provided via an explicit tool.`,
}, " ")

var BuilderSystemPromptText_OpenAI = strings.Join([]string{
	`# Wave AI - WaveApp Builder`,
	``,
	`You are Wave AI, a specialized AI assistant designed exclusively to help users build Tsunami framework widgets for Wave Terminal.`,
	``,
	`**Core Directives:**`,
	`- ONLY respond to requests related to building Tsunami/wave widgets`,
	`- Follow the Tsunami framework documentation strictly`,
	`- Generate complete, working Go code that compiles and runs in Wave Terminal`,
	`- Politely decline requests to write other types of code, answer general questions, or go off-topic`,
	`- If a user asks something unrelated, respond: "I'm Wave AI, specialized in building wave widgets for Wave Terminal. I can only help with creating WaveApps. What would you like to build?"`,
	``,
	`**Behavior:**`,
	`- Be concise and direct. Prefer determinism over speculation.`,
	`- Never fabricate data, APIs, or framework features. If unsure, say so and reference the documentation.`,
	`- If a brief clarifying question eliminates guesswork, ask it.`,
	``,
	`**Attached Files:**`,
	`- User-attached text files appear inline as <AttachedTextFile_xxxxxxxx file_name="...">\ncontent\n</AttachedTextFile_xxxxxxxx>`,
	`- User-attached directories use <AttachedDirectoryListing_xxxxxxxx directory_name="...">JSON DirInfo</AttachedDirectoryListing_xxxxxxxx>`,
	`- When users refer to attached files, use their inline content directly; do NOT attempt to read them again`,
	``,
	`**Code Output:**`,
	"- Always use fenced Markdown code blocks with language hints.",
	`- Try to keep lines under ~100 characters where practical (soft wrap; correctness takes priority)`,
	`- Use inline code (single backticks) only for short references like package names, method names, or file paths`,
	`- Never comment on or justify formatting choices; just follow these rules`,
	``,
	`**Safety:**`,
	`- If a widget would perform destructive actions (file deletion, system commands, network requests to sensitive endpoints), warn the user and suggest safer alternatives or guard rails`,
	`- Remind users to review generated code before running it in their terminal`,
	``,
	`**Your Workflow:**`,
	`1. Understand what the user wants to build`,
	`2. Reference the Tsunami framework documentation below`,
	`3. Use the file editing tools to modify app.go with your implementation`,
	`4. Compilation/linting results will be returned after each edit`,
	`5. If there are errors, analyze them and use the tools again to fix the issues`,
	`6. Continue iterating until the code compiles cleanly and runs successfully`,
	`7. Verify the widget follows framework conventions and meets the user's requirements`,
	``,
	`-----------`,
	``,
}, "\n")

func getWaveAISettings(premium bool) (*uctypes.AIOptsType, error) {
	baseUrl := DefaultAIEndpoint
	if os.Getenv("WAVETERM_WAVEAI_ENDPOINT") != "" {
		baseUrl = os.Getenv("WAVETERM_WAVEAI_ENDPOINT")
	}
	if DefaultAPI == APIType_Anthropic {
		return &uctypes.AIOptsType{
			APIType:       APIType_Anthropic,
			Model:         uctypes.DefaultAnthropicModel,
			MaxTokens:     DefaultMaxTokens,
			ThinkingLevel: uctypes.ThinkingLevelMedium,
			BaseURL:       baseUrl,
		}, nil
	} else if DefaultAPI == APIType_OpenAI {
		model := uctypes.DefaultOpenAIModel
		thinkingLevel := uctypes.ThinkingLevelLow
		if premium {
			model = uctypes.PremiumOpenAIModel
			thinkingLevel = uctypes.ThinkingLevelMedium
		}
		return &uctypes.AIOptsType{
			APIType:       APIType_OpenAI,
			Model:         model,
			MaxTokens:     DefaultMaxTokens,
			ThinkingLevel: thinkingLevel,
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

func runAIChatStep(ctx context.Context, sseHandler *sse.SSEHandlerCh, chatOpts uctypes.WaveChatOpts, cont *uctypes.WaveContinueResponse) (*uctypes.WaveStopReason, []uctypes.GenAIMessage, error) {
	if chatOpts.Config.APIType == APIType_Anthropic {
		stopReason, msg, rateLimitInfo, err := anthropic.RunAnthropicChatStep(ctx, sseHandler, chatOpts, cont)
		updateRateLimit(rateLimitInfo)
		return stopReason, []uctypes.GenAIMessage{msg}, err
	}
	if chatOpts.Config.APIType == APIType_OpenAI {
		if shouldUseChatCompletionsAPI(chatOpts.Config.Model) {
			return nil, nil, fmt.Errorf("Chat completions API not available (must use newer OpenAI models)")
		}
		stopReason, msgs, rateLimitInfo, err := openai.RunOpenAIChatStep(ctx, sseHandler, chatOpts, cont)
		updateRateLimit(rateLimitInfo)
		var messages []uctypes.GenAIMessage
		for _, msg := range msgs {
			messages = append(messages, msg)
		}
		return stopReason, messages, err
	}
	return nil, nil, fmt.Errorf("Invalid APIType %q", chatOpts.Config.APIType)
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

func updateToolUseDataInChat(chatOpts uctypes.WaveChatOpts, toolCallID string, toolUseData *uctypes.UIMessageDataToolUse) {
	if chatOpts.Config.APIType == APIType_OpenAI {
		if err := openai.UpdateToolUseData(chatOpts.ChatId, toolCallID, toolUseData); err != nil {
			log.Printf("failed to update tool use data in chat: %v\n", err)
		}
	} else if chatOpts.Config.APIType == APIType_Anthropic {
		log.Printf("warning: UpdateToolUseData not implemented for anthropic\n")
	}
}

func processToolCall(toolCall uctypes.WaveToolCall, chatOpts uctypes.WaveChatOpts, sseHandler *sse.SSEHandlerCh, metrics *uctypes.AIMetrics) uctypes.AIToolResult {

	if toolCall.ToolUseData == nil {
		errorMsg := "Invalid Tool Call"
		log.Printf("  error=%s\n", errorMsg)
		metrics.ToolUseErrorCount++
		return uctypes.AIToolResult{
			ToolName:  toolCall.Name,
			ToolUseID: toolCall.ID,
			ErrorText: errorMsg,
		}
	}

	inputJSON, _ := json.Marshal(toolCall.Input)
	logutil.DevPrintf("TOOLUSE name=%s id=%s input=%s approval=%q\n", toolCall.Name, toolCall.ID, utilfn.TruncateString(string(inputJSON), 40), toolCall.ToolUseData.Approval)

	if toolCall.ToolUseData.Status == uctypes.ToolUseStatusError {
		errorMsg := toolCall.ToolUseData.ErrorMessage
		if errorMsg == "" {
			errorMsg = "Unspecified Tool Error"
		}
		log.Printf("  error=%s\n", errorMsg)
		metrics.ToolUseErrorCount++
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(chatOpts, toolCall.ID, toolCall.ToolUseData)

		return uctypes.AIToolResult{
			ToolName:  toolCall.Name,
			ToolUseID: toolCall.ID,
			ErrorText: errorMsg,
		}
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
			log.Printf("  error=%s\n", errorMsg)
			metrics.ToolUseErrorCount++
			toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
			toolCall.ToolUseData.ErrorMessage = errorMsg
			_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
			updateToolUseDataInChat(chatOpts, toolCall.ID, toolCall.ToolUseData)

			return uctypes.AIToolResult{
				ToolName:  toolCall.Name,
				ToolUseID: toolCall.ID,
				ErrorText: errorMsg,
			}
		}

		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(chatOpts, toolCall.ID, toolCall.ToolUseData)
	}

	result := ResolveToolCall(toolCall, chatOpts)

	// Track tool usage by ToolLogName
	toolDef := chatOpts.GetToolDefinition(toolCall.Name)
	if toolDef != nil && toolDef.ToolLogName != "" {
		metrics.ToolDetail[toolDef.ToolLogName]++
	}

	if result.ErrorText != "" {
		toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
		toolCall.ToolUseData.ErrorMessage = result.ErrorText
		log.Printf("  error=%s\n", result.ErrorText)
		metrics.ToolUseErrorCount++
	} else {
		toolCall.ToolUseData.Status = uctypes.ToolUseStatusCompleted
		log.Printf("  result=%s\n", utilfn.TruncateString(result.Text, 40))
	}
	_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
	updateToolUseDataInChat(chatOpts, toolCall.ID, toolCall.ToolUseData)

	return result
}

func processToolCalls(stopReason *uctypes.WaveStopReason, chatOpts uctypes.WaveChatOpts, sseHandler *sse.SSEHandlerCh, metrics *uctypes.AIMetrics) {
	for _, toolCall := range stopReason.ToolCalls {
		activeToolMap.Set(toolCall.ID, true)
		defer activeToolMap.Delete(toolCall.ID)
	}

	// Send all data-tooluse packets at the beginning
	for _, toolCall := range stopReason.ToolCalls {
		if toolCall.ToolUseData != nil {
			log.Printf("AI data-tooluse %s\n", toolCall.ID)
			_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		}
	}

	var toolResults []uctypes.AIToolResult
	for _, toolCall := range stopReason.ToolCalls {
		result := processToolCall(toolCall, chatOpts, sseHandler, metrics)
		toolResults = append(toolResults, result)
	}

	if chatOpts.Config.APIType == APIType_OpenAI {
		toolResultMsgs, err := openai.ConvertToolResultsToOpenAIChatMessage(toolResults)
		if err != nil {
			log.Printf("Failed to convert tool results to OpenAI messages: %v", err)
		} else {
			for _, msg := range toolResultMsgs {
				chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, msg)
			}
		}
	} else {
		toolResultMsg, err := anthropic.ConvertToolResultsToAnthropicChatMessage(toolResults)
		if err != nil {
			log.Printf("Failed to convert tool results to Anthropic message: %v", err)
		} else {
			chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, toolResultMsg)
		}
	}
}

func RunAIChat(ctx context.Context, sseHandler *sse.SSEHandlerCh, chatOpts uctypes.WaveChatOpts) (*uctypes.AIMetrics, error) {
	if !activeChats.SetUnless(chatOpts.ChatId, true) {
		return nil, fmt.Errorf("chat %s is already running", chatOpts.ChatId)
	}
	defer activeChats.Delete(chatOpts.ChatId)

	metrics := &uctypes.AIMetrics{
		Usage: uctypes.AIUsage{
			APIType: chatOpts.Config.APIType,
			Model:   chatOpts.Config.Model,
		},
		WidgetAccess: chatOpts.WidgetAccess,
		ToolDetail:   make(map[string]int),
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
		stopReason, rtnMessage, err := runAIChatStep(ctx, sseHandler, chatOpts, cont)
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
		if stopReason != nil && stopReason.Kind == uctypes.StopKindPremiumRateLimit && chatOpts.Config.APIType == APIType_OpenAI && chatOpts.Config.Model == uctypes.PremiumOpenAIModel {
			log.Printf("Premium rate limit hit with gpt-5, switching to gpt-5-mini\n")
			cont = &uctypes.WaveContinueResponse{
				MessageID:             "",
				Model:                 uctypes.DefaultOpenAIModel,
				ContinueFromKind:      uctypes.StopKindPremiumRateLimit,
				ContinueFromRawReason: stopReason.RawReason,
			}
			firstStep = false
			continue
		}
		if stopReason != nil && stopReason.Kind == uctypes.StopKindToolUse {
			metrics.ToolUseCount += len(stopReason.ToolCalls)
			processToolCalls(stopReason, chatOpts, sseHandler, metrics)

			var messageID string
			if len(rtnMessage) > 0 && rtnMessage[0] != nil {
				messageID = rtnMessage[0].GetMessageId()
			}
			cont = &uctypes.WaveContinueResponse{
				MessageID:             messageID,
				Model:                 chatOpts.Config.Model,
				ContinueFromKind:      uctypes.StopKindToolUse,
				ContinueFromRawReason: stopReason.RawReason,
			}
			continue
		}
		break
	}
	return metrics, nil
}

func ResolveToolCall(toolCall uctypes.WaveToolCall, chatOpts uctypes.WaveChatOpts) (result uctypes.AIToolResult) {
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

	toolDef := chatOpts.GetToolDefinition(toolCall.Name)

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
		}
	} else if toolDef.ToolAnyCallback != nil {
		output, err := toolDef.ToolAnyCallback(toolCall.Input)
		if err != nil {
			result.ErrorText = err.Error()
		} else {
			// Marshal the result to JSON
			jsonBytes, marshalErr := json.Marshal(output)
			if marshalErr != nil {
				result.ErrorText = fmt.Sprintf("failed to marshal tool output: %v", marshalErr)
			} else {
				result.Text = string(jsonBytes)
			}
		}
	} else {
		result.ErrorText = fmt.Sprintf("tool '%s' has no callback functions", toolCall.Name)
	}

	return
}

func WaveAIPostMessageWrap(ctx context.Context, sseHandler *sse.SSEHandlerCh, message *uctypes.AIMessage, chatOpts uctypes.WaveChatOpts) error {
	startTime := time.Now()

	// Convert AIMessage to Anthropic chat message
	var convertedMessage uctypes.GenAIMessage
	if chatOpts.Config.APIType == APIType_Anthropic {
		var err error
		convertedMessage, err = anthropic.ConvertAIMessageToAnthropicChatMessage(*message)
		if err != nil {
			return fmt.Errorf("message conversion failed: %w", err)
		}
	} else if chatOpts.Config.APIType == APIType_OpenAI {
		var err error
		convertedMessage, err = openai.ConvertAIMessageToOpenAIChatMessage(*message)
		if err != nil {
			return fmt.Errorf("message conversion failed: %w", err)
		}
	} else {
		return fmt.Errorf("unsupported APIType %q", chatOpts.Config.APIType)
	}

	// Post message to chat store
	if err := chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, convertedMessage); err != nil {
		return fmt.Errorf("failed to store message: %w", err)
	}

	metrics, err := RunAIChat(ctx, sseHandler, chatOpts)
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
	})
	_ = telemetry.RecordTEvent(ctx, event)
}

// PostMessageRequest represents the request body for posting a message
type PostMessageRequest struct {
	TabId        string            `json:"tabid,omitempty"`
	BuilderId    string            `json:"builderid,omitempty"`
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

	// Get WaveAI settings
	premium := shouldUsePremium()
	aiOpts, err := getWaveAISettings(premium)
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
	}
	if chatOpts.Config.APIType == APIType_OpenAI {
		if chatOpts.BuilderId != "" {
			chatOpts.SystemPrompt = []string{BuilderSystemPromptText_OpenAI + tsunamiSystemDoc}
		} else {
			chatOpts.SystemPrompt = []string{SystemPromptText_OpenAI}
		}
	} else {
		chatOpts.SystemPrompt = []string{SystemPromptText}
	}

	chatOpts.TabStateGenerator = func() (string, []uctypes.ToolDefinition, string, error) {
		tabState, tabTools, err := GenerateTabStateAndTools(r.Context(), req.TabId, req.WidgetAccess)
		return tabState, tabTools, req.TabId, err
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
