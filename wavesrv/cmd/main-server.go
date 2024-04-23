// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"io/fs"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/server"
	"github.com/wavetermdev/waveterm/waveshell/pkg/wlog"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/bufferedpipe"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/cmdrunner"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/ephemeral"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/pcloud"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/releasechecker"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/remote"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/rtnstate"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbus"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scws"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/telemetry"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/waveenc"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/wsshell"
)

type WebFnType = func(http.ResponseWriter, *http.Request)

const HttpReadTimeout = 5 * time.Second
const HttpWriteTimeout = 21 * time.Second
const HttpMaxHeaderBytes = 60000
const HttpTimeoutDuration = 21 * time.Second

const MainServerAddr = "127.0.0.1:1619"      // wavesrv,  P=16, S=19, PS=1619
const WebSocketServerAddr = "127.0.0.1:1623" // wavesrv:websocket, P=16, W=23, PW=1623
const MainServerDevAddr = "127.0.0.1:8090"
const WebSocketServerDevAddr = "127.0.0.1:8091"
const WSStateReconnectTime = 30 * time.Second
const WSStatePacketChSize = 20

const InitialTelemetryWait = 30 * time.Second
const TelemetryTick = 10 * time.Minute
const TelemetryInterval = 4 * time.Hour

const MaxWriteFileMemSize = 20 * (1024 * 1024) // 20M

// these are set at build time
var WaveVersion = "v0.0.0"
var BuildTime = "0"

var GlobalLock = &sync.Mutex{}
var WSStateMap = make(map[string]*scws.WSState) // clientid -> WsState
var shutdownOnce sync.Once
var ContentTypeHeaderValidRe = regexp.MustCompile(`^\w+/[\w.+-]+$`)

type ClientActiveState struct {
	Fg     bool `json:"fg"`
	Active bool `json:"active"`
	Open   bool `json:"open"`
}

// Error constants
const (
	ErrorDecodingJson    = "error decoding json: %w"
	ErrorPanic           = "panic: %v"
	ErrorInvalidScreenId = "invalid screenid: %v"
	ErrorInvalidLineId   = "invalid lineid: %v"
)

// Header constants
const (
	CacheControlHeaderKey     = "Cache-Control"
	CacheControlHeaderNoCache = "no-cache"
	ContentTypeHeaderKey      = "Content-Type"
	ContentTypeJson           = "application/json"
	ContentTypeText           = "text/plain"
)

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
		state = scws.MakeWSState(clientId, scbase.WaveAuthKey)
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
}

func HandleSetWinSize(w http.ResponseWriter, r *http.Request) {
	decoder := json.NewDecoder(r.Body)
	var winSize sstore.ClientWinSizeType
	err := decoder.Decode(&winSize)
	if err != nil {
		WriteJsonError(w, fmt.Errorf(ErrorDecodingJson, err))
		return
	}
	err = sstore.SetWinSize(r.Context(), winSize)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error setting winsize: %w", err))
		return
	}
	WriteJsonSuccess(w, true)
}

// params: fg, active, open
func HandleLogActiveState(w http.ResponseWriter, r *http.Request) {
	decoder := json.NewDecoder(r.Body)
	var activeState ClientActiveState
	err := decoder.Decode(&activeState)
	if err != nil {
		WriteJsonError(w, fmt.Errorf(ErrorDecodingJson, err))
		return
	}
	activity := telemetry.ActivityUpdate{}
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
	activity.NumWorkspaces, _ = sstore.NumSessions(r.Context())
	activity.NumTabs, _ = sstore.NumScreens(r.Context())
	err = telemetry.UpdateCurrentActivity(r.Context(), activity)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error updating activity: %w", err))
		return
	}
	WriteJsonSuccess(w, true)
}

// params: screenid
func HandleGetScreenLines(w http.ResponseWriter, r *http.Request) {
	qvals := r.URL.Query()
	screenId := qvals.Get("screenid")
	if _, err := uuid.Parse(screenId); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid screenid, err: %w", err))
		return
	}
	screenLines, err := sstore.GetScreenLinesById(r.Context(), screenId)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, screenLines)
}

