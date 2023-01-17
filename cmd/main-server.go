package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/scripthaus-dev/sh2-server/pkg/cmdrunner"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
	"github.com/scripthaus-dev/sh2-server/pkg/scpacket"
	"github.com/scripthaus-dev/sh2-server/pkg/scws"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
	"github.com/scripthaus-dev/sh2-server/pkg/wsshell"
)

type WebFnType = func(http.ResponseWriter, *http.Request)

const HttpReadTimeout = 5 * time.Second
const HttpWriteTimeout = 21 * time.Second
const HttpMaxHeaderBytes = 60000
const HttpTimeoutDuration = 21 * time.Second

const MainServerAddr = "localhost:8080"
const WebSocketServerAddr = "localhost:8081"
const MainServerDevAddr = "localhost:8090"
const WebSocketServerDevAddr = "localhost:8091"
const WSStateReconnectTime = 30 * time.Second
const WSStatePacketChSize = 20

var GlobalLock = &sync.Mutex{}
var WSStateMap = make(map[string]*scws.WSState) // clientid -> WsState
var GlobalAuthKey string

type ClientActiveState struct {
	Fg     bool `json:"fg"`
	Active bool `json:"active"`
	Open   bool `json:"open"`
}

func setWSState(state *scws.WSState) {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	WSStateMap[state.ClientId] = state
}

func getWSState(clientId string) *scws.WSState {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	return WSStateMap[clientId]
}

func removeWSStateAfterTimeout(clientId string, connectTime time.Time, waitDuration time.Duration) {
	go func() {
		time.Sleep(waitDuration)
		GlobalLock.Lock()
		defer GlobalLock.Unlock()
		state := WSStateMap[clientId]
		if state == nil || state.ConnectTime != connectTime {
			return
		}
		delete(WSStateMap, clientId)
		state.UnWatchScreen()
	}()
}

func HandleWs(w http.ResponseWriter, r *http.Request) {
	shell, err := wsshell.StartWS(w, r)
	if err != nil {
		log.Printf("WebSocket Upgrade Failed %T: %v\n", w, err)
		return
	}
	defer shell.Conn.Close()
	clientId := r.URL.Query().Get("clientid")
	if clientId == "" {
		close(shell.WriteChan)
		return
	}
	state := getWSState(clientId)
	if state == nil {
		state = scws.MakeWSState(clientId, GlobalAuthKey)
		state.ReplaceShell(shell)
		setWSState(state)
	} else {
		state.UpdateConnectTime()
		state.ReplaceShell(shell)
	}
	stateConnectTime := state.GetConnectTime()
	defer func() {
		removeWSStateAfterTimeout(clientId, stateConnectTime, WSStateReconnectTime)
	}()
	log.Printf("WebSocket opened %s %s\n", state.ClientId, shell.RemoteAddr)
	state.RunWSRead()
}

// todo: sync multiple writes to the same fifoName into a single go-routine and do liveness checking on fifo
// if this returns an error, likely the fifo is dead and the cmd should be marked as 'done'
func writeToFifo(fifoName string, data []byte) error {
	rwfd, err := os.OpenFile(fifoName, os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer rwfd.Close()
	fifoWriter, err := os.OpenFile(fifoName, os.O_WRONLY, 0600) // blocking open (open won't block because of rwfd)
	if err != nil {
		return err
	}
	defer fifoWriter.Close()
	// this *could* block if the fifo buffer is full
	// unlikely because if the reader is dead, and len(data) < pipe size, then the buffer will be empty and will clear after rwfd is closed
	_, err = fifoWriter.Write(data)
	if err != nil {
		return err
	}
	return nil
}

func HandleGetClientData(w http.ResponseWriter, r *http.Request) {
	cdata, err := sstore.EnsureClientData(r.Context())
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, cdata)
	return
}

func HandleSetWinSize(w http.ResponseWriter, r *http.Request) {
	decoder := json.NewDecoder(r.Body)
	var winSize sstore.ClientWinSizeType
	err := decoder.Decode(&winSize)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error decoding json: %w", err))
		return
	}
	err = sstore.SetWinSize(r.Context(), winSize)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error setting winsize: %w", err))
		return
	}
	WriteJsonSuccess(w, true)
	return
}

// params: fg, active, open
func HandleLogActiveState(w http.ResponseWriter, r *http.Request) {
	decoder := json.NewDecoder(r.Body)
	var activeState ClientActiveState
	err := decoder.Decode(&activeState)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error decoding json: %w", err))
		return
	}
	activity := sstore.ActivityUpdate{}
	if activeState.Fg {
		activity.FgMinutes = 1
	}
	if activeState.Active {
		activity.ActiveMinutes = 1
	}
	if activeState.Open {
		activity.OpenMinutes = 1
	}
	err = sstore.UpdateCurrentActivity(r.Context(), activity)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error updating activity: %w", err))
		return
	}
	WriteJsonSuccess(w, true)
	return
}

