// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package userinput

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var MainUserInputHandler = UserInputHandler{
	Channels:         make(map[string](chan *UserInputResponse), 1),
	AuthRequestConns: make(map[string]string),
}

var defaultProvider UserInputProvider = &FrontendProvider{}

type UserInputProvider interface {
	GetUserInput(ctx context.Context, request *UserInputRequest) (*UserInputResponse, error)
}

type UserInputRequest struct {
	RequestId     string   `json:"requestid"`
	QueryText     string   `json:"querytext"`
	ResponseType  string   `json:"responsetype"`
	Title         string   `json:"title"`
	Markdown      bool     `json:"markdown"`
	TimeoutMs     int      `json:"timeoutms"`
	CheckBoxMsg   string   `json:"checkboxmsg"`
	PublicText    bool     `json:"publictext"`
	OkLabel       string   `json:"oklabel,omitempty"`
	CancelLabel   string   `json:"cancellabel,omitempty"`
	ConnName      string   `json:"connname,omitempty"`
	PromptType    string   `json:"prompttype,omitempty"`    // "password", "confirm", etc.
	Options       []string `json:"options,omitempty"`       // N-option prompt choices (responsetype == "options")
	DefaultOption string   `json:"defaultoption,omitempty"` // returned on timeout instead of error
	QueuePosition int      `json:"queueposition,omitempty"` // UX-1.6: 1-based position in prompt queue
	QueueTotal    int      `json:"queuetotal,omitempty"`    // UX-1.6: total queued prompts for this window
}

// OnAuthQueueWait is invoked when an SSH auth prompt starts/stops waiting on
// the per-window prompt lock. conncontroller registers this to surface
// "Waiting to sign in…" on blocked connections (UX-1.6). Nil-safe.
var OnAuthQueueWait func(connName string, waiting bool)

// OnPromptShown is invoked once a serialized SSH auth prompt has actually
// acquired the per-window prompt lock (it is now showing, no longer queued).
// conncontroller registers this to re-arm the SSH handshake deadline (UX-1.6
// residual). Nil-safe. promptTimeout is the fresh prompt window so the transport
// deadline stays aligned with the prompt timeout.
var OnPromptShown func(connName string, promptTimeout time.Duration)

type UserInputResponse struct {
	Type         string `json:"type"`
	RequestId    string `json:"requestid"`
	Text         string `json:"text,omitempty"`
	Confirm      bool   `json:"confirm,omitempty"`
	ErrorMsg     string `json:"errormsg,omitempty"`
	CheckboxStat bool   `json:"checkboxstat,omitempty"`
	ConnName     string `json:"connname,omitempty"`
}

type UserInputHandler struct {
	Lock     sync.Mutex
	Channels map[string](chan *UserInputResponse)
	// AuthRequestConns maps requestId → connName for SSH auth prompts so we can
	// cancel every pending password/passphrase/kbd prompt for one connection
	// (A3: one Cancel dismisses all prompts for that conn).
	AuthRequestConns map[string]string
}

// OrphanedPasswords stores user-submitted passwords that arrived after the
// original GetUserInput goroutine timed out. Keyed by connName.
var OrphanedPasswords = make(map[string]string)
var orphanedPasswordsLock sync.Mutex

// windowPromptLocks provides per-window serialization for SSH auth prompts
// (password, keyboard-interactive, passphrase). When visibility-driven
// reconnect fires EnsureConnection for multiple disconnected password
// connections on the same tab, each Connect() may reach its password
// callback concurrently. Without serialization, the frontend would show
// all prompts simultaneously. By acquiring a per-window lock before
// sending the prompt to the frontend, only one prompt is shown at a time;
// the next connection's prompt appears after the first resolves (connect,
// cancel, or timeout).
var windowPromptLocks = make(map[string]*sync.Mutex)
var windowPromptLocksMu sync.Mutex