func HandleRtnState(w http.ResponseWriter, r *http.Request) {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[error] in handlertnstate: %v\n", r)
		debug.PrintStack()
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(ErrorPanic, r)))
	}()
	qvals := r.URL.Query()
	screenId := qvals.Get("screenid")
	lineId := qvals.Get("lineid")
	if screenId == "" || lineId == "" {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("must specify screenid and lineid"))
		return
	}
	if _, err := uuid.Parse(screenId); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(ErrorInvalidScreenId, err)))
		return
	}
	if _, err := uuid.Parse(lineId); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(ErrorInvalidLineId, err)))
		return
	}
	data, err := rtnstate.GetRtnStateDiff(r.Context(), screenId, lineId)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf("cannot get rtnstate diff: %v", err)))
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

func HandleRemotePty(w http.ResponseWriter, r *http.Request) {
	qvals := r.URL.Query()
	remoteId := qvals.Get("remoteid")
	if remoteId == "" {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("must specify remoteid"))
		return
	}
	if _, err := uuid.Parse(remoteId); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf("invalid remoteid: %v", err)))
		return
	}
	realOffset, data, err := remote.ReadRemotePty(r.Context(), remoteId)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf("error reading ptyout file: %v", err)))
		return
	}
	w.Header().Set("X-PtyDataOffset", strconv.FormatInt(realOffset, 10))
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

func HandleGetPtyOut(w http.ResponseWriter, r *http.Request) {
	qvals := r.URL.Query()
	screenId := qvals.Get("screenid")
	lineId := qvals.Get("lineid")
	if screenId == "" || lineId == "" {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("must specify screenid and lineid"))
		return
	}
	if _, err := uuid.Parse(screenId); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(ErrorInvalidScreenId, err)))
		return
	}
	if _, err := uuid.Parse(lineId); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(ErrorInvalidLineId, err)))
		return
	}
	realOffset, data, err := sstore.ReadFullPtyOutFile(r.Context(), screenId, lineId)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(html.EscapeString(fmt.Sprintf("error reading ptyout file: %v", err))))
		return
	}
	w.Header().Set("X-PtyDataOffset", strconv.FormatInt(realOffset, 10))
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

type writeFileParamsType struct {
	ScreenId string `json:"screenid"`
	LineId   string `json:"lineid"`
	Path     string `json:"path"`
	UseTemp  bool   `json:"usetemp,omitempty"`
}

func parseWriteFileParams(r *http.Request) (*writeFileParamsType, multipart.File, error) {
	err := r.ParseMultipartForm(MaxWriteFileMemSize)
	if err != nil {
		return nil, nil, fmt.Errorf("cannot parse multipart form data: %v", err)
	}
	form := r.MultipartForm
	if len(form.Value["params"]) == 0 {
		return nil, nil, fmt.Errorf("no params found")
	}
	paramsStr := form.Value["params"][0]
	var params writeFileParamsType
	err = json.Unmarshal([]byte(paramsStr), &params)
	if err != nil {
		return nil, nil, fmt.Errorf("bad params json: %v", err)
	}
	if len(form.File["data"]) == 0 {
		return nil, nil, fmt.Errorf("no data found")
	}
	fileHeader := form.File["data"][0]
	file, err := fileHeader.Open()
	if err != nil {
		return nil, nil, fmt.Errorf("error opening multipart data file: %v", err)
	}
	return &params, file, nil
}

