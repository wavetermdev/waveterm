package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
	"github.com/scripthaus-dev/sh2-server/pkg/scbase"
	"github.com/scripthaus-dev/sh2-server/pkg/scpacket"
	"github.com/scripthaus-dev/sh2-server/pkg/scws"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
	"github.com/scripthaus-dev/sh2-server/pkg/wsshell"
)

const HttpReadTimeout = 5 * time.Second
const HttpWriteTimeout = 21 * time.Second
const HttpMaxHeaderBytes = 60000
const HttpTimeoutDuration = 21 * time.Second

const WebSocketServerAddr = "localhost:8081"
const MainServerAddr = "localhost:8080"
const WSStateReconnectTime = 30 * time.Second
const WSStatePacketChSize = 20

var GlobalLock = &sync.Mutex{}
var WSStateMap = make(map[string]*scws.WSState) // clientid -> WsState

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
		fmt.Printf("WebSocket Upgrade Failed %T: %v\n", w, err)
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
		state = scws.MakeWSState(clientId)
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
	shell.WriteJson(map[string]interface{}{"type": "hello"}) // let client know we accepted this connection, ignore error
	fmt.Printf("WebSocket opened %s %s\n", state.ClientId, shell.RemoteAddr)
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

// params: sessionid
func HandleGetSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	qvals := r.URL.Query()
	sessionId := qvals.Get("sessionid")
	if sessionId == "" {
		WriteJsonError(w, fmt.Errorf("must specify a sessionid"))
		return
	}
	session, err := sstore.GetSessionById(r.Context(), sessionId)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, session)
	return
}

func HandleGetAllSessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	list, err := sstore.GetAllSessions(r.Context())
	if err != nil {
		WriteJsonError(w, fmt.Errorf("cannot get all sessions: %w", err))
		return
	}
	WriteJsonSuccess(w, list)
	return
}

// params: name
func HandleCreateSession(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	qvals := r.URL.Query()
	name := qvals.Get("name")
	sessionId, err := sstore.InsertSessionWithName(r.Context(), name)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("inserting session: %w", err))
		return
	}
	session, err := sstore.GetSessionById(r.Context(), sessionId)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("getting new session: %w", err))
		return
	}
	WriteJsonSuccess(w, session)
	return
}

// params: sessionid, name
func HandleCreateWindow(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	qvals := r.URL.Query()
	sessionId := qvals.Get("sessionid")
	if _, err := uuid.Parse(sessionId); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid sessionid: %w", err))
		return
	}
	name := qvals.Get("name")
	fmt.Printf("insert-window %s\n", name)
	return
}

// params: [none]
func HandleGetRemotes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	remotes := remote.GetAllRemoteState()
	WriteJsonSuccess(w, remotes)
	return
}

// params: sessionid, windowid
func HandleGetWindow(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
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

func GetPtyOutFile(sessionId string, cmdId string) string {
	pathStr := fmt.Sprintf("/Users/mike/scripthaus/.sessions/%s/%s.ptyout", sessionId, cmdId)
	return pathStr
}

func HandleGetPtyOut(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
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
	pathStr, err := scbase.PtyOutFile(sessionId, cmdId)
	if err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("cannot get ptyout file name: %v", err)))
		return
	}
	fd, err := os.Open(pathStr)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("cannot open file '%s': %v", pathStr, err)))
		return
	}
	defer fd.Close()
	w.WriteHeader(http.StatusOK)
	io.Copy(w, fd)
}

func WriteJsonError(w http.ResponseWriter, errVal error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(500)
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

type runCommandResponse struct {
	Line *sstore.LineType `json:"line"`
	Cmd  *sstore.CmdType  `json:"cmd"`
}

func HandleRunCommand(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Cache-Control", "no-cache")
	if r.Method == "GET" || r.Method == "OPTIONS" {
		w.WriteHeader(200)
		return
	}
	decoder := json.NewDecoder(r.Body)
	var commandPk scpacket.FeCommandPacketType
	err := decoder.Decode(&commandPk)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error decoding json: %w", err))
		return
	}
	if _, err = uuid.Parse(commandPk.SessionId); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid sessionid '%s': %w", commandPk.SessionId, err))
		return
	}
	resp, err := ProcessFeCommandPacket(r.Context(), &commandPk)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, resp)
	return
}

func ProcessFeCommandPacket(ctx context.Context, pk *scpacket.FeCommandPacketType) (*runCommandResponse, error) {
	commandStr := strings.TrimSpace(pk.CmdStr)
	if commandStr == "" {
		return nil, fmt.Errorf("invalid emtpty command")
	}
	if strings.HasPrefix(commandStr, "/comment ") {
		text := strings.TrimSpace(commandStr[9:])
		rtnLine, err := sstore.AddCommentLine(ctx, pk.SessionId, pk.WindowId, pk.UserId, text)
		if err != nil {
			return nil, err
		}
		return &runCommandResponse{Line: rtnLine}, nil
	}
	if strings.HasPrefix(commandStr, "cd ") {
		newDir := strings.TrimSpace(commandStr[3:])
		cdPacket := packet.MakeCdPacket()
		cdPacket.ReqId = uuid.New().String()
		cdPacket.Dir = newDir
		localRemote := remote.GetRemoteById(pk.RemoteState.RemoteId)
		if localRemote == nil {
			return nil, fmt.Errorf("invalid remote, cannot execute command")
		}
		resp, err := localRemote.PacketRpc(ctx, cdPacket)
		if err != nil {
			return nil, err
		}
		fmt.Printf("GOT cd RESP: %v\n", resp)
		return nil, nil
	}
	cmdId := uuid.New().String()
	cmd, err := remote.RunCommand(ctx, pk, cmdId)
	if err != nil {
		return nil, err
	}
	rtnLine, err := sstore.AddCmdLine(ctx, pk.SessionId, pk.WindowId, pk.UserId, cmd)
	if err != nil {
		return nil, err
	}
	return &runCommandResponse{Line: rtnLine, Cmd: cmd}, nil
}

