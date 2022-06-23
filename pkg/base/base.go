// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package base

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
)

const DefaultMShellPath = "mshell"
const DefaultUserMShellPath = ".mshell/mshell"
const MShellPathVarName = "MSHELL_PATH"
const SSHCommandVarName = "SSH_COMMAND"
const ScHomeVarName = "SCRIPTHAUS_HOME"
const HomeVarName = "HOME"
const ScShell = "bash"
const SessionsDirBaseName = ".sessions"
const RunnerBaseName = "runner"
const SessionDBName = "session.db"
const ScReadyString = "scripthaus runner ready"

const OSCEscError = "error"

type CommandFileNames struct {
	PtyOutFile    string
	StdinFifo     string
	RunnerOutFile string
}

func GetHomeDir() string {
	homeVar := os.Getenv(HomeVarName)
	if homeVar == "" {
		return "/"
	}
	return homeVar
}

func GetScHomeDir() (string, error) {
	scHome := os.Getenv(ScHomeVarName)
	if scHome == "" {
		homeVar := os.Getenv(HomeVarName)
		if homeVar == "" {
			return "", fmt.Errorf("Cannot resolve scripthaus home directory (SCRIPTHAUS_HOME and HOME not set)")
		}
		scHome = path.Join(homeVar, "scripthaus")
	}
	return scHome, nil
}

func GetCommandFileNames(sessionId string, cmdId string) (*CommandFileNames, error) {
	if sessionId == "" || cmdId == "" {
		return nil, fmt.Errorf("cannot get command-files when sessionid or cmdid is empty")
	}
	sdir, err := EnsureSessionDir(sessionId)
	if err != nil {
		return nil, err
	}
	base := path.Join(sdir, cmdId)
	return &CommandFileNames{
		PtyOutFile:    base + ".ptyout",
		StdinFifo:     base + ".stdin",
		RunnerOutFile: base + ".runout",
	}, nil
}

func MakeCommandFileNamesWithHome(scHome string, sessionId string, cmdId string) *CommandFileNames {
	base := path.Join(scHome, SessionsDirBaseName, sessionId, cmdId)
	return &CommandFileNames{
		PtyOutFile:    base + ".ptyout",
		StdinFifo:     base + ".stdin",
		RunnerOutFile: base + ".runout",
	}
}

func CleanUpCmdFiles(sessionId string, cmdId string) error {
	if cmdId == "" {
		return fmt.Errorf("bad cmdid, cannot clean up")
	}
	sdir, err := EnsureSessionDir(sessionId)
	if err != nil {
		return err
	}
	cmdFileGlob := path.Join(sdir, cmdId+".*")
	matches, err := filepath.Glob(cmdFileGlob)
	if err != nil {
		return err
	}
	for _, file := range matches {
		rmErr := os.Remove(file)
		if err == nil && rmErr != nil {
			err = rmErr
		}
	}
	return err
}

func EnsureSessionDir(sessionId string) (string, error) {
	if sessionId == "" {
		return "", fmt.Errorf("Bad sessionid, cannot be empty")
	}
	shhome, err := GetScHomeDir()
	if err != nil {
		return "", err
	}
	sdir := path.Join(shhome, SessionsDirBaseName, sessionId)
	info, err := os.Stat(sdir)
	if errors.Is(err, fs.ErrNotExist) {
		err = os.MkdirAll(sdir, 0777)
		if err != nil {
			return "", err
		}
		info, err = os.Stat(sdir)
	}
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("session dir '%s' must be a directory", sdir)
	}
	return sdir, nil
}

func GetMShellPath() (string, error) {
	msPath := os.Getenv(MShellPathVarName)
	if msPath != "" {
		return exec.LookPath(msPath)
	}
	userMShellPath := path.Join(GetHomeDir(), DefaultUserMShellPath)
	msPath, err := exec.LookPath(userMShellPath)
	if err != nil {
		return msPath, nil
	}
	return exec.LookPath(DefaultMShellPath)
}

func GetScSessionsDir() (string, error) {
	scHome, err := GetScHomeDir()
	if err != nil {
		return "", err
	}
	return path.Join(scHome, SessionsDirBaseName), nil
}

func GetSessionDBName(sessionId string) (string, error) {
	scHome, err := GetScHomeDir()
	if err != nil {
		return "", err
	}
	return path.Join(scHome, SessionDBName), nil
}

// SH OSC Escapes (code 198, S=19, H=8)
//   \e]198;cmdid;(cmd-id)BEL - return command-id to server
//   \e]198;remote;0BEL       - runner program not available
//   \e]198;remote;1BEL       - runner program is available
//   \e]198;error;(error-str)BEL - communicate an internal error
func MakeSHOSCEsc(escName string, data string) string {
	return fmt.Sprintf("\033]198;%s;%s\007", escName, data)
}

func WriteErrorMsg(fileName string, errVal string) error {
	fd, err := os.OpenFile(fileName, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	oscEsc := MakeSHOSCEsc(OSCEscError, errVal)
	_, writeErr := fd.Write([]byte(oscEsc))
	return writeErr
}