func HandleWriteFile(w http.ResponseWriter, r *http.Request) {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[error] in write-file: %v\n", r)
		debug.PrintStack()
		WriteJsonError(w, fmt.Errorf(ErrorPanic, r))
	}()
	w.Header().Set(CacheControlHeaderKey, CacheControlHeaderNoCache)
	params, mpFile, err := parseWriteFileParams(r)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error parsing multipart form params: %w", err))
		return
	}
	if params.ScreenId == "" || params.LineId == "" || params.Path == "" {
		WriteJsonError(w, fmt.Errorf("invalid params, must set screenid, lineid, and path"))
		return
	}
	if _, err := uuid.Parse(params.ScreenId); err != nil {
		WriteJsonError(w, fmt.Errorf(ErrorInvalidScreenId, err))
		return
	}
	if _, err := uuid.Parse(params.LineId); err != nil {
		WriteJsonError(w, fmt.Errorf(ErrorInvalidLineId, err))
		return
	}
	_, cmd, err := sstore.GetLineCmdByLineId(r.Context(), params.ScreenId, params.LineId)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("cannot retrieve line/cmd: %v", err))
		return
	}
	if cmd == nil {
		WriteJsonError(w, fmt.Errorf("line not found"))
		return
	}
	if cmd.Remote.RemoteId == "" {
		WriteJsonError(w, fmt.Errorf("invalid line, no remote"))
		return
	}
	msh := remote.GetRemoteById(cmd.Remote.RemoteId)
	if msh == nil {
		WriteJsonError(w, fmt.Errorf("invalid line, cannot resolve remote"))
		return
	}
	rrState := msh.GetRemoteRuntimeState()
	fullPath, err := rrState.ExpandHomeDir(params.Path)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error expanding homedir: %v", err))
		return
	}
	cwd := cmd.FeState["cwd"]
	writePk := packet.MakeWriteFilePacket()
	writePk.ReqId = uuid.New().String()
	writePk.UseTemp = params.UseTemp
	if filepath.IsAbs(fullPath) {
		writePk.Path = fullPath
	} else {
		writePk.Path = filepath.Join(cwd, fullPath)
	}
	iter, err := msh.PacketRpcIter(r.Context(), writePk)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error: %v", err))
		return
	}
	// first packet should be WriteFileReady
	readyIf, err := iter.Next(r.Context())
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error while getting ready response: %w", err))
		return
	}
	readyPk, ok := readyIf.(*packet.WriteFileReadyPacketType)
	if !ok {
		WriteJsonError(w, fmt.Errorf("bad ready packet received: %T", readyIf))
		return
	}
	if readyPk.Error != "" {
		WriteJsonError(w, fmt.Errorf("ready error: %s", readyPk.Error))
		return
	}
	var buffer [server.MaxFileDataPacketSize]byte
	bufSlice := buffer[:]
	for {
		dataPk := packet.MakeFileDataPacket(writePk.ReqId)
		nr, err := io.ReadFull(mpFile, bufSlice)
		if err == io.ErrUnexpectedEOF || err == io.EOF {
			dataPk.Eof = true
		} else if err != nil {
			dataErr := fmt.Errorf("error reading file data: %v", err)
			dataPk.Error = dataErr.Error()
			msh.SendFileData(dataPk)
			WriteJsonError(w, dataErr)
			return
		}
		if nr > 0 {
			dataPk.Data = make([]byte, nr)
			copy(dataPk.Data, bufSlice[0:nr])
		}
		msh.SendFileData(dataPk)
		if dataPk.Eof {
			break
		}
		// slight throttle for sending packets
		time.Sleep(10 * time.Millisecond)
	}
	doneIf, err := iter.Next(r.Context())
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error while getting done response: %w", err))
		return
	}
	donePk, ok := doneIf.(*packet.WriteFileDonePacketType)
	if !ok {
		WriteJsonError(w, fmt.Errorf("bad done packet received: %T", doneIf))
		return
	}
	if donePk.Error != "" {
		WriteJsonError(w, fmt.Errorf("dne error: %s", donePk.Error))
		return
	}
	WriteJsonSuccess(w, nil)
}

