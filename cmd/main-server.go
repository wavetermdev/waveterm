package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/scripthaus-dev/sh2-runner/pkg/base"
	"github.com/scripthaus-dev/sh2-runner/pkg/packet"
	"github.com/scripthaus-dev/sh2-runner/pkg/shexec"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
	"github.com/scripthaus-dev/sh2-server/pkg/wsshell"
)

const HttpReadTimeout = 5 * time.Second
const HttpWriteTimeout = 21 * time.Second
const HttpMaxHeaderBytes = 60000
const HttpTimeoutDuration = 21 * time.Second

var GlobalRunnerProc *RunnerProc

type WsConnType struct {
	Id    string
	Shell *wsshell.WSShell
}

type RunnerProc struct {
	Lock      *sync.Mutex
	Cmd       *exec.Cmd
	Input     *packet.PacketSender
	Output    chan packet.PacketType
	WsConnMap map[string]*WsConnType
	IsLocal   bool
	DoneCh    chan bool
}

func (rp *RunnerProc) AddWsConn(ws *WsConnType) {
	rp.Lock.Lock()
	defer rp.Lock.Unlock()
	rp.WsConnMap[ws.Id] = ws
}

func (rp *RunnerProc) RemoveWsConn(ws *WsConnType) {
	rp.Lock.Lock()
	defer rp.Lock.Unlock()
	delete(rp.WsConnMap, ws.Id)
}

func HandleWs(w http.ResponseWriter, r *http.Request) {
	shell, err := wsshell.StartWS(w, r)
	if err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("cannot ugprade websocket: %v", err)))
		return
	}
	wsConn := &WsConnType{Id: uuid.New().String(), Shell: shell}
	GlobalRunnerProc.AddWsConn(wsConn)
	defer func() {
		GlobalRunnerProc.RemoveWsConn(wsConn)
		wsConn.Shell.Conn.Close()
	}()
	for msg := range shell.ReadChan {
		jmsg := map[string]interface{}{}
		err = json.Unmarshal(msg, &jmsg)
		if err != nil {
			fmt.Printf("error unmarshalling ws message: %v\n", err)
			break
		}
		fmt.Printf("got ws message: %v\n", jmsg)
	}
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
	rtnLine := sstore.MakeNewLineCmd(commandStr)
	runPacket := packet.MakeRunPacket()
	runPacket.SessionId = params.SessionId
	runPacket.CmdId = rtnLine.CmdId
	runPacket.ChDir = ""
	runPacket.Env = nil
	runPacket.Command = commandStr
	fmt.Printf("run-packet %v\n", runPacket)
	WriteJsonSuccess(w, &runCommandResponse{Line: rtnLine})
	go func() {
		GlobalRunnerProc.Input.SendPacket(runPacket)
		getPacket := packet.MakeGetCmdPacket()
		getPacket.SessionId = runPacket.SessionId
		getPacket.CmdId = runPacket.CmdId
		getPacket.Tail = true
		GlobalRunnerProc.Input.SendPacket(getPacket)
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

func LaunchRunnerProc() (*RunnerProc, error) {
	runnerPath, err := base.GetScRunnerPath()
	if err != nil {
		return nil, err
	}
	ecmd := exec.Command(runnerPath)
	inputWriter, err := ecmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	outputReader, err := ecmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	ecmd.Stderr = ecmd.Stdout // /dev/null
	ecmd.Start()
	rtn := &RunnerProc{Lock: &sync.Mutex{}, IsLocal: true, Cmd: ecmd, WsConnMap: make(map[string]*WsConnType)}
	rtn.Output = packet.PacketParser(outputReader)
	rtn.Input = packet.MakePacketSender(inputWriter)
	rtn.DoneCh = make(chan bool)
	go func() {
		exitErr := ecmd.Wait()
		exitCode := shexec.GetExitCode(exitErr)
		fmt.Printf("[error] RUNNER PROC EXITED code[%d]\n", exitCode)
		close(rtn.DoneCh)
	}()
	return rtn, nil
}

func (runner *RunnerProc) ForwardDataPacket(pk *packet.CmdDataPacketType) int {
	barr, err := json.Marshal(pk)
	if err != nil {
		fmt.Printf("cannot marshal cmddata packet %s/%s: %v)\n", pk.SessionId, pk.CmdId, err)
		return 0
	}
	runner.Lock.Lock()
	defer runner.Lock.Unlock()
	numSent := 0
	for _, ws := range runner.WsConnMap {
		ok := ws.Shell.NonBlockingWrite(barr)
		if !ok {
			fmt.Printf("write was dropped, no queue space in '%s'\n", ws.Id)
			continue
		}
		numSent++
	}
	return numSent
}

func (runner *RunnerProc) ProcessPackets() {
	for pk := range runner.Output {
		if pk.GetType() == packet.CmdDataPacketStr {
			dataPacket := pk.(*packet.CmdDataPacketType)
			runner.ForwardDataPacket(dataPacket)
			fmt.Printf("cmd-data %s/%s pty=%d run=%d\n", dataPacket.SessionId, dataPacket.CmdId, len(dataPacket.PtyData), len(dataPacket.RunData))
			continue
		}
		if pk.GetType() == packet.RunnerInitPacketStr {
			initPacket := pk.(*packet.RunnerInitPacketType)
			fmt.Printf("runner-init %s\n", initPacket.ScHomeDir)
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

func main() {
	runnerProc, err := LaunchRunnerProc()
	if err != nil {
		fmt.Printf("error launching runner-proc: %v\n", err)
		return
	}
	GlobalRunnerProc = runnerProc
	go runnerProc.ProcessPackets()
	fmt.Printf("Started local runner pid[%d]\n", runnerProc.Cmd.Process.Pid)
	gr := mux.NewRouter()
	gr.HandleFunc("/api/ptyout", GetPtyOut)
	gr.HandleFunc("/ws", HandleWs)
	gr.HandleFunc("/api/run-command", HandleRunCommand).Methods("GET", "POST", "OPTIONS")
	server := &http.Server{
		Addr:           "localhost:8080",
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        http.TimeoutHandler(gr, HttpTimeoutDuration, "Timeout"),
	}
	server.SetKeepAlivesEnabled(false)
	fmt.Printf("Running on http://localhost:8080\n")
	err = server.ListenAndServe()
	if err != nil {
		fmt.Printf("ERROR: %v\n", err)
	}
}
