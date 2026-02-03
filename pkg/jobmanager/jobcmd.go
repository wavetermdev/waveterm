// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"encoding/base64"
	"fmt"
	"log"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type CmdDef struct {
	Cmd      string
	Args     []string
	Env      map[string]string
	TermSize waveobj.TermSize
}

type JobCmd struct {
	jobId         string
	lock          sync.Mutex
	cmd           *exec.Cmd
	cmdPty        pty.Pty
	ptsName       string
	termSize      waveobj.TermSize
	cleanedUp     bool
	ptyClosed     bool
	processExited bool
	exitCode      *int
	exitSignal    string
	exitErr       error
	exitTs        int64
}

func MakeJobCmd(jobId string, cmdDef CmdDef) (*JobCmd, error) {
	jm := &JobCmd{
		jobId: jobId,
	}
	if cmdDef.TermSize.Rows == 0 || cmdDef.TermSize.Cols == 0 {
		cmdDef.TermSize.Rows = 25
		cmdDef.TermSize.Cols = 80
	}
	if cmdDef.TermSize.Rows <= 0 || cmdDef.TermSize.Cols <= 0 {
		return nil, fmt.Errorf("invalid term size: %v", cmdDef.TermSize)
	}
	ecmd := exec.Command(cmdDef.Cmd, cmdDef.Args...)
	if len(cmdDef.Env) > 0 {
		ecmd.Env = make([]string, 0, len(cmdDef.Env))
		for key, val := range cmdDef.Env {
			ecmd.Env = append(ecmd.Env, fmt.Sprintf("%s=%s", key, val))
		}
	}
	cmdPty, err := pty.StartWithSize(ecmd, &pty.Winsize{Rows: uint16(cmdDef.TermSize.Rows), Cols: uint16(cmdDef.TermSize.Cols)})
	if err != nil {
		return nil, fmt.Errorf("failed to start command: %w", err)
	}
	setCloseOnExec(int(cmdPty.Fd()))
	jm.cmd = ecmd
	jm.cmdPty = cmdPty
	jm.ptsName = jm.cmdPty.Name()
	jm.termSize = cmdDef.TermSize
	go jm.waitForProcess()
	return jm, nil
}

func (jm *JobCmd) waitForProcess() {
	if jm.cmd == nil || jm.cmd.Process == nil {
		return
	}
	err := jm.cmd.Wait()
	jm.lock.Lock()
	defer jm.lock.Unlock()

	jm.processExited = true
	jm.exitTs = time.Now().UnixMilli()
	jm.exitErr = err
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
				if status.Signaled() {
					jm.exitSignal = getSignalName(status.Signal())
				} else if status.Exited() {
					code := status.ExitStatus()
					jm.exitCode = &code
				} else {
					log.Printf("Invalid WaitStatus, not exited or signaled: %v", status)
				}
			}
		}
	} else {
		code := 0
		jm.exitCode = &code
	}
	exitCodeStr := "nil"
	if jm.exitCode != nil {
		exitCodeStr = fmt.Sprintf("%d", *jm.exitCode)
	}
	log.Printf("process exited: exitcode=%s, signal=%s, err=%v\n", exitCodeStr, jm.exitSignal, jm.exitErr)

	go WshCmdJobManager.sendJobExited()
}

func (jm *JobCmd) GetCmd() (*exec.Cmd, pty.Pty) {
	jm.lock.Lock()
	defer jm.lock.Unlock()
	return jm.cmd, jm.cmdPty
}

func (jm *JobCmd) GetPGID() (int, error) {
	jm.lock.Lock()
	defer jm.lock.Unlock()
	if jm.cmd == nil || jm.cmd.Process == nil {
		return 0, fmt.Errorf("no active process")
	}
	if jm.processExited {
		return 0, fmt.Errorf("process already exited")
	}
	pgid, err := getProcessGroupId(jm.cmd.Process.Pid)
	if err != nil {
		return 0, fmt.Errorf("failed to get pgid: %w", err)
	}
	if pgid <= 0 {
		return 0, fmt.Errorf("invalid pgid returned: %d", pgid)
	}
	return pgid, nil
}

func (jm *JobCmd) GetExitInfo() (bool, *wshrpc.CommandJobCmdExitedData) {
	jm.lock.Lock()
	defer jm.lock.Unlock()
	if !jm.processExited {
		return false, nil
	}
	exitData := &wshrpc.CommandJobCmdExitedData{
		JobId:      WshCmdJobManager.JobId,
		ExitCode:   jm.exitCode,
		ExitSignal: jm.exitSignal,
		ExitTs:     jm.exitTs,
	}
	if jm.exitErr != nil {
		exitData.ExitErr = jm.exitErr.Error()
	}
	return true, exitData
}

func (jm *JobCmd) setTermSize_withlock(termSize waveobj.TermSize) error {
	if jm.cmdPty == nil {
		return fmt.Errorf("no active pty")
	}
	if jm.termSize.Rows == termSize.Rows && jm.termSize.Cols == termSize.Cols {
		return nil
	}
	err := pty.Setsize(jm.cmdPty, &pty.Winsize{
		Rows: uint16(termSize.Rows),
		Cols: uint16(termSize.Cols),
	})
	if err != nil {
		return fmt.Errorf("error setting terminal size: %w", err)
	}
	jm.termSize = termSize
	return nil
}

func (jm *JobCmd) SetTermSize(termSize waveobj.TermSize) error {
	jm.lock.Lock()
	defer jm.lock.Unlock()
	return jm.setTermSize_withlock(termSize)
}

// TODO set up a single input handler loop + queue so we dont need to hold the lock but still get synchronized in-order execution
func (jm *JobCmd) HandleInput(data wshrpc.CommandJobInputData) error {
	jm.lock.Lock()
	defer jm.lock.Unlock()

	if jm.cmd == nil || jm.cmdPty == nil {
		return fmt.Errorf("no active process")
	}

	if len(data.InputData64) > 0 {
		inputBuf := make([]byte, base64.StdEncoding.DecodedLen(len(data.InputData64)))
		nw, err := base64.StdEncoding.Decode(inputBuf, []byte(data.InputData64))
		if err != nil {
			return fmt.Errorf("error decoding input data: %w", err)
		}
		_, err = jm.cmdPty.Write(inputBuf[:nw])
		if err != nil {
			return fmt.Errorf("error writing to pty: %w", err)
		}
	}

	if data.SigName != "" {
		sig := parseSignal(data.SigName)
		if sig != nil && jm.cmd.Process != nil {
			err := jm.cmd.Process.Signal(sig)
			if err != nil {
				return fmt.Errorf("error sending signal: %w", err)
			}
		}
	}

	if data.TermSize != nil {
		err := jm.setTermSize_withlock(*data.TermSize)
		if err != nil {
			return err
		}
	}

	return nil
}

func (jm *JobCmd) TerminateByClosingPtyMaster() {
	jm.lock.Lock()
	defer jm.lock.Unlock()
	if jm.ptyClosed {
		return
	}
	if jm.cmdPty != nil {
		jm.cmdPty.Close()
		jm.ptyClosed = true
		log.Printf("pty closed for job %s\n", jm.jobId)
	}
}