func HandleReadFile(w http.ResponseWriter, r *http.Request) {
	qvals := r.URL.Query()
	screenId := qvals.Get("screenid")
	lineId := qvals.Get("lineid")
	path := qvals.Get("path")            // validate path?
	contentType := qvals.Get("mimetype") // force a mimetype
	if screenId == "" || lineId == "" {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("must specify sessionid, screenid, and lineid"))
		return
	}
	if path == "" {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("must specify path"))
		return
	}
	if _, err := uuid.Parse(screenId); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(ErrorInvalidScreenId, err)))
		return
	}
	if _, err := uuid.Parse(lineId); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf(ErrorInvalidLineId, err)))
		return
	}
	if contentType != "" && !ContentTypeHeaderValidRe.MatchString(contentType) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("invalid mimetype specified"))
		return
	}
	_, cmd, err := sstore.GetLineCmdByLineId(r.Context(), screenId, lineId)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf("invalid lineid: %v", err)))
		return
	}
	if cmd == nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("invalid line, no cmd"))
		return
	}
	if cmd.Remote.RemoteId == "" {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("invalid line, no remote"))
		return
	}
	msh := remote.GetRemoteById(cmd.Remote.RemoteId)
	if msh == nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("invalid line, cannot resolve remote"))
		return
	}
	rrState := msh.GetRemoteRuntimeState()
	fullPath, err := rrState.ExpandHomeDir(path)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error expanding homedir: %v", err))
		return
	}
	streamPk := packet.MakeStreamFilePacket()
	streamPk.ReqId = uuid.New().String()
	cwd := cmd.FeState["cwd"]
	if filepath.IsAbs(fullPath) {
		streamPk.Path = fullPath
	} else {
		streamPk.Path = filepath.Join(cwd, fullPath)
	}
	iter, err := msh.StreamFile(r.Context(), streamPk)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf("error trying to stream file: %v", err)))
		return
	}
	defer iter.Close()
	respIf, err := iter.Next(r.Context())
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf("error getting streamfile response: %v", err)))
		return
	}
	resp, ok := respIf.(*packet.StreamFileResponseType)
	if !ok {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf("bad response packet type: %T", respIf)))
		return
	}
	if resp.Error != "" {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf("error response: %s", resp.Error)))
		return
	}
	infoJson, _ := json.Marshal(resp.Info)
	if contentType == "" && resp.Info.MimeType != "" {
		contentType = resp.Info.MimeType
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("X-FileInfo", base64.StdEncoding.EncodeToString(infoJson))
	w.Header().Set(ContentTypeHeaderKey, contentType)
	w.WriteHeader(http.StatusOK)
	for {
		dataPkIf, err := iter.Next(r.Context())
		if err != nil {
			log.Printf("error in read-file while getting data: %v\n", err)
			break
		}
		if dataPkIf == nil {
			break
		}
		dataPk, ok := dataPkIf.(*packet.FileDataPacketType)
		if !ok {
			log.Printf("error in read-file, invalid data packet type: %T", dataPkIf)
			break
		}
		if dataPk.Error != "" {
			log.Printf("in read-file, data packet error: %s", dataPk.Error)
			break
		}
		w.Write(dataPk.Data)
	}
}

func WriteJsonError(w http.ResponseWriter, errVal error) {
	w.Header().Set(ContentTypeHeaderKey, ContentTypeJson)
	w.WriteHeader(http.StatusOK)
	errMap := make(map[string]interface{})
	errMap["error"] = errVal.Error()
	errorCode := base.GetErrorCode(errVal)
	if errorCode != "" {
		errMap["errorcode"] = errorCode
	}
	barr, _ := json.Marshal(errMap)
	w.Write(barr)
}

func WriteJsonSuccess(w http.ResponseWriter, data interface{}) {
	w.Header().Set(ContentTypeHeaderKey, ContentTypeJson)
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
	w.WriteHeader(http.StatusOK)
	w.Write(barr)
}

func HandleRunCommand(w http.ResponseWriter, r *http.Request) {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[error] in run-command: %v\n", r)
		debug.PrintStack()
		WriteJsonError(w, fmt.Errorf(ErrorPanic, r))
	}()
	w.Header().Set(CacheControlHeaderKey, CacheControlHeaderNoCache)
	decoder := json.NewDecoder(r.Body)
	var commandPk scpacket.FeCommandPacketType
	err := decoder.Decode(&commandPk)
	if err != nil {
		WriteJsonError(w, fmt.Errorf(ErrorDecodingJson, err))
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
}