// windowPromptWaiters tracks how many connNames are queued behind the active
// prompt per window. Keyed by windowId, value is a slice of connNames waiting.
// UX-1.6: used to show "Signing in to host A (1 of N)" queue indicator.
var windowPromptWaiters = make(map[string][]string)
var windowPromptWaitersMu sync.Mutex

func pushWindowPromptWaiter(windowId string, connName string) int {
	windowPromptWaitersMu.Lock()
	defer windowPromptWaitersMu.Unlock()
	windowPromptWaiters[windowId] = append(windowPromptWaiters[windowId], connName)
	return len(windowPromptWaiters[windowId])
}

func popWindowPromptWaiter(windowId string, connName string) {
	windowPromptWaitersMu.Lock()
	defer windowPromptWaitersMu.Unlock()
	waiters := windowPromptWaiters[windowId]
	for i, name := range waiters {
		if name == connName {
			windowPromptWaiters[windowId] = append(waiters[:i], waiters[i+1:]...)
			break
		}
	}
	if len(windowPromptWaiters[windowId]) == 0 {
		delete(windowPromptWaiters, windowId)
	}
}

// queuePosForConn returns 1-based position and total for connName in the window
// waiter list. Returns (0, 0) if not found.
func queuePosForConn(windowId string, connName string) (pos int, total int) {
	windowPromptWaitersMu.Lock()
	defer windowPromptWaitersMu.Unlock()
	waiters := windowPromptWaiters[windowId]
	total = len(waiters)
	for i, name := range waiters {
		if name == connName {
			return i + 1, total
		}
	}
	return 0, total
}

func notifyAuthQueueWait(connName string, waiting bool) {
	if connName == "" || OnAuthQueueWait == nil {
		return
	}
	OnAuthQueueWait(connName, waiting)
}

// acquireWindowPromptLock returns (and lazily creates) the per-window mutex
// for serializing SSH auth prompts. The caller must unlock it.
func acquireWindowPromptLock(windowId string) *sync.Mutex {
	windowPromptLocksMu.Lock()
	defer windowPromptLocksMu.Unlock()
	if lock, ok := windowPromptLocks[windowId]; ok {
		return lock
	}
	lock := &sync.Mutex{}
	windowPromptLocks[windowId] = lock
	return lock
}

// isSSHAuthPrompt returns true if the prompt type is an SSH authentication
// prompt that should be serialized per-window (password, keyboard-interactive,
// or passphrase). Confirm dialogs and other prompt types are not serialized.
func isSSHAuthPrompt(promptType string) bool {
	return promptType == "password" || promptType == "keyboard-interactive" || promptType == "passphrase"
}

type FrontendProvider struct{}

func (ui *UserInputHandler) registerChannel(connName string, isAuthPrompt bool) (string, chan *UserInputResponse) {
	ui.Lock.Lock()
	defer ui.Lock.Unlock()

	id := uuid.New().String()
	uich := make(chan *UserInputResponse, 1)

	ui.Channels[id] = uich
	if isAuthPrompt && connName != "" {
		if ui.AuthRequestConns == nil {
			ui.AuthRequestConns = make(map[string]string)
		}
		ui.AuthRequestConns[id] = connName
	}
	return id, uich
}

func (ui *UserInputHandler) unregisterChannel(id string) {
	ui.Lock.Lock()
	defer ui.Lock.Unlock()

	delete(ui.Channels, id)
	delete(ui.AuthRequestConns, id)
}

// HasActiveAuthPromptForConn reports whether a password/passphrase/kbd prompt
// is currently waiting for the user for this connection. Used to avoid
// soft-canceling a stale "connecting" dial while the user is typing a password.
func HasActiveAuthPromptForConn(connName string) bool {
	if connName == "" {
		return false
	}
	ui := &MainUserInputHandler
	ui.Lock.Lock()
	defer ui.Lock.Unlock()
	for _, cn := range ui.AuthRequestConns {
		if cn == connName {
			return true
		}
	}
	return false
}

