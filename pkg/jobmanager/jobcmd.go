// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const ShutdownDelayTime = 100 * time.Millisecond

type CmdDef struct {
	Cmd      string
	Args     []string
	Env      map[string]string
	TermSize waveobj.TermSize
}

type JobCmd struct {
	jobId      string
	lock       sync.Mutex
	cmd        *exec.Cmd
	cmdPty     pty.Pty
	cleanedUp  bool
	ptyClosed  bool
	exitCode   int
	exitSignal string
	exitErr    error
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
		ecmd.Env = os.Environ()
		for key, val := range cmdDef.Env {
			ecmd.Env = append(ecmd.Env, fmt.Sprintf("%s=%s", key, val))
		}
	}
	cmdPty, err := pty.StartWithSize(ecmd, &pty.Winsize{Rows: uint16(cmdDef.TermSize.Rows), Cols: uint16(cmdDef.TermSize.Cols)})
	if err != nil {
		return nil, fmt.Errorf("failed to start command: %w", err)
	}
	jm.cmd = ecmd
	jm.cmdPty = cmdPty
	go jm.readPtyOutput(cmdPty)
	go jm.waitForProcess()
	jm.setupSignalHandlers()
	return jm, nil
}

func (jm *JobCmd) waitForProcess() {
	if jm.cmd == nil || jm.cmd.Process == nil {
		return
	}
	err := jm.cmd.Wait()
	jm.lock.Lock()
	defer jm.lock.Unlock()

	jm.exitErr = err
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
				if status.Signaled() {
					jm.exitSignal = status.Signal().String()
					jm.exitCode = -1
				} else {
					jm.exitCode = status.ExitStatus()
				}
			}
		}
	} else {
		jm.exitCode = 0
	}
	log.Printf("process exited: exitcode=%d, signal=%s, err=%v\n", jm.exitCode, jm.exitSignal, jm.exitErr)
}

func (jm *JobCmd) GetCmd() (*exec.Cmd, pty.Pty) {
	jm.lock.Lock()
	defer jm.lock.Unlock()
	return jm.cmd, jm.cmdPty
}

func (jm *JobCmd) HandleInput(data wshrpc.CommandBlockInputData) error {
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
		sig := normalizeSignal(data.SigName)
		if sig != nil && jm.cmd.Process != nil {
			err := jm.cmd.Process.Signal(sig)
			if err != nil {
				return fmt.Errorf("error sending signal: %w", err)
			}
		}
	}

	if data.TermSize != nil {
		err := pty.Setsize(jm.cmdPty, &pty.Winsize{
			Rows: uint16(data.TermSize.Rows),
			Cols: uint16(data.TermSize.Cols),
		})
		if err != nil {
			return fmt.Errorf("error setting terminal size: %w", err)
		}
	}

	return nil
}

func (jm *JobCmd) setupSignalHandlers() {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigChan
		log.Printf("received signal: %v\n", sig)

		cmd, _ := jm.GetCmd()
		if cmd != nil && cmd.Process != nil {
			log.Printf("forwarding signal %v to child process\n", sig)
			cmd.Process.Signal(sig)
			time.Sleep(ShutdownDelayTime)
		}

		jm.Cleanup()
		os.Exit(0)
	}()
}

func (jm *JobCmd) readPtyOutput(cmdPty pty.Pty) {
	// TODO: implement readPtyOutput
}

func (jm *JobCmd) Terminate() {
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

func (jm *JobCmd) Cleanup() {
	// TODO: implement Cleanup
}