func HandleRunEphemeralCommand(w http.ResponseWriter, r *http.Request) {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[error] in run-ephemeral-command: %v\n", r)
		debug.PrintStack()
		WriteJsonError(w, fmt.Errorf(ErrorPanic, r))
	}()
	w.Header().Set(CacheControlHeaderKey, CacheControlHeaderNoCache)
	decoder := json.NewDecoder(r.Body)
	var commandPk scpacket.FeCommandPacketType
	err := decoder.Decode(&commandPk)
	if err != nil {
		WriteJsonError(w, fmt.Errorf(ErrorDecodingJson, err))
		return
	}
	log.Printf("Running ephemeral command: %v\n", commandPk)

	if commandPk.EphemeralOpts == nil {
		commandPk.EphemeralOpts = &ephemeral.EphemeralRunOpts{}
	}

	if commandPk.EphemeralOpts.TimeoutMs == 0 {
		commandPk.EphemeralOpts.TimeoutMs = ephemeral.DefaultEphemeralTimeoutMs
	}

	// These need to be defined here so we can use the methods of the BufferedPipe that are not part of io.WriteCloser
	var stdoutPipe, stderrPipe *bufferedpipe.BufferedPipe

	if commandPk.EphemeralOpts.ExpectsResponse {
		// Create new buffered pipes for stdout and stderr
		stdoutPipe = bufferedpipe.NewBufferedPipe(ephemeral.DefaultEphemeralTimeoutDuration)
		commandPk.EphemeralOpts.StdoutWriter = stdoutPipe
		stderrPipe = bufferedpipe.NewBufferedPipe(ephemeral.DefaultEphemeralTimeoutDuration)
		commandPk.EphemeralOpts.StderrWriter = stderrPipe
	}

	update, err := cmdrunner.HandleCommand(r.Context(), &commandPk)
	if err != nil {
		log.Printf("Error occurred while running ephemeral command: %v\n", err)
		if commandPk.EphemeralOpts.ExpectsResponse {
			log.Printf("Closing buffered pipes\n")
			stdoutPipe.Close()
			stderrPipe.Close()
		}
		WriteJsonError(w, err)
		return
	}

	resp := scpacket.EphemeralCommandResponsePacketType{}

	// No error occurred, so we can write the response to the client
	if commandPk.EphemeralOpts.ExpectsResponse {
		// If the client expects a response, we need to send the urls of the stdout and stderr outputs
		stdoutUrl, err := stdoutPipe.GetOutputUrl()
		if err != nil {
			log.Printf("Error occurred while getting stdout url: %v\n", err)
			WriteJsonError(w, err)
			return
		}
		resp.StdoutUrl = stdoutUrl
		stderrUrl, err := stderrPipe.GetOutputUrl()
		if err != nil {
			log.Printf("Error occurred while getting stderr url: %v\n", err)
			WriteJsonError(w, err)
			return
		}
		resp.StderrUrl = stderrUrl
	}

	WriteJsonSuccess(w, resp)

	// With ephemeral commands, we can't send the update back directly, so we need to send it through the update bus
	if update != nil {
		log.Printf("Sending update to main update bus\n")
		update.Clean()
		scbus.MainUpdateBus.DoUpdate(update)
	}
}

func CheckIsDir(dirHandler http.Handler, fileHandler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		configPath := r.URL.Path
		configAbsPath, err := filepath.Abs(configPath)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(fmt.Sprintf("error getting absolute path: %v", err)))
			return
		}
		configBaseDir := path.Join(scbase.GetWaveHomeDir(), "config")
		configFullPath := path.Join(scbase.GetWaveHomeDir(), configAbsPath)
		if !strings.HasPrefix(configFullPath, configBaseDir) {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(fmt.Sprintf("error: path is not in config folder")))
			return
		}
		fstat, err := os.Stat(configFullPath)
		if errors.Is(err, fs.ErrNotExist) {
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(fmt.Sprintf("file not found: %v", configAbsPath)))
			return
		} else if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(fmt.Sprintf("file stat err: %v", err)))
			return
		}
		if fstat.IsDir() {
			AuthKeyMiddleWare(dirHandler).ServeHTTP(w, r)
		} else {
			AuthKeyMiddleWare(fileHandler).ServeHTTP(w, r)
		}
	})
}