// CancelAllAuthPromptsForConn fails every pending SSH auth prompt (password,
// passphrase, keyboard-interactive) for connName with a cancel error so all
// GetUserInput waiters return. Used when the user Cancels one password dialog
// for a connection shared by multiple tabs/blocks.
func CancelAllAuthPromptsForConn(connName string) int {
	if connName == "" {
		return 0
	}
	ui := &MainUserInputHandler
	ui.Lock.Lock()
	var ids []string
	for id, cn := range ui.AuthRequestConns {
		if cn == connName {
			ids = append(ids, id)
		}
	}
	ui.Lock.Unlock()

	canceled := 0
	for _, id := range ids {
		ui.Lock.Lock()
		ch := ui.Channels[id]
		ui.Lock.Unlock()
		if ch == nil {
			continue
		}
		resp := &UserInputResponse{
			Type:      "userinputresp",
			RequestId: id,
			ErrorMsg:  "Canceled by the user",
			ConnName:  connName,
		}
		select {
		case ch <- resp:
			canceled++
		default:
			// already answered or buffer full
		}
	}
	return canceled
}

func (ui *UserInputHandler) sendRequestToFrontend(request *UserInputRequest, scopes []string) {
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_UserInput,
		Data:   request,
		Scopes: scopes,
	})
}

func determineScopes(ctx context.Context) ([]string, error) {
	connData := genconn.GetConnData(ctx)
	if connData == nil {
		return nil, fmt.Errorf("context did not contain connection info")
	}
	// resolve windowId from blockId
	tabId, err := wstore.DBFindTabForBlockId(ctx, connData.BlockId)
	if err != nil {
		return nil, fmt.Errorf("unabled to determine tab for route: %w", err)
	}
	workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("unabled to determine workspace for route: %w", err)
	}
	windowId, err := wstore.DBFindWindowForWorkspaceId(ctx, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("unabled to determine window for route: %w", err)
	}

	return []string{windowId}, nil
}

// findWindowsForConnection finds all windows that contain blocks using the given connection.
// Used as a fallback when determineScopes fails (e.g., during reconnect without BlockId in context).
func findWindowsForConnection(ctx context.Context, connName string) []string {
	blockIds, err := wstore.DBFindBlocksByConnection(ctx, connName)
	if err != nil || len(blockIds) == 0 {
		return nil
	}
	windowSet := make(map[string]bool)
	for _, blockId := range blockIds {
		tabId, err := wstore.DBFindTabForBlockId(ctx, blockId)
		if err != nil {
			continue
		}
		workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
		if err != nil {
			continue
		}
		windowId, err := wstore.DBFindWindowForWorkspaceId(ctx, workspaceId)
		if err != nil {
			continue
		}
		if windowId != "" {
			windowSet[windowId] = true
		}
	}
	windows := make([]string, 0, len(windowSet))
	for w := range windowSet {
		windows = append(windows, w)
	}
	return windows
}

