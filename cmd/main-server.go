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
	"os/signal"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/commandlinedev/prompt-server/pkg/cmdrunner"
	"github.com/commandlinedev/prompt-server/pkg/pcloud"
	"github.com/commandlinedev/prompt-server/pkg/remote"
	"github.com/commandlinedev/prompt-server/pkg/rtnstate"
	"github.com/commandlinedev/prompt-server/pkg/scbase"
	"github.com/commandlinedev/prompt-server/pkg/scpacket"
	"github.com/commandlinedev/prompt-server/pkg/scws"
	"github.com/commandlinedev/prompt-server/pkg/sstore"
	"github.com/commandlinedev/prompt-server/pkg/wsshell"
)

type WebFnType = func(http.ResponseWriter, *http.Request)

const HttpReadTimeout = 5 * time.Second
const HttpWriteTimeout = 21 * time.Second
const HttpMaxHeaderBytes = 60000
const HttpTimeoutDuration = 21 * time.Second

const MainServerAddr = "localhost:1619"      // PromptServer,  P=16, S=19, PS=1619
const WebSocketServerAddr = "localhost:1623" // PromptWebsock, P=16, W=23, PW=1623
const MainServerDevAddr = "localhost:8090"
const WebSocketServerDevAddr = "localhost:8091"
const WSStateReconnectTime = 30 * time.Second
const WSStatePacketChSize = 20

const InitialTelemetryWait = 30 * time.Second
const TelemetryTick = 30 * time.Minute
const TelemetryInterval = 8 * time.Hour

var GlobalLock = &sync.Mutex{}
var WSStateMap = make(map[string]*scws.WSState) // clientid -> WsState
var GlobalAuthKey string
var BuildTime = "0"
var shutdownOnce sync.Once

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
	cdata = cdata.Clean()
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
	activity.NumConns = remote.NumRemotes()
	err = sstore.UpdateCurrentActivity(r.Context(), activity)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error updating activity: %w", err))
		return
	}
	WriteJsonSuccess(w, true)
	return
}

// params: screenid
func HandleGetScreenLines(w http.ResponseWriter, r *http.Request) {
	qvals := r.URL.Query()
	screenId := qvals.Get("screenid")
	if _, err := uuid.Parse(screenId); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid screenid: %w", err))
		return
	}
	screenLines, err := sstore.GetScreenLinesById(r.Context(), screenId)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, screenLines)
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
	screenId := qvals.Get("screenid")
	lineId := qvals.Get("lineid")
	if screenId == "" || lineId == "" {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("must specify screenid and lineid")))
		return
	}
	if _, err := uuid.Parse(screenId); err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("invalid screenid: %v", err)))
		return
	}
	if _, err := uuid.Parse(lineId); err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("invalid lineid: %v", err)))
		return
	}
	data, err := rtnstate.GetRtnStateDiff(r.Context(), screenId, lineId)
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
	screenId := qvals.Get("screenid")
	lineId := qvals.Get("lineid")
	if screenId == "" || lineId == "" {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("must specify screenid and lineid")))
		return
	}
	if _, err := uuid.Parse(screenId); err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("invalid screenid: %v", err)))
		return
	}
	if _, err := uuid.Parse(lineId); err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("invalid lineid: %v", err)))
		return
	}
	realOffset, data, err := sstore.ReadFullPtyOutFile(r.Context(), screenId, lineId)
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
	if update != nil {
		update.Clean()
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

func sendTelemetryWrapper() {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[error] in sendTelemetryWrapper: %v\n", r)
		debug.PrintStack()
		return
	}()
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	err := pcloud.SendTelemetry(ctx, false)
	if err != nil {
		log.Printf("[error] sending telemetry: %v\n", err)
	}
}

func telemetryLoop() {
	var lastSent time.Time
	time.Sleep(InitialTelemetryWait)
	for {
		dur := time.Now().Sub(lastSent)
		if lastSent.IsZero() || dur >= TelemetryInterval {
			lastSent = time.Now()
			sendTelemetryWrapper()
		}
		time.Sleep(TelemetryTick)
	}
}

// watch stdin, kill server if stdin is closed
func stdinReadWatch() {
	buf := make([]byte, 1024)
	for {
		_, err := os.Stdin.Read(buf)
		if err != nil {
			doShutdown(fmt.Sprintf("stdin closed/error (%v)", err))
			break
		}
	}
}

// ignore SIGHUP
func installSignalHandlers() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGHUP)
	go func() {
		for sig := range sigCh {
			doShutdown(fmt.Sprintf("got signal %v", sig))
			break
		}
	}()
}

func doShutdown(reason string) {
	shutdownOnce.Do(func() {
		log.Printf("[prompt] local server %v, start shutdown\n", reason)
		sendTelemetryWrapper()
		log.Printf("[prompt] closing db connection\n")
		sstore.CloseDB()
		log.Printf("[prompt] *** shutting down local server\n")
		time.Sleep(1 * time.Second)
		syscall.Kill(syscall.Getpid(), syscall.SIGINT)
		time.Sleep(5 * time.Second)
		syscall.Kill(syscall.Getpid(), syscall.SIGKILL)
	})
}

func main() {
	scbase.BuildTime = BuildTime

	if len(os.Args) >= 2 && os.Args[1] == "--test" {
		log.Printf("running test fn\n")
		err := test()
		if err != nil {
			log.Printf("[error] %v\n", err)
		}
		return
	}

	scHomeDir := scbase.GetPromptHomeDir()
	log.Printf("[prompt] *** starting local server\n")
	log.Printf("[prompt] local server version %s+%s\n", scbase.PromptVersion, scbase.BuildTime)
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
		log.Printf("[error] resetting screen focus: %v\n", err)
	}

	log.Printf("PCLOUD_ENDPOINT=%s\n", pcloud.GetEndpoint())
	err = sstore.UpdateCurrentActivity(context.Background(), sstore.ActivityUpdate{NumConns: remote.NumRemotes()}) // set at least one record into activity
	if err != nil {
		log.Printf("[error] updating activity: %v\n", err)
	}
	installSignalHandlers()
	go telemetryLoop()
	go stdinReadWatch()
	go runWebSocketServer()
	go func() {
		time.Sleep(10 * time.Second)
		pcloud.StartUpdateWriter()
	}()
	gr := mux.NewRouter()
	gr.HandleFunc("/api/ptyout", AuthKeyWrap(HandleGetPtyOut))
	gr.HandleFunc("/api/remote-pty", AuthKeyWrap(HandleRemotePty))
	gr.HandleFunc("/api/rtnstate", AuthKeyWrap(HandleRtnState))
	gr.HandleFunc("/api/get-screen-lines", AuthKeyWrap(HandleGetScreenLines))
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