func AuthKeyMiddleWare(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqAuthKey := r.Header.Get("X-AuthKey")
		w.Header().Set(CacheControlHeaderKey, CacheControlHeaderNoCache)
		if reqAuthKey == "" {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("no x-authkey header"))
			return
		}
		if reqAuthKey != scbase.WaveAuthKey {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("x-authkey header is invalid"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func AuthKeyWrapAllowHmac(fn WebFnType) WebFnType {
	return func(w http.ResponseWriter, r *http.Request) {
		reqAuthKey := r.Header.Get("X-AuthKey")
		if reqAuthKey == "" {
			// try hmac
			qvals := r.URL.Query()
			if !qvals.Has("hmac") {
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte("no x-authkey header"))
				return
			}
			hmacOk, err := waveenc.ValidateUrlHmac([]byte(scbase.WaveAuthKey), r.URL.Path, qvals)
			if err != nil || !hmacOk {
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(fmt.Sprintf("error validating hmac")))
				return
			}
			// fallthrough (hmac is valid)
		} else if reqAuthKey != scbase.WaveAuthKey {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("x-authkey header is invalid"))
			return
		}
		w.Header().Set(CacheControlHeaderKey, CacheControlHeaderNoCache)
		fn(w, r)
	}

}

func AuthKeyWrap(fn WebFnType) WebFnType {
	return func(w http.ResponseWriter, r *http.Request) {
		reqAuthKey := r.Header.Get("X-AuthKey")
		if reqAuthKey == "" {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("no x-authkey header"))
			return
		}
		if reqAuthKey != scbase.WaveAuthKey {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("x-authkey header is invalid"))
			return
		}
		w.Header().Set(CacheControlHeaderKey, CacheControlHeaderNoCache)
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
	}()
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	err := pcloud.SendTelemetry(ctx, false)
	if err != nil {
		log.Printf("[error] sending telemetry: %v\n", err)
	}
}

func checkNewReleaseWrapper() {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		log.Printf("[error] in checkNewReleaseWrapper: %v\n", r)
		debug.PrintStack()
	}()

	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()

	_, err := releasechecker.CheckNewRelease(ctx, false)
	if err != nil {
		log.Printf("[error] checking for new release: %v\n", err)
		return
	}
}

func telemetryLoop() {
	var nextSend int64
	time.Sleep(InitialTelemetryWait)
	for {
		if time.Now().Unix() > nextSend {
			nextSend = time.Now().Add(TelemetryInterval).Unix()
			sendTelemetryWrapper()
			checkNewReleaseWrapper()
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
		log.Printf("[wave] local server %v, start shutdown\n", reason)
		shutdownActivityUpdate()
		sendTelemetryWrapper()
		log.Printf("[wave] closing db connection\n")
		sstore.CloseDB()
		log.Printf("[wave] *** shutting down local server\n")
		time.Sleep(1 * time.Second)
		syscall.Kill(syscall.Getpid(), syscall.SIGINT)
		time.Sleep(5 * time.Second)
		syscall.Kill(syscall.Getpid(), syscall.SIGKILL)
	})
}

func configDirHandler(w http.ResponseWriter, r *http.Request) {
	log.Printf("running?")
	configPath := r.URL.Path
	configFullPath := path.Join(scbase.GetWaveHomeDir(), configPath)
	dirFile, err := os.Open(configFullPath)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf("error opening specified dir: %v", err)))
		return
	}
	entries, err := dirFile.Readdir(0)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf("error getting files: %v", err)))
		return
	}
	var files []*packet.FileStatPacketType
	for index := 0; index < len(entries); index++ {
		curEntry := entries[index]
		curFile := packet.MakeFileStatPacketFromFileInfo(curEntry, "", false)
		files = append(files, curFile)
	}
	dirListJson, err := json.Marshal(files)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(fmt.Sprintf("json err: %v", err)))
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Header().Set("Content-Type", "application/json")
	w.Write(dirListJson)
}