func (p *FrontendProvider) GetUserInput(ctx context.Context, request *UserInputRequest) (*UserInputResponse, error) {
	connData := genconn.GetConnData(ctx)
	if connData != nil && request.ConnName == "" {
		request.ConnName = connData.GetConnName()
	}

	isAuth := isSSHAuthPrompt(request.PromptType)
	id, uiCh := MainUserInputHandler.registerChannel(request.ConnName, isAuth)
	defer MainUserInputHandler.unregisterChannel(id)
	request.RequestId = id
	// TimeoutMs is set after the queue lock is held so the UI countdown reflects
	// the actual prompt wait, not queue wait (UX-1.6).

	log.Printf("[PW-PROMPT] GetUserInput: connName=%q requestId=%q promptType=%q", request.ConnName, request.RequestId, request.PromptType)

	scopes, scopesErr := determineScopes(ctx)
	if scopesErr != nil {
		blocklogger.Infof(ctx, "user input scopes could not be found: %v", scopesErr)
		// Try to find windows by connection name (used during reconnect)
		if request.ConnName != "" {
			scopes = findWindowsForConnection(ctx, request.ConnName)
		}
		if len(scopes) == 0 {
			allWindows, err := wstore.DBGetAllOIDsByType(ctx, "window")
			if err != nil {
				blocklogger.Infof(ctx, "unable to find windows for user input: %v", err)
				return nil, fmt.Errorf("unable to find windows for user input: %v", err)
			}
			scopes = allWindows
		}
	}

	// Serialize SSH auth prompts (password, keyboard-interactive, passphrase)
	// per-window: only one such prompt is shown at a time per window. This
	// prevents multiple disconnected connections on the same tab from prompting
	// simultaneously during visibility-driven reconnect. The user sees one
	// prompt at a time; the next connection's prompt appears after this one
	// resolves (connect, cancel, or timeout).
	//
	// Best-effort: if we couldn't determine a single window (fallback to
	// all-windows), skip serialization — prompts may appear simultaneously,
	// which is the pre-existing behavior. Non-auth prompts (confirm dialogs)
	// are never serialized.
	//
	// UX-1.6: Track queue position so the frontend can show "Signing in to
	// host A (1 of N)" when multiple connections need auth on one window.
	// Queue wait is decoupled from the prompt/handshake timeout: we wait for
	// the lock under the parent ctx only (no short 60s timer), then start a
	// fresh prompt timeout after the lock is held.
	var windowPromptLock *sync.Mutex
	var windowId string
	if isAuth && len(scopes) >= 1 {
		windowId = scopes[0]
		windowPromptLock = acquireWindowPromptLock(windowId)
		pushWindowPromptWaiter(windowId, request.ConnName)

		// Only surface "Waiting to sign in…" when the lock is contended.
		// TryLock success → sole/first prompter; never flash a false wait state.
		if !windowPromptLock.TryLock() {
			notifyAuthQueueWait(request.ConnName, true)
			// Acquire lock without coupling to handshake/prompt deadline. Only
			// abort queue wait on explicit cancel (Stop / AbortConnect), not on
			// parent deadline — that deadline was for dial/prompt, not queue.
			if err := waitForWindowPromptLock(ctx, windowPromptLock); err != nil {
				popWindowPromptWaiter(windowId, request.ConnName)
				notifyAuthQueueWait(request.ConnName, false)
				return nil, err
			}
			// Now holding the lock — no longer "waiting to sign in".
			notifyAuthQueueWait(request.ConnName, false)
		}

		// Fresh position after lock (earlier waiters may have finished).
		pos, total := queuePosForConn(windowId, request.ConnName)
		if pos == 0 {
			// Should not happen; treat as sole active prompt.
			pos, total = 1, 1
		}
		request.QueuePosition = pos
		request.QueueTotal = total
		defer func() {
			windowPromptLock.Unlock()
			popWindowPromptWaiter(windowId, request.ConnName)
		}()
		log.Printf("[PW-PROMPT] acquired window prompt lock for window=%q connName=%q requestId=%q queuePos=%d/%d", windowId, request.ConnName, request.RequestId, pos, total)
	}

	// Prompt timeout starts only after queue lock (or immediately if no queue).
	// Fresh timer — not remaining parent deadline (queue wait may have
	// consumed most of it). Parent cancel still aborts the prompt wait.
	// Non-auth prompts (wsh prompt) may override via request.TimeoutMs.
	promptWait := promptWaitDuration(request.TimeoutMs)

	// UX-1.6 residual: now that we are actually prompting (not queued behind
	// another prompt), re-arm the SSH handshake deadline so the time spent in
	// the queue did not consume this connection's typing budget.
	if isAuth && request.ConnName != "" && OnPromptShown != nil {
		OnPromptShown(request.ConnName, promptWait)
	}

	promptCtx, promptCancel := context.WithTimeout(context.Background(), promptWait)
	defer promptCancel()
	stopPromptWatch := watchContextCanceled(ctx, promptCancel)
	defer stopPromptWatch()
	request.TimeoutMs = int(promptWait.Milliseconds())

	MainUserInputHandler.sendRequestToFrontend(request, scopes)

	var response *UserInputResponse
	var err error
	select {
	case resp := <-uiCh:
		response = resp
	case <-promptCtx.Done():
		// Do NOT use "Canceled by the user" here — that string is reserved for
		// explicit UI Cancel / CancelAllAuthPrompts. Parent/scheduler context
		// cancel must not sticky-suppress auto-reconnect.
		if errors.Is(ctx.Err(), context.Canceled) {
			return nil, fmt.Errorf("input wait canceled: %w", context.Canceled)
		}
		return responseOnPromptTimeout(id, request.DefaultOption)
	}

	if response.ErrorMsg != "" {
		err = errors.New(response.ErrorMsg)
	}

	return response, err
}

