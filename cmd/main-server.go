package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/gorilla/mux"

	"github.com/scripthaus-dev/sh2-runner/pkg/base"
	"github.com/scripthaus-dev/sh2-runner/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/wsshell"
)

const HttpReadTimeout = 5 * time.Second
const HttpWriteTimeout = 21 * time.Second
const HttpMaxHeaderBytes = 60000
const HttpTimeoutDuration = 21 * time.Second

var GlobalRunnerProc *RunnerProc

type PtyTailWs struct {
	Shell     *wsshell.WSShell
	SessionId string
	CmdId     string
	Position  string
	Watcher   *fsnotify.Watcher
}

type RunnerProc struct {
	Cmd    *exec.Cmd
	Input  *packet.PacketSender
	Output chan packet.PacketType
}

func TailFile(tailWs *PtyTailWs) error {
outer:
	for {
		select {
		case event, ok := <-tailWs.Watcher.Events:
			if !ok {
				break outer
			}
			if event.Op&fsnotify.Write == fsnotify.Write {
				tailWs.Shell.WriteChan <- []byte("*")
			}

		case _, ok := <-tailWs.Watcher.Errors:
			if !ok {
				break outer
			}

		case <-tailWs.Shell.CloseChan:
			break outer
		}
	}
	return nil
}

func HandleWs(w http.ResponseWriter, r *http.Request) {
	shell, err := wsshell.StartWS(w, r)
	if err != nil {
		w.WriteHeader(500)
		w.Write([]byte(fmt.Sprintf("cannot ugprade websocket: %v", err)))
		return
	}
	defer shell.Conn.Close()
	tailWs := &PtyTailWs{
		Shell: shell,
	}
	tailWs.Watcher, err = fsnotify.NewWatcher()
	if err != nil {
		fmt.Printf("Error creating watcher: %v\n", err)
		return
	}
	defer tailWs.Watcher.Close()
	go func() {
		defer shell.Conn.Close()
		TailFile(tailWs)
	}()
	for msg := range shell.ReadChan {
		jmsg := map[string]interface{}{}
		err = json.Unmarshal(msg, &jmsg)
		if err != nil {
			fmt.Printf("error unmarshalling ws message: %v\n", err)
			break
		}
		sessionId, ok := jmsg["sessionid"].(string)
		if !ok || sessionId == "" {
			fmt.Printf("bad ws message, no sessionid\n")
			break
		}
		cmdId, ok := jmsg["cmdid"].(string)
		if !ok || cmdId == "" {
			fmt.Printf("bad ws message, no cmdId\n")
			break
		}
		if tailWs.SessionId != "" {
			fmt.Printf("bad ws message, sessionid already set\n")
			break
		}
		tailWs.SessionId = sessionId
		tailWs.CmdId = cmdId
		pathStr := GetPtyOutFile(sessionId, cmdId)
		err = tailWs.Watcher.Add(pathStr)
		if err != nil {
			fmt.Printf("error adding watcher: %v\n", err)
			break
		}
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

type runCommandParams struct {
	SessionId string `json:"sessionid"`
	Command   string `json:"command"`
}

func WriteJsonError(w http.ResponseWriter, errVal error) {
	w.WriteHeader(500)
	errMap := make(map[string]interface{})
	errMap["error"] = errVal.Error()
	barr, _ := json.Marshal(errMap)
	w.Write(barr)
	return
}

func WriteJsonSuccess(w http.ResponseWriter, data interface{}) {
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
	fmt.Printf("RUN COMMAND sessionid[%s] cmd[%s]\n", params.SessionId, params.Command)
	WriteJsonSuccess(w, nil)
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
	ecmd.Stderr = nil // /dev/null
	ecmd.Start()
	rtn := &RunnerProc{Cmd: ecmd}
	rtn.Output = packet.PacketParser(outputReader)
	rtn.Input = packet.MakePacketSender(inputWriter)
	return rtn, nil
}

func ProcessPackets(runner *RunnerProc) {
	for pk := range runner.Output {
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
	go ProcessPackets(runnerProc)
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
