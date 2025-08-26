// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"maps"

	"github.com/creack/pty"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/util/pamparse"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
)

const DefaultGracefulKillWait = 400 * time.Millisecond

type CommandOptsType struct {
	Interactive bool                      `json:"interactive,omitempty"`
	Login       bool                      `json:"login,omitempty"`
	Cwd         string                    `json:"cwd,omitempty"`
	ShellPath   string                    `json:"shellPath,omitempty"`
	ShellOpts   []string                  `json:"shellOpts,omitempty"`
	SwapToken   *shellutil.TokenSwapEntry `json:"swapToken,omitempty"`
	Env         map[string]string         `json:"env,omitempty"`
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
		defer func() {
			panichandler.PanicHandler("ShellProc.Close", recover())
		}()
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

func makeEnvPrefix(env map[string]string) string {
	if len(env) == 0 {
		return ""
	}
	var envParts []string
	for key, value := range env {
		envParts = append(envParts, fmt.Sprintf(`%s=%s`, key, shellutil.HardQuote(value)))
	}
	return strings.Join(envParts, " ") + " "
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

func StartWslShellProcNoWsh(ctx context.Context, termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType, conn *wslconn.WslConn) (*ShellProc, error) {
	client := conn.GetClient()
	conn.Infof(ctx, "WSL-NEWSESSION (StartWslShellProcNoWsh)")

	ecmd := exec.Command("wsl.exe", "~", "-d", client.Name())
	ecmd.Env = os.Environ()
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
		return nil, err
	}
	cmdWrap := MakeCmdWrap(ecmd, cmdPty)
	return &ShellProc{Cmd: cmdWrap, ConnName: conn.GetName(), CloseOnce: &sync.Once{}, DoneCh: make(chan any)}, nil
}

func StartWslShellProc(ctx context.Context, termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType, conn *wslconn.WslConn) (*ShellProc, error) {
	client := conn.GetClient()
	conn.Infof(ctx, "WSL-NEWSESSION (StartWslShellProc)")
	connRoute := wshutil.MakeConnectionRouteId(conn.GetName())
	rpcClient := wshclient.GetBareRpcClient()
	remoteInfo, err := wshclient.RemoteGetInfoCommand(rpcClient, &wshrpc.RpcOpts{Route: connRoute, Timeout: 2000})
	if err != nil {
		return nil, fmt.Errorf("unable to obtain client info: %w", err)
	}
	log.Printf("client info collected: %+#v", remoteInfo)
	var shellPath string
	if cmdOpts.ShellPath != "" {
		conn.Infof(ctx, "using shell path from command opts: %s\n", cmdOpts.ShellPath)
		shellPath = cmdOpts.ShellPath
	}
	configShellPath := conn.GetConfigShellPath()
	if shellPath == "" && configShellPath != "" {
		conn.Infof(ctx, "using shell path from config (conn:shellpath): %s\n", configShellPath)
		shellPath = configShellPath
	}
	if shellPath == "" && remoteInfo.Shell != "" {
		conn.Infof(ctx, "using shell path detected on remote machine: %s\n", remoteInfo.Shell)
		shellPath = remoteInfo.Shell
	}
	if shellPath == "" {
		conn.Infof(ctx, "no shell path detected, using default (/bin/bash)\n")
		shellPath = "/bin/bash"
	}
	var shellOpts []string
	var cmdCombined string
	log.Printf("detected shell %q for conn %q\n", shellPath, conn.GetName())

	err = wshclient.RemoteInstallRcFilesCommand(rpcClient, &wshrpc.RpcOpts{Route: connRoute, Timeout: 2000})
	if err != nil {
		log.Printf("error installing rc files: %v", err)
		return nil, err
	}
	shellOpts = append(shellOpts, cmdOpts.ShellOpts...)
	shellType := shellutil.GetShellTypeFromShellPath(shellPath)
	conn.Infof(ctx, "detected shell type: %s\n", shellType)

	if cmdStr == "" {
		/* transform command in order to inject environment vars */
		if shellType == shellutil.ShellType_bash {
			// add --rcfile
			// cant set -l or -i with --rcfile
			bashPath := fmt.Sprintf("~/.waveterm/%s/.bashrc", shellutil.BashIntegrationDir)
			shellOpts = append(shellOpts, "--rcfile", bashPath)
		} else if shellType == shellutil.ShellType_fish {
			if cmdOpts.Login {
				shellOpts = append(shellOpts, "-l")
			}
			// source the wave.fish file
			waveFishPath := fmt.Sprintf("~/.waveterm/%s/wave.fish", shellutil.FishIntegrationDir)
			carg := fmt.Sprintf(`"source %s"`, waveFishPath)
			shellOpts = append(shellOpts, "-C", carg)
		} else if shellType == shellutil.ShellType_pwsh {
			pwshPath := fmt.Sprintf("~/.waveterm/%s/wavepwsh.ps1", shellutil.PwshIntegrationDir)
			// powershell is weird about quoted path executables and requires an ampersand first
			shellPath = "& " + shellPath
			shellOpts = append(shellOpts, "-ExecutionPolicy", "Bypass", "-NoExit", "-File", pwshPath)
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
	} else {
		// TODO check quoting of cmdStr
		shellPath = cmdStr
		shellOpts = append(shellOpts, "-c", cmdStr)
		cmdCombined = fmt.Sprintf("%s %s", shellPath, strings.Join(shellOpts, " "))
	}
	conn.Infof(ctx, "starting shell, using command: %s\n", cmdCombined)
	conn.Infof(ctx, "WSL-NEWSESSION (StartWslShellProc)\n")

	if shellType == shellutil.ShellType_zsh {
		zshDir := fmt.Sprintf("~/.waveterm/%s", shellutil.ZshIntegrationDir)
		conn.Infof(ctx, "setting ZDOTDIR to %s\n", zshDir)
		cmdCombined = fmt.Sprintf(`ZDOTDIR=%s %s`, zshDir, cmdCombined)
	}
	packedToken, err := cmdOpts.SwapToken.PackForClient()
	if err != nil {
		conn.Infof(ctx, "error packing swap token: %v", err)
	} else {
		conn.Debugf(ctx, "packed swaptoken %s\n", packedToken)
		cmdCombined = fmt.Sprintf(`%s=%s %s`, wavebase.WaveSwapTokenVarName, packedToken, cmdCombined)
	}
	jwtToken := cmdOpts.SwapToken.Env[wavebase.WaveJwtTokenVarName]
	if jwtToken != "" {
		cmdCombined = fmt.Sprintf(`%s=%s %s`, wavebase.WaveJwtTokenVarName, jwtToken, cmdCombined)
	}
	log.Printf("full combined command: %s", cmdCombined)
	ecmd := exec.Command("wsl.exe", "~", "-d", client.Name(), "--", "sh", "-c", cmdCombined)
	ecmd.Env = os.Environ()
	shellutil.UpdateCmdEnv(ecmd, cmdOpts.Env)
	if termSize.Rows == 0 || termSize.Cols == 0 {
		termSize.Rows = shellutil.DefaultTermRows
		termSize.Cols = shellutil.DefaultTermCols
	}
	if termSize.Rows <= 0 || termSize.Cols <= 0 {
		return nil, fmt.Errorf("invalid term size: %v", termSize)
	}
	shellutil.AddTokenSwapEntry(cmdOpts.SwapToken)
	cmdPty, err := pty.StartWithSize(ecmd, &pty.Winsize{Rows: uint16(termSize.Rows), Cols: uint16(termSize.Cols)})
	if err != nil {
		return nil, err
	}
	cmdWrap := MakeCmdWrap(ecmd, cmdPty)
	return &ShellProc{Cmd: cmdWrap, ConnName: conn.GetName(), CloseOnce: &sync.Once{}, DoneCh: make(chan any)}, nil
}

func StartRemoteShellProcNoWsh(ctx context.Context, termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType, conn *conncontroller.SSHConn) (*ShellProc, error) {
	client := conn.GetClient()
	conn.Infof(ctx, "SSH-NEWSESSION (StartRemoteShellProcNoWsh)")
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

	envPrefix := makeEnvPrefix(cmdOpts.Env)
	shellCmd := fmt.Sprintf("%s$SHELL", envPrefix)

	session.RequestPty("xterm-256color", termSize.Rows, termSize.Cols, nil)
	sessionWrap := MakeSessionWrap(session, shellCmd, pipePty)
	err = sessionWrap.Start()
	if err != nil {
		pipePty.Close()
		return nil, err
	}
	return &ShellProc{Cmd: sessionWrap, ConnName: conn.GetName(), CloseOnce: &sync.Once{}, DoneCh: make(chan any)}, nil
}

func StartRemoteShellProc(ctx context.Context, logCtx context.Context, termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType, conn *conncontroller.SSHConn) (*ShellProc, error) {
	client := conn.GetClient()
	connRoute := wshutil.MakeConnectionRouteId(conn.GetName())
	rpcClient := wshclient.GetBareRpcClient()
	remoteInfo, err := wshclient.RemoteGetInfoCommand(rpcClient, &wshrpc.RpcOpts{Route: connRoute, Timeout: 2000})
	if err != nil {
		return nil, fmt.Errorf("unable to obtain client info: %w", err)
	}
	log.Printf("client info collected: %+#v", remoteInfo)
	var shellPath string
	if cmdOpts.ShellPath != "" {
		conn.Infof(logCtx, "using shell path from command opts: %s\n", cmdOpts.ShellPath)
		shellPath = cmdOpts.ShellPath
	}
	configShellPath := conn.GetConfigShellPath()
	if shellPath == "" && configShellPath != "" {
		conn.Infof(logCtx, "using shell path from config (conn:shellpath): %s\n", configShellPath)
		shellPath = configShellPath
	}
	if shellPath == "" && remoteInfo.Shell != "" {
		conn.Infof(logCtx, "using shell path detected on remote machine: %s\n", remoteInfo.Shell)
		shellPath = remoteInfo.Shell
	}
	if shellPath == "" {
		conn.Infof(logCtx, "no shell path detected, using default (/bin/bash)\n")
		shellPath = "/bin/bash"
	}
	var shellOpts []string
	var cmdCombined string
	log.Printf("detected shell %q for conn %q\n", shellPath, conn.GetName())
	shellOpts = append(shellOpts, cmdOpts.ShellOpts...)
	shellType := shellutil.GetShellTypeFromShellPath(shellPath)
	conn.Infof(logCtx, "detected shell type: %s\n", shellType)
	conn.Infof(logCtx, "swaptoken: %s\n", cmdOpts.SwapToken.Token)

	if cmdStr == "" {
		/* transform command in order to inject environment vars */
		if shellType == shellutil.ShellType_bash {
			// add --rcfile
			// cant set -l or -i with --rcfile
			bashPath := fmt.Sprintf("~/.waveterm/%s/.bashrc", shellutil.BashIntegrationDir)
			shellOpts = append(shellOpts, "--rcfile", bashPath)
		} else if shellType == shellutil.ShellType_fish {
			if cmdOpts.Login {
				shellOpts = append(shellOpts, "-l")
			}
			// source the wave.fish file
			waveFishPath := fmt.Sprintf("~/.waveterm/%s/wave.fish", shellutil.FishIntegrationDir)
			carg := fmt.Sprintf(`"source %s"`, waveFishPath)
			shellOpts = append(shellOpts, "-C", carg)
		} else if shellType == shellutil.ShellType_pwsh {
			pwshPath := fmt.Sprintf("~/.waveterm/%s/wavepwsh.ps1", shellutil.PwshIntegrationDir)
			// powershell is weird about quoted path executables and requires an ampersand first
			shellPath = "& " + shellPath
			shellOpts = append(shellOpts, "-ExecutionPolicy", "Bypass", "-NoExit", "-File", pwshPath)
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
	} else {
		// TODO check quoting of cmdStr
		shellPath = cmdStr
		shellOpts = append(shellOpts, "-c", cmdStr)
		cmdCombined = fmt.Sprintf("%s %s", shellPath, strings.Join(shellOpts, " "))
	}
	conn.Infof(logCtx, "starting shell, using command: %s\n", cmdCombined)
	conn.Infof(logCtx, "SSH-NEWSESSION (StartRemoteShellProc)\n")
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
	if shellType == shellutil.ShellType_zsh {
		zshDir := fmt.Sprintf("~/.waveterm/%s", shellutil.ZshIntegrationDir)
		conn.Infof(logCtx, "setting ZDOTDIR to %s\n", zshDir)
		cmdCombined = fmt.Sprintf(`ZDOTDIR=%s %s`, zshDir, cmdCombined)
	}
	packedToken, err := cmdOpts.SwapToken.PackForClient()
	if err != nil {
		conn.Infof(logCtx, "error packing swap token: %v", err)
	} else {
		conn.Debugf(logCtx, "packed swaptoken %s\n", packedToken)
		cmdCombined = fmt.Sprintf(`%s=%s %s`, wavebase.WaveSwapTokenVarName, packedToken, cmdCombined)
	}
	envPrefix := makeEnvPrefix(cmdOpts.Env)
	cmdCombined = fmt.Sprintf("%s%s", envPrefix, cmdCombined)

	shellutil.AddTokenSwapEntry(cmdOpts.SwapToken)
	session.RequestPty("xterm-256color", termSize.Rows, termSize.Cols, nil)
	sessionWrap := MakeSessionWrap(session, cmdCombined, pipePty)
	err = sessionWrap.Start()
	if err != nil {
		pipePty.Close()
		return nil, err
	}
	return &ShellProc{Cmd: sessionWrap, ConnName: conn.GetName(), CloseOnce: &sync.Once{}, DoneCh: make(chan any)}, nil
}

func StartLocalShellProc(logCtx context.Context, termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType) (*ShellProc, error) {
	shellutil.InitCustomShellStartupFiles()
	var ecmd *exec.Cmd
	var shellOpts []string
	shellPath := cmdOpts.ShellPath
	if shellPath == "" {
		shellPath = shellutil.DetectLocalShellPath()
	}
	shellType := shellutil.GetShellTypeFromShellPath(shellPath)
	shellOpts = append(shellOpts, cmdOpts.ShellOpts...)
	if cmdStr == "" {
		if shellType == shellutil.ShellType_bash {
			// add --rcfile
			// cant set -l or -i with --rcfile
			shellOpts = append(shellOpts, "--rcfile", shellutil.GetLocalBashRcFileOverride())
		} else if shellType == shellutil.ShellType_fish {
			if cmdOpts.Login {
				shellOpts = append(shellOpts, "-l")
			}
			waveFishPath := shellutil.GetLocalWaveFishFilePath()
			carg := fmt.Sprintf("source %s", shellutil.HardQuoteFish(waveFishPath))
			shellOpts = append(shellOpts, "-C", carg)
		} else if shellType == shellutil.ShellType_pwsh {
			shellOpts = append(shellOpts, "-ExecutionPolicy", "Bypass", "-NoExit", "-File", shellutil.GetLocalWavePowershellEnv())
		} else {
			if cmdOpts.Login {
				shellOpts = append(shellOpts, "-l")
			}
			if cmdOpts.Interactive {
				shellOpts = append(shellOpts, "-i")
			}
		}
		blocklogger.Debugf(logCtx, "[conndebug] shell:%s shellOpts:%v\n", shellPath, shellOpts)
		ecmd = exec.Command(shellPath, shellOpts...)
		ecmd.Env = os.Environ()
		shellutil.UpdateCmdEnv(ecmd, cmdOpts.Env)
		if shellType == shellutil.ShellType_zsh {
			shellutil.UpdateCmdEnv(ecmd, map[string]string{"ZDOTDIR": shellutil.GetLocalZshZDotDir()})
		}
	} else {
		shellOpts = append(shellOpts, "-c", cmdStr)
		ecmd = exec.Command(shellPath, shellOpts...)
		ecmd.Env = os.Environ()
		shellutil.UpdateCmdEnv(ecmd, cmdOpts.Env)
	}

	packedToken, err := cmdOpts.SwapToken.PackForClient()
	if err != nil {
		blocklogger.Infof(logCtx, "error packing swap token: %v", err)
	} else {
		blocklogger.Debugf(logCtx, "packed swaptoken %s\n", packedToken)
		shellutil.UpdateCmdEnv(ecmd, map[string]string{wavebase.WaveSwapTokenVarName: packedToken})
	}

	/*
	  For Snap installations, we need to correct the XDG environment variables as Snap
	  overrides them to point to snap directories. We will get the correct values, if
	  set, from the PAM environment. If the XDG variables are set in profile or in an
	  RC file, it will be overridden when the shell initializes.
	*/
	if os.Getenv("SNAP") != "" {
		log.Printf("Detected Snap installation, correcting XDG environment variables")
		varsToReplace := map[string]string{"XDG_CONFIG_HOME": "", "XDG_DATA_HOME": "", "XDG_CACHE_HOME": "", "XDG_RUNTIME_DIR": "", "XDG_CONFIG_DIRS": "", "XDG_DATA_DIRS": ""}
		pamEnvs := tryGetPamEnvVars()
		if len(pamEnvs) > 0 {
			// We only want to set the XDG variables from the PAM environment, all others should already be correct or may have been overridden by something else out of our control
			for k := range pamEnvs {
				if _, ok := varsToReplace[k]; ok {
					varsToReplace[k] = pamEnvs[k]
				}
			}
		}
		log.Printf("Setting XDG environment variables to: %v", varsToReplace)
		shellutil.UpdateCmdEnv(ecmd, varsToReplace)
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
	if termSize.Rows == 0 || termSize.Cols == 0 {
		termSize.Rows = shellutil.DefaultTermRows
		termSize.Cols = shellutil.DefaultTermCols
	}
	if termSize.Rows <= 0 || termSize.Cols <= 0 {
		return nil, fmt.Errorf("invalid term size: %v", termSize)
	}
	shellutil.AddTokenSwapEntry(cmdOpts.SwapToken)
	cmdPty, err := pty.StartWithSize(ecmd, &pty.Winsize{Rows: uint16(termSize.Rows), Cols: uint16(termSize.Cols)})
	if err != nil {
		return nil, err
	}
	cmdWrap := MakeCmdWrap(ecmd, cmdPty)
	return &ShellProc{Cmd: cmdWrap, CloseOnce: &sync.Once{}, DoneCh: make(chan any)}, nil
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
		panichandler.PanicHandler("RunSimpleCmdInPty:ioCopy", recover())
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

const etcEnvironmentPath = "/etc/environment"
const etcSecurityPath = "/etc/security/pam_env.conf"
const userEnvironmentPath = "~/.pam_environment"

var pamParseOpts *pamparse.PamParseOpts = pamparse.ParsePasswdSafe()

/*
tryGetPamEnvVars tries to get the environment variables from /etc/environment,
/etc/security/pam_env.conf, and ~/.pam_environment.

It then returns a map of the environment variables, overriding duplicates with
the following order of precedence:
1. /etc/environment
2. /etc/security/pam_env.conf
3. ~/.pam_environment
*/
func tryGetPamEnvVars() map[string]string {
	envVars, err := pamparse.ParseEnvironmentFile(etcEnvironmentPath)
	if err != nil {
		log.Printf("error parsing %s: %v", etcEnvironmentPath, err)
	}
	envVars2, err := pamparse.ParseEnvironmentConfFile(etcSecurityPath, pamParseOpts)
	if err != nil {
		log.Printf("error parsing %s: %v", etcSecurityPath, err)
	}
	envVars3, err := pamparse.ParseEnvironmentConfFile(wavebase.ExpandHomeDirSafe(userEnvironmentPath), pamParseOpts)
	if err != nil {
		log.Printf("error parsing %s: %v", userEnvironmentPath, err)
	}
	maps.Copy(envVars, envVars2)
	maps.Copy(envVars, envVars3)
	if runtime_dir, ok := envVars["XDG_RUNTIME_DIR"]; !ok || runtime_dir == "" {
		envVars["XDG_RUNTIME_DIR"] = "/run/user/" + fmt.Sprint(os.Getuid())
	}
	return envVars
}
