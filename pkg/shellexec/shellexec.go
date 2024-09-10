// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const DefaultGracefulKillWait = 400 * time.Millisecond

type CommandOptsType struct {
	Interactive bool              `json:"interactive,omitempty"`
	Login       bool              `json:"login,omitempty"`
	Cwd         string            `json:"cwd,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
}

type ShellProc struct {
	ConnName  string
	Cmd       ConnInterface
	CloseOnce *sync.Once
	DoneCh    chan any // closed after proc.Wait() returns
	WaitErr   error    // WaitErr is synchronized by DoneCh (written before DoneCh is closed) and CloseOnce
}

func (sp *ShellProc) Close() {
	sp.Cmd.KillGraceful(DefaultGracefulKillWait)
	go func() {
		waitErr := sp.Cmd.Wait()
		sp.SetWaitErrorAndSignalDone(waitErr)

		// windows cannot handle the pty being
		// closed twice, so we let the pty
		// close itself instead
		if runtime.GOOS != "windows" {
			sp.Cmd.Close()
		}
	}()
}

func (sp *ShellProc) SetWaitErrorAndSignalDone(waitErr error) {
	sp.CloseOnce.Do(func() {
		sp.WaitErr = waitErr
		close(sp.DoneCh)
	})
}

func (sp *ShellProc) Wait() error {
	<-sp.DoneCh
	return sp.WaitErr
}

// returns (done, waitError)
func (sp *ShellProc) WaitNB() (bool, error) {
	select {
	case <-sp.DoneCh:
		return true, sp.WaitErr
	default:
		return false, nil
	}
}

func ExitCodeFromWaitErr(err error) int {
	if err == nil {
		return 0
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
			return status.ExitStatus()
		}
	}
	return -1

}

func checkCwd(cwd string) error {
	if cwd == "" {
		return fmt.Errorf("cwd is empty")
	}
	if _, err := os.Stat(cwd); err != nil {
		return fmt.Errorf("error statting cwd %q: %w", cwd, err)
	}
	return nil
}

type PipePty struct {
	remoteStdinWrite *os.File
	remoteStdoutRead *os.File
}

func (pp *PipePty) Fd() uintptr {
	return pp.remoteStdinWrite.Fd()
}

func (pp *PipePty) Name() string {
	return "pipe-pty"
}

func (pp *PipePty) Read(p []byte) (n int, err error) {
	return pp.remoteStdoutRead.Read(p)
}

func (pp *PipePty) Write(p []byte) (n int, err error) {
	return pp.remoteStdinWrite.Write(p)
}

func (pp *PipePty) Close() error {
	err1 := pp.remoteStdinWrite.Close()
	err2 := pp.remoteStdoutRead.Close()

	if err1 != nil {
		return err1
	}
	return err2
}

func (pp *PipePty) WriteString(s string) (n int, err error) {
	return pp.Write([]byte(s))
}

func StartRemoteShellProc(termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType, conn *conncontroller.SSHConn) (*ShellProc, error) {
	client := conn.GetClient()
	shellPath, err := remote.DetectShell(client)
	if err != nil {
		return nil, err
	}
	var shellOpts []string
	var cmdCombined string
	log.Printf("detected shell: %s", shellPath)

	err = remote.InstallClientRcFiles(client)
	if err != nil {
		log.Printf("error installing rc files: %v", err)
		return nil, err
	}

	homeDir := remote.GetHomeDir(client)

	if cmdStr == "" {
		/* transform command in order to inject environment vars */
		if isBashShell(shellPath) {
			log.Printf("recognized as bash shell")
			// add --rcfile
			// cant set -l or -i with --rcfile
			shellOpts = append(shellOpts, "--rcfile", fmt.Sprintf(`"%s"/.waveterm/%s/.bashrc`, homeDir, shellutil.BashIntegrationDir))
		} else if remote.IsPowershell(shellPath) {
			// powershell is weird about quoted path executables and requires an ampersand first
			shellPath = "& " + shellPath
			shellOpts = append(shellOpts, "-NoExit", "-File", homeDir+fmt.Sprintf("/.waveterm/%s/wavepwsh.ps1", shellutil.PwshIntegrationDir))
		} else {
			if cmdOpts.Login {
				shellOpts = append(shellOpts, "-l")
			}
			if cmdOpts.Interactive {
				shellOpts = append(shellOpts, "-i")
			}
			// zdotdir setting moved to after session is created
		}
		cmdCombined = fmt.Sprintf("%s %s", shellPath, strings.Join(shellOpts, " "))
		log.Printf("combined command is: %s", cmdCombined)
	} else {
		shellPath = cmdStr
		if cmdOpts.Login {
			shellOpts = append(shellOpts, "-l")
		}
		if cmdOpts.Interactive {
			shellOpts = append(shellOpts, "-i")
		}
		shellOpts = append(shellOpts, "-c", cmdStr)
		cmdCombined = fmt.Sprintf("%s %s", shellPath, strings.Join(shellOpts, " "))
		log.Printf("combined command is: %s", cmdCombined)
	}

	session, err := client.NewSession()
	if err != nil {
		return nil, err
	}

	remoteStdinRead, remoteStdinWriteOurs, err := os.Pipe()
	if err != nil {
		return nil, err
	}

	remoteStdoutReadOurs, remoteStdoutWrite, err := os.Pipe()
	if err != nil {
		return nil, err
	}

	pipePty := &PipePty{
		remoteStdinWrite: remoteStdinWriteOurs,
		remoteStdoutRead: remoteStdoutReadOurs,
	}
	if termSize.Rows == 0 || termSize.Cols == 0 {
		termSize.Rows = shellutil.DefaultTermRows
		termSize.Cols = shellutil.DefaultTermCols
	}
	if termSize.Rows <= 0 || termSize.Cols <= 0 {
		return nil, fmt.Errorf("invalid term size: %v", termSize)
	}
	session.Stdin = remoteStdinRead
	session.Stdout = remoteStdoutWrite
	session.Stderr = remoteStdoutWrite

	for envKey, envVal := range cmdOpts.Env {
		// note these might fail depending on server settings, but we still try
		session.Setenv(envKey, envVal)
	}

	if isZshShell(shellPath) {
		cmdCombined = fmt.Sprintf(`ZDOTDIR="%s/.waveterm/%s" %s`, homeDir, shellutil.ZshIntegrationDir, cmdCombined)
	}

	jwtToken, ok := cmdOpts.Env[wshutil.WaveJwtTokenVarName]
	if !ok {
		return nil, fmt.Errorf("no jwt token provided to connection")
	}

	if remote.IsPowershell(shellPath) {
		cmdCombined = fmt.Sprintf(`$env:%s="%s"; %s`, wshutil.WaveJwtTokenVarName, jwtToken, cmdCombined)
	} else {
		cmdCombined = fmt.Sprintf(`%s=%s %s`, wshutil.WaveJwtTokenVarName, jwtToken, cmdCombined)
	}

	session.RequestPty("xterm-256color", termSize.Rows, termSize.Cols, nil)

	sessionWrap := SessionWrap{session, cmdCombined, pipePty, pipePty}
	err = sessionWrap.Start()
	if err != nil {
		pipePty.Close()
		return nil, err
	}
	return &ShellProc{Cmd: sessionWrap, ConnName: conn.GetName(), CloseOnce: &sync.Once{}, DoneCh: make(chan any)}, nil
}

func isZshShell(shellPath string) bool {
	// get the base path, and then check contains
	shellBase := filepath.Base(shellPath)
	return strings.Contains(shellBase, "zsh")
}

func isBashShell(shellPath string) bool {
	// get the base path, and then check contains
	shellBase := filepath.Base(shellPath)
	return strings.Contains(shellBase, "bash")
}

func StartShellProc(termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType) (*ShellProc, error) {
	shellutil.InitCustomShellStartupFiles()
	var ecmd *exec.Cmd
	var shellOpts []string

	shellPath := shellutil.DetectLocalShellPath()
	if cmdStr == "" {
		if isBashShell(shellPath) {
			// add --rcfile
			// cant set -l or -i with --rcfile
			shellOpts = append(shellOpts, "--rcfile", shellutil.GetBashRcFileOverride())
		} else if remote.IsPowershell(shellPath) {
			shellOpts = append(shellOpts, "-NoExit", "-File", shellutil.GetWavePowershellEnv())
		} else {
			if cmdOpts.Login {
				shellOpts = append(shellOpts, "-l")
			}
			if cmdOpts.Interactive {
				shellOpts = append(shellOpts, "-i")
			}
		}
		ecmd = exec.Command(shellPath, shellOpts...)
		ecmd.Env = os.Environ()
		if isZshShell(shellPath) {
			shellutil.UpdateCmdEnv(ecmd, map[string]string{"ZDOTDIR": shellutil.GetZshZDotDir()})
		}
	} else {
		if cmdOpts.Login {
			shellOpts = append(shellOpts, "-l")
		}
		if cmdOpts.Interactive {
			shellOpts = append(shellOpts, "-i")
		}
		shellOpts = append(shellOpts, "-c", cmdStr)
		ecmd = exec.Command(shellPath, shellOpts...)
		ecmd.Env = os.Environ()
	}
	if cmdOpts.Cwd != "" {
		ecmd.Dir = cmdOpts.Cwd
	}
	if cwdErr := checkCwd(ecmd.Dir); cwdErr != nil {
		ecmd.Dir = wavebase.GetHomeDir()
	}
	envToAdd := shellutil.WaveshellLocalEnvVars(shellutil.DefaultTermType)
	if os.Getenv("LANG") == "" {
		envToAdd["LANG"] = wavebase.DetermineLang()
	}
	shellutil.UpdateCmdEnv(ecmd, envToAdd)
	shellutil.UpdateCmdEnv(ecmd, cmdOpts.Env)
	if termSize.Rows == 0 || termSize.Cols == 0 {
		termSize.Rows = shellutil.DefaultTermRows
		termSize.Cols = shellutil.DefaultTermCols
	}
	if termSize.Rows <= 0 || termSize.Cols <= 0 {
		return nil, fmt.Errorf("invalid term size: %v", termSize)
	}
	cmdPty, err := pty.StartWithSize(ecmd, &pty.Winsize{Rows: uint16(termSize.Rows), Cols: uint16(termSize.Cols)})
	if err != nil {
		cmdPty.Close()
		return nil, err
	}
	return &ShellProc{Cmd: CmdWrap{ecmd, cmdPty}, CloseOnce: &sync.Once{}, DoneCh: make(chan any)}, nil
}

func RunSimpleCmdInPty(ecmd *exec.Cmd, termSize waveobj.TermSize) ([]byte, error) {
	ecmd.Env = os.Environ()
	shellutil.UpdateCmdEnv(ecmd, shellutil.WaveshellLocalEnvVars(shellutil.DefaultTermType))
	if termSize.Rows == 0 || termSize.Cols == 0 {
		termSize.Rows = shellutil.DefaultTermRows
		termSize.Cols = shellutil.DefaultTermCols
	}
	if termSize.Rows <= 0 || termSize.Cols <= 0 {
		return nil, fmt.Errorf("invalid term size: %v", termSize)
	}
	cmdPty, err := pty.StartWithSize(ecmd, &pty.Winsize{Rows: uint16(termSize.Rows), Cols: uint16(termSize.Cols)})
	if err != nil {
		cmdPty.Close()
		return nil, err
	}
	if runtime.GOOS != "windows" {
		defer cmdPty.Close()
	}
	ioDone := make(chan bool)
	var outputBuf bytes.Buffer
	go func() {
		// ignore error (/dev/ptmx has read error when process is done)
		defer close(ioDone)
		io.Copy(&outputBuf, cmdPty)
	}()
	exitErr := ecmd.Wait()
	if exitErr != nil {
		return nil, exitErr
	}
	<-ioDone
	return outputBuf.Bytes(), nil
}