// promptWaitDuration is the per-request prompt timer. TimeoutMs > 0 overrides
// the 60s default (used by wsh prompt).
func promptWaitDuration(timeoutMs int) time.Duration {
	if timeoutMs > 0 {
		return time.Duration(timeoutMs) * time.Millisecond
	}
	return 60 * time.Second
}

// responseOnPromptTimeout returns the safe-default response when DefaultOption
// is set; otherwise a timeout error. User cancel is handled separately.
func responseOnPromptTimeout(requestId, defaultOption string) (*UserInputResponse, error) {
	if defaultOption != "" {
		return &UserInputResponse{
			Type:      "userinputresp",
			RequestId: requestId,
			Text:      defaultOption,
		}, nil
	}
	return nil, fmt.Errorf("timed out waiting for user input")
}

// waitForWindowPromptLock blocks until mu is locked or ctx is explicitly
// canceled. Parent deadlines are ignored so multi-conn queue wait does not
// fail with a premature handshake timeout (UX-1.6).
func waitForWindowPromptLock(ctx context.Context, mu *sync.Mutex) error {
	lockAcquired := make(chan struct{})
	go func() {
		mu.Lock()
		close(lockAcquired)
	}()

	// Poll: lock acquired, or parent canceled (ignore deadline).
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-lockAcquired:
			return nil
		case <-ticker.C:
			if errors.Is(ctx.Err(), context.Canceled) {
				go func() {
					<-lockAcquired
					mu.Unlock()
				}()
				return fmt.Errorf("input wait canceled: %w", context.Canceled)
			}
		}
	}
}

// watchContextCanceled calls onCancel when parent is explicitly canceled
// (not on deadline). Returns a stop function.
func watchContextCanceled(ctx context.Context, onCancel context.CancelFunc) func() {
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if errors.Is(ctx.Err(), context.Canceled) {
					onCancel()
					return
				}
				if ctx.Err() != nil {
					// deadline exceeded — ignore for cancel propagation
					// keep watching in case a later cancel is chained
					continue
				}
			}
		}
	}()
	return func() { close(done) }
}

func GetUserInput(ctx context.Context, request *UserInputRequest) (*UserInputResponse, error) {
	return defaultProvider.GetUserInput(ctx, request)
}

func SetUserInputProvider(provider UserInputProvider) {
	defaultProvider = provider
}

// CacheOrphanedPassword stores a password from a user input response that arrived
// after the original GetUserInput goroutine timed out. The conncontroller checks
// this cache in connectInternal before prompting the user.
func CacheOrphanedPassword(connName string, password string) {
	if connName == "" || password == "" {
		return
	}
	orphanedPasswordsLock.Lock()
	defer orphanedPasswordsLock.Unlock()
	OrphanedPasswords[connName] = password
}

// GetOrphanedPassword retrieves and clears a cached orphaned password for connName.
// Returns nil if no orphaned password exists.
func GetOrphanedPassword(connName string) *string {
	orphanedPasswordsLock.Lock()
	defer orphanedPasswordsLock.Unlock()
	pw, ok := OrphanedPasswords[connName]
	if !ok {
		return nil
	}
	delete(OrphanedPasswords, connName)
	return &pw
}