// /api/start-session
//   returns:
//     * userid
//     * sessionid
//
// /api/get-session
//   params:
//     * name
//   returns:
//     * session
//
// /api/ptyout (pos=[position]) - returns contents of ptyout file
//   params:
//     * sessionid
//     * cmdid
//     * pos
//   returns:
//     * stream of ptyout file (text, utf-8)
//
// POST /api/run-command
//   params
//     * userid
//     * sessionid
//   returns
//     * cmdid
//
// /api/refresh-session
//   params
//     * sessionid
//     * start  -- can be negative
//     * numlines
//   returns
//     * permissions (readonly, comment, command)
//     * lines
//       * lineid
//       * ts
//       * userid
//       * linetype
//       * text
//       * cmdid

// /ws
//   ->watch-session:
//     * sessionid
//   ->watch:
//     * sessionid
//     * cmdid
//   ->focus:
//     * sessionid
//     * cmdid
//   ->input:
//     * sessionid
//     * cmdid
//     * data
//   ->signal:
//     * sessionid
//     * cmdid
//     * data
//   <-data:
//     * sessionid
//     * cmdid
//     * pos
//     * data
//   <-session-data:
//     * sessionid
//     * line

// session-doc
//   timestamp | user | cmd-type | data
//   cmd-type = comment
//   cmd-type = command, commandid=ABC

// how to know if command is still executing?  is command done?

// local -- .ptyout, .stdin
// remote -- transfer controller program
//   controller-startcmd -- start command (with options) => returns cmdid
//   controller-watchsession [sessionid]
//     transfer [cmdid:pos] pairs.  streams back anything new written to ptyout on stdout
//     stdin-packet [cmdid:user:data]
//       startcmd will figure out the correct
//

func runWebSocketServer() {
	gr := mux.NewRouter()
	gr.HandleFunc("/ws", HandleWs)
	server := &http.Server{
		Addr:           WebSocketServerAddr,
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        gr,
	}
	server.SetKeepAlivesEnabled(false)
	fmt.Printf("Running websocket server on %s\n", WebSocketServerAddr)
	err := server.ListenAndServe()
	if err != nil {
		fmt.Printf("[error] trying to run websocket server: %v\n", err)
	}
}

func main() {
	scLock, err := scbase.AcquireSCLock()
	if err != nil || scLock == nil {
		fmt.Printf("[error] cannot acquire sh2 lock: %v\n", err)
		return
	}

	if len(os.Args) >= 2 && strings.HasPrefix(os.Args[1], "--migrate") {
		err := sstore.MigrateCommandOpts(os.Args[1:])
		if err != nil {
			fmt.Printf("[error] %v\n", err)
		}
		return
	}
	err = sstore.TryMigrateUp()
	if err != nil {
		fmt.Printf("[error] %v\n", err)
		return
	}
	err = sstore.EnsureLocalRemote(context.Background())
	if err != nil {
		fmt.Printf("[error] ensuring local remote: %v\n", err)
		return
	}
	_, err = sstore.EnsureDefaultSession(context.Background())
	if err != nil {
		fmt.Printf("[error] ensuring default session: %v\n", err)
		return
	}
	err = remote.LoadRemotes(context.Background())
	if err != nil {
		fmt.Printf("[error] loading remotes: %v\n", err)
		return
	}

	err = sstore.HangupAllRunningCmds(context.Background())
	if err != nil {
		fmt.Printf("[error] calling HUP on all running commands\n")
	}

	go runWebSocketServer()
	gr := mux.NewRouter()
	gr.HandleFunc("/api/ptyout", HandleGetPtyOut)
	gr.HandleFunc("/api/get-all-sessions", HandleGetAllSessions)
	gr.HandleFunc("/api/create-session", HandleCreateSession)
	gr.HandleFunc("/api/get-session", HandleGetSession)
	gr.HandleFunc("/api/get-window", HandleGetWindow)
	gr.HandleFunc("/api/get-remotes", HandleGetRemotes)
	gr.HandleFunc("/api/create-window", HandleCreateWindow)
	gr.HandleFunc("/api/run-command", HandleRunCommand).Methods("GET", "POST", "OPTIONS")
	server := &http.Server{
		Addr:           MainServerAddr,
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        http.TimeoutHandler(gr, HttpTimeoutDuration, "Timeout"),
	}
	server.SetKeepAlivesEnabled(false)
	fmt.Printf("Running main server on %s\n", MainServerAddr)
	err = server.ListenAndServe()
	if err != nil {
		fmt.Printf("ERROR: %v\n", err)
	}
}