func startupActivityUpdate() {
	activity := telemetry.ActivityUpdate{
		NumConns: remote.NumRemotes(),
		Startup:  1,
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	activity.NumWorkspaces, _ = sstore.NumSessions(ctx)
	activity.NumTabs, _ = sstore.NumScreens(ctx)
	err := telemetry.UpdateCurrentActivity(ctx, activity) // set at least one record into activity (don't use go routine wrap here)
	if err != nil {
		log.Printf("error updating startup activity: %v\n", err)
	}
}

func shutdownActivityUpdate() {
	activity := telemetry.ActivityUpdate{Shutdown: 1}
	ctx, cancelFn := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancelFn()
	err := telemetry.UpdateCurrentActivity(ctx, activity) // do NOT use the go routine wrap here (this needs to be synchronous)
	if err != nil {
		log.Printf("error updating shutdown activity: %v\n", err)
	}
}

func main() {
	scbase.BuildTime = BuildTime
	scbase.WaveVersion = WaveVersion
	base.ProcessType = base.ProcessType_WaveSrv
	wlog.GlobalSubsystem = base.ProcessType_WaveSrv
	wlog.LogConsumer = wlog.LogWithLogger

	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	if len(os.Args) >= 2 && os.Args[1] == "--test" {
		log.Printf("running test fn\n")
		err := test()
		if err != nil {
			log.Printf("[error] %v\n", err)
		}
		return
	}

	scHomeDir := scbase.GetWaveHomeDir()
	log.Printf("[wave] *** starting wavesrv version %s+%s\n", scbase.WaveVersion, scbase.BuildTime)
	log.Printf("[wave] homedir = %q\n", scHomeDir)

	scLock, err := scbase.AcquireWaveLock()
	if err != nil || scLock == nil {
		log.Printf("[error] cannot acquire wave lock (another instance of wavesrv is likely running): %v\n", err)
		return
	}
	if len(os.Args) >= 2 && strings.HasPrefix(os.Args[1], "--migrate") {
		err := sstore.MigrateCommandOpts(os.Args[1:])
		if err != nil {
			log.Printf("[error] migrate cmd: %v\n", err)
		}
		return
	}
	err = scbase.InitializeWaveAuthKey()
	if err != nil {
		log.Printf("[error] %v\n", err)
		return
	}
	_, err = scbase.EnsureConfigDir()
	if err != nil {
		log.Printf("[error] ensuring config directory: %v\n", err)
		return
	}
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
	startupActivityUpdate()
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
	gr.HandleFunc("/api/run-ephemeral-command", AuthKeyWrap(HandleRunEphemeralCommand)).Methods("POST")
	gr.HandleFunc(bufferedpipe.BufferedPipeGetterUrl, AuthKeyWrapAllowHmac(bufferedpipe.HandleGetBufferedPipeOutput))
	gr.HandleFunc("/api/get-client-data", AuthKeyWrap(HandleGetClientData))
	gr.HandleFunc("/api/set-winsize", AuthKeyWrap(HandleSetWinSize))
	gr.HandleFunc("/api/log-active-state", AuthKeyWrap(HandleLogActiveState))
	gr.HandleFunc("/api/read-file", AuthKeyWrapAllowHmac(HandleReadFile))
	gr.HandleFunc("/api/write-file", AuthKeyWrap(HandleWriteFile)).Methods("POST")
	configPath := path.Join(scbase.GetWaveHomeDir(), "config") + "/"
	log.Printf("[wave] config path: %q\n", configPath)
	isFileHandler := http.StripPrefix("/config/", http.FileServer(http.Dir(configPath)))
	isDirHandler := http.HandlerFunc(configDirHandler)
	gr.PathPrefix("/config/").Handler(CheckIsDir(isDirHandler, isFileHandler))

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
	runtime.KeepAlive(scLock)
}