// params: sessionid, windowid
func HandleGetWindow(w http.ResponseWriter, r *http.Request) {
	qvals := r.URL.Query()
	sessionId := qvals.Get("sessionid")
	windowId := qvals.Get("windowid")
	if _, err := uuid.Parse(sessionId); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid sessionid: %w", err))
		return
	}
	if _, err := uuid.Parse(windowId); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid windowid: %w", err))
		return
	}
	window, err := sstore.GetWindowById(r.Context(), sessionId, windowId)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, window)
	return
}

func HandleRtnState(w http.ResponseWriter, r *http.Request) {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[error] in handlertnstate: %v\n", r)
		debug.PrintStack()
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("panic: %v", r)))
		return
	}()
	qvals := r.URL.Query()
	sessionId := qvals.Get("sessionid")
	cmdId := qvals.Get("cmdid")
	if sessionId == "" || cmdId == "" {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("must specify sessionid and cmdid")))
		return
	}
	if _, err := uuid.Parse(sessionId); err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("invalid sessionid: %v", err)))
		return
	}
	if _, err := uuid.Parse(cmdId); err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("invalid cmdid: %v", err)))
		return
	}
	data, err := cmdrunner.GetRtnStateDiff(r.Context(), sessionId, cmdId)
	if err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("cannot get rtnstate diff: %v", err)))
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write(data)
	return
}

func HandleRemotePty(w http.ResponseWriter, r *http.Request) {
	qvals := r.URL.Query()
	remoteId := qvals.Get("remoteid")
	if remoteId == "" {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("must specify remoteid")))
		return
	}
	if _, err := uuid.Parse(remoteId); err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("invalid remoteid: %v", err)))
		return
	}
	realOffset, data, err := remote.ReadRemotePty(r.Context(), remoteId)
	if err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("error reading ptyout file: %v", err)))
		return
	}
	w.Header().Set("X-PtyDataOffset", strconv.FormatInt(realOffset, 10))
	w.WriteHeader(http.StatusOK)
	w.Write(data)
	return
}

func HandleGetPtyOut(w http.ResponseWriter, r *http.Request) {
	qvals := r.URL.Query()
	sessionId := qvals.Get("sessionid")
	cmdId := qvals.Get("cmdid")
	if sessionId == "" || cmdId == "" {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("must specify sessionid and cmdid")))
		return
	}
	if _, err := uuid.Parse(sessionId); err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("invalid sessionid: %v", err)))
		return
	}
	if _, err := uuid.Parse(cmdId); err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("invalid cmdid: %v", err)))
		return
	}
	realOffset, data, err := sstore.ReadFullPtyOutFile(r.Context(), sessionId, cmdId)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("error reading ptyout file: %v", err)))
		return
	}
	w.Header().Set("X-PtyDataOffset", strconv.FormatInt(realOffset, 10))
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

func WriteJsonError(w http.ResponseWriter, errVal error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	errMap := make(map[string]interface{})
	errMap["error"] = errVal.Error()
	barr, _ := json.Marshal(errMap)
	w.Write(barr)
	return
}

func WriteJsonSuccess(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	rtnMap := make(map[string]interface{})
	rtnMap["success"] = true
	if data != nil {
		rtnMap["data"] = data
	}
	barr, err := json.Marshal(rtnMap)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	w.WriteHeader(200)
	w.Write(barr)
	return
}

func HandleRunCommand(w http.ResponseWriter, r *http.Request) {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[error] in run-command: %v\n", r)
		debug.PrintStack()
		WriteJsonError(w, fmt.Errorf("panic: %v", r))
		return
	}()
	w.Header().Set("Cache-Control", "no-cache")
	decoder := json.NewDecoder(r.Body)
	var commandPk scpacket.FeCommandPacketType
	err := decoder.Decode(&commandPk)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error decoding json: %w", err))
		return
	}
	update, err := cmdrunner.HandleCommand(r.Context(), &commandPk)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, update)
	return
}

