package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/cmdtail"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
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

const MaxInputDataSize = 1000

var GlobalMShellProc *MShellProc
var GlobalLock = &sync.Mutex{}
var WSStateMap = make(map[string]*WSState) // clientid -> WsState

func setWSState(state *WSState) {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	WSStateMap[state.ClientId] = state
}

func getWSState(clientId string) *WSState {
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
		err := state.CloseTailer()
		if err != nil {
			fmt.Printf("[error] closing tailer on ws %v\n", err)
		}
	}()
}

type WSState struct {
	Lock        *sync.Mutex
	ClientId    string
	ConnectTime time.Time
	Shell       *wsshell.WSShell
	Tailer      *cmdtail.Tailer
	PacketCh    chan packet.PacketType
}

func MakeWSState(clientId string) (*WSState, error) {
	var err error
	rtn := &WSState{}
	rtn.Lock = &sync.Mutex{}
	rtn.ClientId = clientId
	rtn.ConnectTime = time.Now()
	rtn.PacketCh = make(chan packet.PacketType, WSStatePacketChSize)
	rtn.Tailer, err = cmdtail.MakeTailer(rtn.PacketCh)
	if err != nil {
		return nil, err
	}
	go func() {
		defer close(rtn.PacketCh)
		rtn.Tailer.Run()
	}()
	go rtn.runTailerToWS()
	return rtn, nil
}

func (ws *WSState) CloseTailer() error {
	return ws.Tailer.Close()
}

func (ws *WSState) getShell() *wsshell.WSShell {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	return ws.Shell
}

func (ws *WSState) runTailerToWS() {
	for pk := range ws.PacketCh {
		if pk.GetType() == "cmddata" {
			dataPacket := pk.(*packet.CmdDataPacketType)
			err := ws.writePacket(dataPacket)
			if err != nil {
				fmt.Printf("[error] writing packet to ws: %v\n", err)
			}
			continue
		}
		fmt.Printf("tailer-to-ws, bad packet %v\n", pk.GetType())
	}
}

func (ws *WSState) writePacket(pk packet.PacketType) error {
	shell := ws.getShell()
	if shell == nil || shell.IsClosed() {
		return fmt.Errorf("cannot write packet, empty or closed wsshell")
	}
	err := shell.WriteJson(pk)
	if err != nil {
		return err
	}
	return nil
}

func (ws *WSState) getConnectTime() time.Time {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	return ws.ConnectTime
}

func (ws *WSState) updateConnectTime() {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	ws.ConnectTime = time.Now()
}

func (ws *WSState) replaceExistingShell(shell *wsshell.WSShell) {
	ws.Lock.Lock()
	defer ws.Lock.Unlock()
	if ws.Shell == nil {
		ws.Shell = shell
		return
	}
	ws.Shell.Conn.Close()
	ws.Shell = shell
	return
}

type RpcEntry struct {
	PacketId string
	RespCh   chan packet.RpcPacketType
}

type MShellProc struct {
	Lock        *sync.Mutex
	Cmd         *exec.Cmd
	Input       *packet.PacketSender
	Output      chan packet.PacketType
	Local       bool
	DoneCh      chan bool
	CurDir      string
	HomeDir     string
	User        string
	Host        string
	Env         []string
	Initialized bool
	RpcMap      map[string]*RpcEntry
}

func (r *MShellProc) GetPrompt() string {
	r.Lock.Lock()
	defer r.Lock.Unlock()
	var curDir = r.CurDir
	if r.CurDir == r.HomeDir {
		curDir = "~"
	} else if strings.HasPrefix(r.CurDir, r.HomeDir+"/") {
		curDir = "~/" + r.CurDir[0:len(r.HomeDir)+1]
	}
	return fmt.Sprintf("[%s@%s %s]", r.User, r.Host, curDir)
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
		state, err = MakeWSState(clientId)
		if err != nil {
			fmt.Printf("cannot make wsstate: %v\n", err)
			close(shell.WriteChan)
			return
		}
		state.replaceExistingShell(shell)
		setWSState(state)
	} else {
		state.updateConnectTime()
		state.replaceExistingShell(shell)
	}
	stateConnectTime := state.getConnectTime()
	defer func() {
		removeWSStateAfterTimeout(clientId, stateConnectTime, WSStateReconnectTime)
	}()
	shell.WriteJson(map[string]interface{}{"type": "hello"}) // let client know we accepted this connection, ignore error
	fmt.Printf("WebSocket opened %s %s\n", shell.RemoteAddr, state.ClientId)
	for msgBytes := range shell.ReadChan {
		pk, err := packet.ParseJsonPacket(msgBytes)
		if err != nil {
			fmt.Printf("error unmarshalling ws message: %v\n", err)
			continue
		}
		if pk.GetType() == "getcmd" {
			err = state.Tailer.AddWatch(pk.(*packet.GetCmdPacketType))
			if err != nil {
				fmt.Printf("[error] adding watch to tailer: %v\n", err)
			}
			continue
		}
		if pk.GetType() == "input" {
			go func() {
				err = sendCmdInput(pk.(*packet.InputPacketType))
				if err != nil {
					fmt.Printf("[error] sending command input: %v\n", err)
				}
			}()
			continue
		}
		fmt.Printf("got ws bad message: %v\n", pk.GetType())
	}
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

