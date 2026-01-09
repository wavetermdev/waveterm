// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionmanager

import (
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"strings"
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

type SessionManager struct {
	sessionId  string
	lock       sync.Mutex
	cmd        *exec.Cmd
	cmdPty     pty.Pty
	cleanedUp  bool
	exitCode   int
	exitSignal string
	exitErr    error
}

func MakeSessionManager(sessionId string, cmdDef CmdDef) (*SessionManager, error) {
	sm := &SessionManager{
		sessionId: sessionId,
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
	sm.cmd = ecmd
	sm.cmdPty = cmdPty
	go sm.readPtyOutput(cmdPty)
	go sm.waitForProcess()
	sm.setupSignalHandlers()
	return sm, nil
}

func (sm *SessionManager) waitForProcess() {
	if sm.cmd == nil || sm.cmd.Process == nil {
		return
	}
	err := sm.cmd.Wait()
	sm.lock.Lock()
	defer sm.lock.Unlock()
	
	sm.exitErr = err
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
				if status.Signaled() {
					sm.exitSignal = status.Signal().String()
					sm.exitCode = -1
				} else {
					sm.exitCode = status.ExitStatus()
				}
			}
		}
	} else {
		sm.exitCode = 0
	}
	log.Printf("process exited: exitcode=%d, signal=%s, err=%v\n", sm.exitCode, sm.exitSignal, sm.exitErr)
}

func (sm *SessionManager) GetCmd() (*exec.Cmd, pty.Pty) {
	sm.lock.Lock()
	defer sm.lock.Unlock()
	return sm.cmd, sm.cmdPty
}

func (sm *SessionManager) HandleInput(data wshrpc.CommandBlockInputData) error {
	sm.lock.Lock()
	defer sm.lock.Unlock()

	if sm.cmd == nil || sm.cmdPty == nil {
		return fmt.Errorf("no active process")
	}

	if len(data.InputData64) > 0 {
		inputBuf := make([]byte, base64.StdEncoding.DecodedLen(len(data.InputData64)))
		nw, err := base64.StdEncoding.Decode(inputBuf, []byte(data.InputData64))
		if err != nil {
			return fmt.Errorf("error decoding input data: %w", err)
		}
		_, err = sm.cmdPty.Write(inputBuf[:nw])
		if err != nil {
			return fmt.Errorf("error writing to pty: %w", err)
		}
	}

	if data.SigName != "" {
		sig := normalizeSignal(data.SigName)
		if sig != nil && sm.cmd.Process != nil {
			err := sm.cmd.Process.Signal(sig)
			if err != nil {
				return fmt.Errorf("error sending signal: %w", err)
			}
		}
	}

	if data.TermSize != nil {
		err := pty.Setsize(sm.cmdPty, &pty.Winsize{
			Rows: uint16(data.TermSize.Rows),
			Cols: uint16(data.TermSize.Cols),
		})
		if err != nil {
			return fmt.Errorf("error setting terminal size: %w", err)
		}
	}

	return nil
}

func normalizeSignal(sigName string) os.Signal {
	sigName = strings.ToUpper(sigName)
	sigName = strings.TrimPrefix(sigName, "SIG")

	switch sigName {
	case "HUP":
		return syscall.SIGHUP
	case "INT":
		return syscall.SIGINT
	case "QUIT":
	return syscall.SIGQUIT
	case "KILL":
		return syscall.SIGKILL
	case "TERM":
		return syscall.SIGTERM
	case "USR1":
		return syscall.SIGUSR1
	case "USR2":
		return syscall.SIGUSR2
	case "STOP":
		return syscall.SIGSTOP
	case "CONT":
		return syscall.SIGCONT
	default:
		return nil
	}
}

func (sm *SessionManager) setupSignalHandlers() {
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigChan
		log.Printf("received signal: %v\n", sig)

		cmd, _ := sm.GetCmd()
		if cmd != nil && cmd.Process != nil {
			log.Printf("forwarding signal %v to child process\n", sig)
			cmd.Process.Signal(sig)
			time.Sleep(ShutdownDelayTime)
		}

		sm.Cleanup()
		os.Exit(0)
	}()
}

func (sm *SessionManager) readPtyOutput(cmdPty pty.Pty) {
	// TODO: implement readPtyOutput
}

func (sm *SessionManager) Cleanup() {
	// TODO: implement Cleanup
}