func AuthKeyWrap(fn WebFnType) WebFnType {
	return func(w http.ResponseWriter, r *http.Request) {
		reqAuthKey := r.Header.Get("X-AuthKey")
		if reqAuthKey == "" {
			w.WriteHeader(500)
			w.Write([]byte("no x-authkey header"))
			return
		}
		if reqAuthKey != GlobalAuthKey {
			w.WriteHeader(500)
			w.Write([]byte("x-authkey header is invalid"))
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		fn(w, r)
	}
}

func runWebSocketServer() {
	gr := mux.NewRouter()
	gr.HandleFunc("/ws", HandleWs)
	serverAddr := WebSocketServerAddr
	if scbase.IsDevMode() {
		serverAddr = WebSocketServerDevAddr
	}
	server := &http.Server{
		Addr:           serverAddr,
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        gr,
	}
	server.SetKeepAlivesEnabled(false)
	log.Printf("Running websocket server on %s\n", serverAddr)
	err := server.ListenAndServe()
	if err != nil {
		log.Printf("[error] trying to run websocket server: %v\n", err)
	}
}

func test() error {
	return nil
}

// watch stdin, kill server if stdin is closed
func stdinReadWatch() {
	buf := make([]byte, 1024)
	for {
		_, err := os.Stdin.Read(buf)
		if err != nil {
			log.Printf("stdin closed/error, shutting down: %v\n", err)
			time.Sleep(1 * time.Second)
			syscall.Kill(syscall.Getpid(), syscall.SIGINT)
		}
	}
}

func main() {
	if len(os.Args) >= 2 && os.Args[1] == "--test" {
		log.Printf("running test fn\n")
		err := test()
		if err != nil {
			log.Printf("[error] %v\n", err)
		}
		return
	}

	scHomeDir := scbase.GetPromptHomeDir()
	log.Printf("[prompt] homedir = %q\n", scHomeDir)

	scLock, err := scbase.AcquirePromptLock()
	if err != nil || scLock == nil {
		log.Printf("[error] cannot acquire prompt lock: %v\n", err)
		return
	}
	if len(os.Args) >= 2 && strings.HasPrefix(os.Args[1], "--migrate") {
		err := sstore.MigrateCommandOpts(os.Args[1:])
		if err != nil {
			log.Printf("[error] migrate cmd: %v\n", err)
		}
		return
	}
	authKey, err := scbase.ReadPromptAuthKey()
	if err != nil {
		log.Printf("[error] %v\n", err)
		return
	}
	GlobalAuthKey = authKey
	err = sstore.TryMigrateUp()
	if err != nil {
		log.Printf("[error] migrate up: %v\n", err)
		return
	}
	clientData, err := sstore.EnsureClientData(context.Background())
	if err != nil {
		log.Printf("[error] ensuring client data: %v\n", err)
		return
	}
	log.Printf("userid = %s\n", clientData.UserId)
	err = sstore.EnsureLocalRemote(context.Background())
	if err != nil {
		log.Printf("[error] ensuring local remote: %v\n", err)
		return
	}
	_, err = sstore.EnsureDefaultSession(context.Background())
	if err != nil {
		log.Printf("[error] ensuring default session: %v\n", err)
		return
	}
	err = remote.LoadRemotes(context.Background())
	if err != nil {
		log.Printf("[error] loading remotes: %v\n", err)
		return
	}

	err = sstore.HangupAllRunningCmds(context.Background())
	if err != nil {
		log.Printf("[error] calling HUP on all running commands: %v\n", err)
	}
	err = sstore.ReInitFocus(context.Background())
	if err != nil {
		log.Printf("[error] resetting window focus: %v\n", err)
	}

	go stdinReadWatch()
	go runWebSocketServer()
	gr := mux.NewRouter()
	gr.HandleFunc("/api/ptyout", AuthKeyWrap(HandleGetPtyOut))
	gr.HandleFunc("/api/remote-pty", AuthKeyWrap(HandleRemotePty))
	gr.HandleFunc("/api/rtnstate", AuthKeyWrap(HandleRtnState))
	gr.HandleFunc("/api/get-window", AuthKeyWrap(HandleGetWindow))
	gr.HandleFunc("/api/run-command", AuthKeyWrap(HandleRunCommand)).Methods("POST")
	gr.HandleFunc("/api/get-client-data", AuthKeyWrap(HandleGetClientData))
	gr.HandleFunc("/api/set-winsize", AuthKeyWrap(HandleSetWinSize))
	gr.HandleFunc("/api/log-active-state", AuthKeyWrap(HandleLogActiveState))
	serverAddr := MainServerAddr
	if scbase.IsDevMode() {
		serverAddr = MainServerDevAddr
	}
	server := &http.Server{
		Addr:           serverAddr,
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        http.TimeoutHandler(gr, HttpTimeoutDuration, "Timeout"),
	}
	server.SetKeepAlivesEnabled(false)
	log.Printf("Running main server on %s\n", serverAddr)
	err = server.ListenAndServe()
	if err != nil {
		log.Printf("ERROR: %v\n", err)
	}
}
