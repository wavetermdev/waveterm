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
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/util/pamparse"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wsl"
)

const DefaultGracefulKillWait = 400 * time.Millisecond

type CommandOptsType struct {
	Interactive bool              `json:"interactive,omitempty"`
	Login       bool              `json:"login,omitempty"`
	Cwd         string            `json:"cwd,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
	ShellPath   string            `json:"shellPath,omitempty"`
	ShellOpts   []string          `json:"shellOpts,omitempty"`
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

func StartWslShellProc(ctx context.Context, termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType, conn *wsl.WslConn) (*ShellProc, error) {
	utilCtx, cancelFn := context.WithTimeout(ctx, 2*time.Second)
	defer cancelFn()
	client := conn.GetClient()
	shellPath := cmdOpts.ShellPath
	if shellPath == "" {
		remoteShellPath, err := wsl.DetectShell(utilCtx, client)
		if err != nil {
			return nil, err
		}
		shellPath = remoteShellPath
	}
	var shellOpts []string
	log.Printf("detected shell: %s", shellPath)

	err := wsl.InstallClientRcFiles(utilCtx, client)
	if err != nil {
		log.Printf("error installing rc files: %v", err)
		return nil, err
	}

	homeDir := wsl.GetHomeDir(utilCtx, client)
	shellOpts = append(shellOpts, "~", "-d", client.Name())

	var subShellOpts []string

	if cmdStr == "" {
		/* transform command in order to inject environment vars */
		if isBashShell(shellPath) {
			log.Printf("recognized as bash shell")
			// add --rcfile
			// cant set -l or -i with --rcfile
			subShellOpts = append(subShellOpts, "--rcfile", fmt.Sprintf(`%s/.waveterm/%s/.bashrc`, homeDir, shellutil.BashIntegrationDir))
		} else if isFishShell(shellPath) {
			carg := fmt.Sprintf(`"set -x PATH \"%s\"/.waveterm/%s $PATH"`, homeDir, shellutil.WaveHomeBinDir)
			subShellOpts = append(subShellOpts, "-C", carg)
		} else if wsl.IsPowershell(shellPath) {
			// powershell is weird about quoted path executables and requires an ampersand first
			shellPath = "& " + shellPath
			subShellOpts = append(subShellOpts, "-ExecutionPolicy", "Bypass", "-NoExit", "-File", fmt.Sprintf("%s/.waveterm/%s/wavepwsh.ps1", homeDir, shellutil.PwshIntegrationDir))
		} else {
			if cmdOpts.Login {
				subShellOpts = append(subShellOpts, "-l")
			}
			if cmdOpts.Interactive {
				subShellOpts = append(subShellOpts, "-i")
			}
			// can't set environment vars this way
			// will try to do later if possible
		}
	} else {
		shellPath = cmdStr
		if cmdOpts.Login {
			subShellOpts = append(subShellOpts, "-l")
		}
		if cmdOpts.Interactive {
			subShellOpts = append(subShellOpts, "-i")
		}
		subShellOpts = append(subShellOpts, "-c", cmdStr)
	}

	jwtToken, ok := cmdOpts.Env[wshutil.WaveJwtTokenVarName]
	if !ok {
		return nil, fmt.Errorf("no jwt token provided to connection")
	}
	if remote.IsPowershell(shellPath) {
		shellOpts = append(shellOpts, "--", fmt.Sprintf(`$env:%s=%s;`, wshutil.WaveJwtTokenVarName, jwtToken))
	} else {
		shellOpts = append(shellOpts, "--", fmt.Sprintf(`%s=%s`, wshutil.WaveJwtTokenVarName, jwtToken))
	}

	if isZshShell(shellPath) {
		shellOpts = append(shellOpts, fmt.Sprintf(`ZDOTDIR=%s/.waveterm/%s`, homeDir, shellutil.ZshIntegrationDir))
	}
	shellOpts = append(shellOpts, shellPath)
	shellOpts = append(shellOpts, subShellOpts...)
	log.Printf("full cmd is: %s %s", "wsl.exe", strings.Join(shellOpts, " "))

	ecmd := exec.Command("wsl.exe", shellOpts...)
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

func StartRemoteShellProcNoWsh(termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType, conn *conncontroller.SSHConn) (*ShellProc, error) {
	client := conn.GetClient()
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

	session.RequestPty("xterm-256color", termSize.Rows, termSize.Cols, nil)
	sessionWrap := MakeSessionWrap(session, "", pipePty)
	err = session.Shell()
	if err != nil {
		pipePty.Close()
		return nil, err
	}
	return &ShellProc{Cmd: sessionWrap, ConnName: conn.GetName(), CloseOnce: &sync.Once{}, DoneCh: make(chan any)}, nil
}

func StartRemoteShellProc(termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType, conn *conncontroller.SSHConn) (*ShellProc, error) {
	client := conn.GetClient()
	connRoute := wshutil.MakeConnectionRouteId(conn.GetName())
	rpcClient := wshclient.GetBareRpcClient()
	remoteInfo, err := wshclient.RemoteGetInfoCommand(rpcClient, &wshrpc.RpcOpts{Route: connRoute, Timeout: 2000})
	if err != nil {
		return nil, fmt.Errorf("unable to obtain client info: %w", err)
	}
	log.Printf("client info collected: %+#v", remoteInfo)

	shellPath := cmdOpts.ShellPath
	if shellPath == "" {
		shellPath = remoteInfo.Shell
	}
	var shellOpts []string
	var cmdCombined string
	log.Printf("using shell: %s", shellPath)

	err = wshclient.RemoteInstallRcFilesCommand(rpcClient, &wshrpc.RpcOpts{Route: connRoute, Timeout: 2000})
	if err != nil {
		log.Printf("error installing rc files: %v", err)
		return nil, err
	}
	shellOpts = append(shellOpts, cmdOpts.ShellOpts...)

	if cmdStr == "" {
		/* transform command in order to inject environment vars */
		if isBashShell(shellPath) {
			log.Printf("recognized as bash shell")
			// add --rcfile
			// cant set -l or -i with --rcfile
			bashPath := genconn.SoftQuote(fmt.Sprintf("~/.waveterm/%s/.bashrc", shellutil.BashIntegrationDir))
			shellOpts = append(shellOpts, "--rcfile", bashPath)
		} else if isFishShell(shellPath) {
			fishDir := genconn.SoftQuote(fmt.Sprintf("~/.waveterm/%s", shellutil.WaveHomeBinDir))
			carg := fmt.Sprintf(`"set -x PATH %s $PATH"`, fishDir)
			shellOpts = append(shellOpts, "-C", carg)
		} else if remote.IsPowershell(shellPath) {
			pwshPath := genconn.SoftQuote(fmt.Sprintf("~/.waveterm/%s/wavepwsh.ps1", shellutil.PwshIntegrationDir))
			// powershell is weird about quoted path executables and requires an ampersand first
			shellPath = "& " + shellPath
			shellOpts = append(shellOpts, "-ExecutionPolicy", "Bypass", "-NoExit", "-File", pwshPath)
		} else {
			if cmdOpts.Login {
				shellOpts = append(shellOpts, "-l")
			} else if cmdOpts.Interactive {
				shellOpts = append(shellOpts, "-i")
			}
			// zdotdir setting moved to after session is created
		}
		cmdCombined = fmt.Sprintf("%s %s", shellPath, strings.Join(shellOpts, " "))
		log.Printf("combined command is: %s", cmdCombined)
	} else {
		shellPath = cmdStr
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
		zshDir := genconn.SoftQuote(fmt.Sprintf("~/.waveterm/%s", shellutil.ZshIntegrationDir))
		cmdCombined = fmt.Sprintf(`ZDOTDIR=%s %s`, zshDir, cmdCombined)
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
	sessionWrap := MakeSessionWrap(session, cmdCombined, pipePty)
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

func isFishShell(shellPath string) bool {
	// get the base path, and then check contains
	shellBase := filepath.Base(shellPath)
	return strings.Contains(shellBase, "fish")
}

func StartShellProc(termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType) (*ShellProc, error) {
	shellutil.InitCustomShellStartupFiles()
	var ecmd *exec.Cmd
	var shellOpts []string
	shellPath := cmdOpts.ShellPath
	if shellPath == "" {
		shellPath = shellutil.DetectLocalShellPath()
	}
	shellOpts = append(shellOpts, cmdOpts.ShellOpts...)
	if cmdStr == "" {
		if isBashShell(shellPath) {
			// add --rcfile
			// cant set -l or -i with --rcfile
			shellOpts = append(shellOpts, "--rcfile", shellutil.GetBashRcFileOverride())
		} else if isFishShell(shellPath) {
			wshBinDir := filepath.Join(wavebase.GetWaveDataDir(), shellutil.WaveHomeBinDir)
			quotedWshBinDir := utilfn.ShellQuote(wshBinDir, false, 300)
			shellOpts = append(shellOpts, "-C", fmt.Sprintf("set -x PATH %s $PATH", quotedWshBinDir))
		} else if remote.IsPowershell(shellPath) {
			shellOpts = append(shellOpts, "-ExecutionPolicy", "Bypass", "-NoExit", "-File", shellutil.GetWavePowershellEnv())
		} else {
			if cmdOpts.Login {
				shellOpts = append(shellOpts, "-l")
			} else if cmdOpts.Interactive {
				shellOpts = append(shellOpts, "-i")
			}
		}
		ecmd = exec.Command(shellPath, shellOpts...)
		ecmd.Env = os.Environ()
		if isZshShell(shellPath) {
			shellutil.UpdateCmdEnv(ecmd, map[string]string{"ZDOTDIR": shellutil.GetZshZDotDir()})
		}
	} else {
		shellOpts = append(shellOpts, "-c", cmdStr)
		ecmd = exec.Command(shellPath, shellOpts...)
		ecmd.Env = os.Environ()
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
	for k, v := range envVars2 {
		envVars[k] = v
	}
	for k, v := range envVars3 {
		envVars[k] = v
	}
	return envVars
}