func sendCmdInput(pk *packet.InputPacketType) error {
	var err error
	if _, err = uuid.Parse(pk.SessionId); err != nil {
		return fmt.Errorf("invalid sessionid '%s': %w", pk.SessionId, err)
	}
	if _, err = uuid.Parse(pk.CmdId); err != nil {
		return fmt.Errorf("invalid cmdid '%s': %w", pk.CmdId, err)
	}
	if len(pk.InputData) > MaxInputDataSize {
		return fmt.Errorf("input data size too large, len=%d (max=%d)", len(pk.InputData), MaxInputDataSize)
	}
	fileNames, err := base.GetCommandFileNames(pk.SessionId, pk.CmdId)
	if err != nil {
		return err
	}
	err = writeToFifo(fileNames.StdinFifo, []byte(pk.InputData))
	if err != nil {
		return err
	}
	return nil
}

func GetPtyOutFile(sessionId string, cmdId string) string {
	pathStr := fmt.Sprintf("/Users/mike/scripthaus/.sessions/%s/%s.ptyout", sessionId, cmdId)
	return pathStr
}

func GetPtyOut(w http.ResponseWriter, r *http.Request) {
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
	pathStr := GetPtyOutFile(sessionId, cmdId)
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

type runCommandParams struct {
	SessionId string `json:"sessionid"`
	WindowId  string `json:"windowid"`
	Command   string `json:"command"`
}

type runCommandResponse struct {
	Line *sstore.LineType `json:"line"`
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
	var params runCommandParams
	err := decoder.Decode(&params)
	if err != nil {
		WriteJsonError(w, fmt.Errorf("error decoding json: %w", err))
		return
	}
	if _, err = uuid.Parse(params.SessionId); err != nil {
		WriteJsonError(w, fmt.Errorf("invalid sessionid '%s': %w", params.SessionId, err))
		return
	}
	commandStr := strings.TrimSpace(params.Command)
	if commandStr == "" {
		WriteJsonError(w, fmt.Errorf("invalid emtpty command"))
		return
	}
	if strings.HasPrefix(commandStr, "/comment ") {
		text := strings.TrimSpace(commandStr[9:])
		rtnLine := sstore.MakeNewLineText(params.SessionId, params.WindowId, text)
		WriteJsonSuccess(w, &runCommandResponse{Line: rtnLine})
		return
	}
	if strings.HasPrefix(commandStr, "cd ") {
		newDir := strings.TrimSpace(commandStr[3:])
		cdPacket := packet.MakeCdPacket()
		cdPacket.PacketId = uuid.New().String()
		cdPacket.Dir = newDir
		GlobalMShellProc.Input.SendPacket(cdPacket)
		return
	}
	rtnLine := sstore.MakeNewLineCmd(params.SessionId, params.WindowId)
	rtnLine.CmdText = commandStr
	runPacket := packet.MakeRunPacket()
	runPacket.SessionId = params.SessionId
	runPacket.CmdId = rtnLine.CmdId
	runPacket.Cwd = ""
	runPacket.Env = nil
	runPacket.Command = commandStr
	fmt.Printf("run-packet %v\n", runPacket)
	WriteJsonSuccess(w, &runCommandResponse{Line: rtnLine})
	go func() {
		GlobalMShellProc.Input.SendPacket(runPacket)
		if !GlobalMShellProc.Local {
			getPacket := packet.MakeGetCmdPacket()
			getPacket.SessionId = runPacket.SessionId
			getPacket.CmdId = runPacket.CmdId
			getPacket.Tail = true
			GlobalMShellProc.Input.SendPacket(getPacket)
		}
	}()
	return
}

// /api/start-session
//   returns:
//     * userid
//     * sessionid
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

func LaunchMShell() (*MShellProc, error) {
	msPath := base.GetMShellPath()
	ecmd := exec.Command(msPath)
	inputWriter, err := ecmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	outputReader, err := ecmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	ecmd.Stderr = ecmd.Stdout // /dev/null
	err = ecmd.Start()
	if err != nil {
		return nil, err
	}
	rtn := &MShellProc{Lock: &sync.Mutex{}, Local: true, Cmd: ecmd}
	rtn.Output = packet.PacketParser(outputReader)
	rtn.Input = packet.MakePacketSender(inputWriter)
	rtn.RpcMap = make(map[string]*RpcEntry)
	rtn.DoneCh = make(chan bool)
	go func() {
		exitErr := ecmd.Wait()
		exitCode := shexec.GetExitCode(exitErr)
		fmt.Printf("[error] RUNNER PROC EXITED code[%d]\n", exitCode)
		close(rtn.DoneCh)
	}()
	return rtn, nil
}

func (runner *MShellProc) PacketRpc(pk packet.RpcPacketType, timeout time.Duration) (packet.RpcPacketType, error) {
	if pk == nil {
		return nil, fmt.Errorf("PacketRpc passed nil packet")
	}
	id := pk.GetPacketId()
	respCh := make(chan packet.RpcPacketType)
	runner.Lock.Lock()
	runner.RpcMap[id] = &RpcEntry{PacketId: id, RespCh: respCh}
	runner.Lock.Unlock()
	defer func() {
		runner.Lock.Lock()
		delete(runner.RpcMap, id)
		runner.Lock.Unlock()
	}()
	runner.Input.SendPacket(pk)
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case rtnPk := <-respCh:
		return rtnPk, nil

	case <-timer.C:
		return nil, fmt.Errorf("PacketRpc timeout")
	}
}

