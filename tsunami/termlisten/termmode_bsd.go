// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin || dragonfly || freebsd || netbsd || openbsd

package termlisten

import (
	"golang.org/x/sys/unix"
	"golang.org/x/term"
)

// setTermMode puts fd into raw mode with ISIG kept: ECHO and ICANON are cleared
// so injected frames aren't echoed and large frames aren't truncated by the
// canonical-mode buffer, but ISIG is preserved so ^C/^Z still deliver signals.
func setTermMode(fd int) (*term.State, error) {
	oldState, err := term.GetState(fd)
	if err != nil {
		return nil, err
	}
	termios, err := unix.IoctlGetTermios(fd, unix.TIOCGETA)
	if err != nil {
		return nil, err
	}
	termios.Lflag &^= unix.ECHO | unix.ECHONL | unix.ICANON
	termios.Cc[unix.VMIN] = 1
	termios.Cc[unix.VTIME] = 0
	if err := unix.IoctlSetTermios(fd, unix.TIOCSETA, termios); err != nil {
		return nil, err
	}
	return oldState, nil
}
