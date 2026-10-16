// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package remotedesktop launches native viewers without shell interpolation or
// passwords in argv, the environment, configuration, or diagnostics.
package remotedesktop

import (
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

type Profile struct {
	Name     string `json:"name"`
	Protocol string `json:"protocol"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username,omitempty"`
	Domain   string `json:"domain,omitempty"`
}
type Session struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Running bool   `json:"running"`
	Message string `json:"message"`
}
type Launcher struct {
	mu        sync.Mutex
	next      int
	sessions  map[string]Session
	processes map[string]*os.Process
}

var Default = &Launcher{sessions: make(map[string]Session), processes: make(map[string]*os.Process)}

func (p Profile) Args() ([]string, error) {
	if p.Protocol != "rdp" && p.Protocol != "vnc" {
		return nil, errors.New("choose RDP or VNC")
	}
	if p.Port < 1 || p.Port > 65535 {
		return nil, errors.New("port must be between 1 and 65535")
	}
	if p.Host == "" || len(p.Host) > 253 || strings.ContainsAny(p.Host, " /\\\t\r\n@?=#\x00") || strings.HasPrefix(p.Host, "-") {
		return nil, errors.New("enter a hostname or an IP address without a port or URL")
	}
	if net.ParseIP(p.Host) == nil {
		for _, label := range strings.Split(p.Host, ".") {
			if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
				return nil, errors.New("invalid hostname")
			}
			for _, c := range label {
				if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
					return nil, errors.New("invalid hostname")
				}
			}
		}
	}
	for _, s := range []string{p.Name, p.Username, p.Domain} {
		if strings.ContainsAny(s, "\x00\r\n") || len(s) > 255 {
			return nil, errors.New("invalid connection field")
		}
	}
	if p.Protocol == "vnc" {
		return []string{vncAddress(p.Host, p.Port)}, nil
	}
	if p.Username == "" {
		return nil, errors.New("RDP username is required")
	}
	domain := p.Domain
	if domain == "" {
		domain = "."
	}
	return []string{"/v:" + net.JoinHostPort(p.Host, strconv.Itoa(p.Port)), "/u:" + p.Username, "/d:" + domain, "/from-stdin:force", "/dynamic-resolution", "/cert:deny", "/log-level:ERROR"}, nil
}
func (l *Launcher) Start(p Profile, password string) (Session, error) {
	args, err := p.Args()
	if err != nil {
		return Session{}, err
	}
	if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
		return Session{}, errors.New("native remote desktops require a local graphical desktop")
	}
	if strings.ContainsAny(password, "\x00\r\n") || len(password) > 511 {
		return Session{}, errors.New("password must be a single line of at most 511 bytes")
	}
	names := []string{"vncviewer"}
	if p.Protocol == "rdp" {
		names = []string{"xfreerdp3", "xfreerdp"}
		if password == "" {
			return Session{}, errors.New("enter the RDP password; it is sent through stdin and never saved")
		}
	}
	var binary string
	for _, name := range names {
		if path, e := exec.LookPath(name); e == nil {
			binary = path
			break
		}
	}
	if binary == "" {
		return Session{}, fmt.Errorf("native viewer missing: install %s", strings.Join(names, " or "))
	}
	cmd := exec.Command(binary, args...)
	if p.Protocol == "rdp" {
		cmd.Stdin = strings.NewReader(password + "\n")
	}
	// Native viewers display their own UI; console output can include private data.
	if err = cmd.Start(); err != nil {
		return Session{}, errors.New("could not launch native desktop viewer")
	}
	l.mu.Lock()
	l.next++
	id := strconv.Itoa(l.next)
	s := Session{ID: id, Name: p.Name, Running: true, Message: "Viewer running; connection status is shown in its window"}
	l.sessions[id] = s
	l.processes[id] = cmd.Process
	l.mu.Unlock()
	go func() {
		err := cmd.Wait()
		l.mu.Lock()
		defer l.mu.Unlock()
		s := l.sessions[id]
		s.Running = false
		s.Message = "Viewer closed"
		if err != nil {
			s.Message = "Viewer exited with an error; verify credentials, reachability, and the server certificate"
		}
		l.sessions[id] = s
		delete(l.processes, id)
	}()
	return s, nil
}
func (l *Launcher) Sessions() []Session {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := []Session{}
	for _, s := range l.sessions {
		out = append(out, s)
	}
	return out
}
func (l *Launcher) Stop(id string) error {
	l.mu.Lock()
	p := l.processes[id]
	l.mu.Unlock()
	if p == nil {
		return errors.New("viewer is no longer running")
	}
	if err := p.Kill(); err != nil {
		return errors.New("could not stop viewer")
	}
	return nil
}

func vncAddress(host string, port int) string {
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return host + "::" + strconv.Itoa(port)
}