func (runner *MShellProc) ProcessPackets() {
	for pk := range runner.Output {
		if rpcPk, ok := pk.(packet.RpcPacketType); ok {
			rpcId := rpcPk.GetPacketId()
			runner.Lock.Lock()
			entry := runner.RpcMap[rpcId]
			if entry != nil {
				delete(runner.RpcMap, rpcId)
				go func() {
					entry.RespCh <- rpcPk
					close(entry.RespCh)
				}()
			}
			runner.Lock.Unlock()

		}
		if pk.GetType() == packet.CmdDataPacketStr {
			dataPacket := pk.(*packet.CmdDataPacketType)
			fmt.Printf("cmd-data %s/%s pty=%d run=%d\n", dataPacket.SessionId, dataPacket.CmdId, len(dataPacket.PtyData), len(dataPacket.RunData))
			continue
		}
		if pk.GetType() == packet.RunnerInitPacketStr {
			initPacket := pk.(*packet.RunnerInitPacketType)
			fmt.Printf("runner-init %s user=%s dir=%s\n", initPacket.ScHomeDir, initPacket.User, initPacket.HomeDir)
			runner.Lock.Lock()
			runner.Initialized = true
			runner.User = initPacket.User
			runner.CurDir = initPacket.HomeDir
			runner.HomeDir = initPacket.HomeDir
			runner.Env = initPacket.Env
			if runner.Local {
				runner.Host = "local"
			}
			runner.Lock.Unlock()
			continue
		}
		if pk.GetType() == packet.MessagePacketStr {
			msgPacket := pk.(*packet.MessagePacketType)
			fmt.Printf("# %s\n", msgPacket.Message)
			continue
		}
		if pk.GetType() == packet.RawPacketStr {
			rawPacket := pk.(*packet.RawPacketType)
			fmt.Printf("stderr> %s\n", rawPacket.Data)
			continue
		}
		fmt.Printf("runner-packet: %v\n", pk)
	}
}

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
	runnerProc, err := LaunchMShell()
	if err != nil {
		fmt.Printf("error launching runner-proc: %v\n", err)
		return
	}
	GlobalMShellProc = runnerProc
	go runnerProc.ProcessPackets()
	fmt.Printf("Started local runner pid[%d]\n", runnerProc.Cmd.Process.Pid)
	go runWebSocketServer()
	gr := mux.NewRouter()
	gr.HandleFunc("/api/ptyout", GetPtyOut)
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
