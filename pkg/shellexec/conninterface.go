package shellexec

import (
	"io"
	"os/exec"

	"github.com/creack/pty"
	"golang.org/x/crypto/ssh"
)

type ConnInterface interface {
	Kill()
	Wait() error
	Start() error
	StdinPipe() (io.WriteCloser, error)
	StdoutPipe() (io.ReadCloser, error)
	StderrPipe() (io.ReadCloser, error)
	SetSize(w int, h int) error
	pty.Pty
}

type CmdWrap struct {
	Cmd *exec.Cmd
	pty.Pty
}

func (cw CmdWrap) Kill() {
	cw.Cmd.Process.Kill()
}

func (cw CmdWrap) Wait() error {
	return cw.Cmd.Wait()
}

func (cw CmdWrap) Start() error {
	defer func() {
		for _, extraFile := range cw.Cmd.ExtraFiles {
			if extraFile != nil {
				extraFile.Close()
			}
		}
	}()
	return cw.Cmd.Start()
}

func (cw CmdWrap) StdinPipe() (io.WriteCloser, error) {
	return cw.Cmd.StdinPipe()
}

func (cw CmdWrap) StdoutPipe() (io.ReadCloser, error) {
	return cw.Cmd.StdoutPipe()
}

func (cw CmdWrap) StderrPipe() (io.ReadCloser, error) {
	return cw.Cmd.StderrPipe()
}

func (cw CmdWrap) SetSize(w int, h int) error {
	err := pty.Setsize(cw.Pty, &pty.Winsize{Rows: uint16(w), Cols: uint16(h)})
	if err != nil {
		return err
	}
	return nil
}

type SessionWrap struct {
	Session  *ssh.Session
	StartCmd string
	Tty      pty.Tty
	pty.Pty
}

func (sw SessionWrap) Kill() {
	sw.Tty.Close()
	sw.Session.Close()
}

func (sw SessionWrap) Wait() error {
	return sw.Session.Wait()
}

func (sw SessionWrap) Start() error {
	return sw.Session.Start(sw.StartCmd)
}

func (sw SessionWrap) StdinPipe() (io.WriteCloser, error) {
	return sw.Session.StdinPipe()
}

func (sw SessionWrap) StdoutPipe() (io.ReadCloser, error) {
	stdoutReader, err := sw.Session.StdoutPipe()
	if err != nil {
		return nil, err
	}
	return io.NopCloser(stdoutReader), nil
}

func (sw SessionWrap) StderrPipe() (io.ReadCloser, error) {
	stderrReader, err := sw.Session.StderrPipe()
	if err != nil {
		return nil, err
	}
	return io.NopCloser(stderrReader), nil
}

func (sw SessionWrap) SetSize(h int, w int) error {
	return sw.Session.WindowChange(h, w)
}
