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
	"strings"

	"github.com/google/uuid"
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
const MShellVersion = "0.1.0"

const OSCEscError = "error"

type CommandFileNames struct {
	PtyOutFile    string
	StdinFifo     string
	RunnerOutFile string
}

type CommandKey string

func MakeCommandKey(sessionId string, cmdId string) CommandKey {
	if sessionId == "" && cmdId == "" {
		return CommandKey("")
	}
	return CommandKey(fmt.Sprintf("%s/%s", sessionId, cmdId))
}

func (ckey CommandKey) IsEmpty() bool {
	return string(ckey) == ""
}

func (ckey CommandKey) GetSessionId() string {
	slashIdx := strings.Index(string(ckey), "/")
	if slashIdx == -1 {
		return ""
	}
	return string(ckey[0:slashIdx])
}

func (ckey CommandKey) GetCmdId() string {
	slashIdx := strings.Index(string(ckey), "/")
	if slashIdx == -1 {
		return ""
	}
	return string(ckey[slashIdx+1:])
}

func (ckey CommandKey) Split() (string, string) {
	fields := strings.SplitN(string(ckey), "/", 2)
	if len(fields) < 2 {
		return "", ""
	}
	return fields[0], fields[1]
}

func (ckey CommandKey) Validate(typeStr string) error {
	if typeStr == "" {
		typeStr = "ck"
	}
	if ckey == "" {
		return fmt.Errorf("%s has empty commandkey", typeStr)
	}
	sessionId, cmdId := ckey.Split()
	if sessionId == "" {
		return fmt.Errorf("%s does not have sessionid", typeStr)
	}
	_, err := uuid.Parse(sessionId)
	if err != nil {
		return fmt.Errorf("%s has invalid sessionid '%s'", typeStr, sessionId)
	}
	if cmdId == "" {
		return fmt.Errorf("%s does not have cmdid", typeStr)
	}
	_, err = uuid.Parse(cmdId)
	if err != nil {
		return fmt.Errorf("%s has invalid cmdid '%s'", typeStr, cmdId)
	}
	return nil
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

func GetCommandFileNames(ck CommandKey) (*CommandFileNames, error) {
	if err := ck.Validate("ck"); err != nil {
		return nil, fmt.Errorf("cannot get command files: %w", err)
	}
	sessionId, cmdId := ck.Split()
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

func MakeCommandFileNamesWithHome(scHome string, ck CommandKey) *CommandFileNames {
	base := path.Join(scHome, SessionsDirBaseName, ck.GetSessionId(), ck.GetCmdId())
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

func ExpandHomeDir(pathStr string) string {
	if pathStr != "~" && !strings.HasPrefix(pathStr, "~/") {
		return pathStr
	}
	homeDir := GetHomeDir()
	if pathStr == "~" {
		return homeDir
	}
	return path.Join(homeDir, pathStr[2:])
}

func ValidGoArch(goos string, goarch string) bool {
	return (goos == "darwin" || goos == "linux") && (goarch == "amd64" || goarch == "arm64")
}

func GoArchOptFile(goos string, goarch string) string {
	return fmt.Sprintf("/opt/mshell/bin/mshell.%s.%s", goos, goarch)
}
