// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package base

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path"
	"strings"
	"sync"

	"github.com/google/uuid"
	"golang.org/x/mod/semver"
)

const HomeVarName = "HOME"
const DefaultMShellHome = "~/.mshell"
const DefaultMShellName = "mshell"
const MShellPathVarName = "MSHELL_PATH"
const MShellHomeVarName = "MSHELL_HOME"
const MShellInstallBinVarName = "MSHELL_INSTALLBIN_PATH"
const SSHCommandVarName = "SSH_COMMAND"
const MShellDebugVarName = "MSHELL_DEBUG"
const SessionsDirBaseName = "sessions"
const RcFilesDirBaseName = "rcfiles"
const MShellVersion = "v0.5.0"
const RemoteIdFile = "remoteid"
const DefaultMShellInstallBinDir = "/opt/mshell/bin"
const LogFileName = "mshell.log"
const ForceDebugLog = false

const DebugFlag_LogRcFile = "logrc"
const DebugRcFileName = "debug.rcfile"
const DebugReturnStateFileName = "debug.returnstate"

const (
	ProcessType_Unknown         = "unknown"
	ProcessType_WaveSrv         = "wavesrv"
	ProcessType_WaveShellSingle = "wsh-1"
	ProcessType_WaveShellServer = "wsh-s"
)

// keys are sessionids (also the key RcFilesDirBaseName)
var ensureDirCache = make(map[string]bool)
var baseLock = &sync.Mutex{}
var DebugLogEnabled = false
var DebugLogger *log.Logger
var BuildTime string = "0"

var ProcessType string = ProcessType_Unknown

type CommandFileNames struct {
	PtyOutFile    string
	StdinFifo     string
	RunnerOutFile string
}

type CommandKey string

func SetBuildTime(build string) {
	BuildTime = build
}

func IsWaveSrv() bool {
	return ProcessType == ProcessType_WaveSrv
}

func MakeCommandKey(sessionId string, cmdId string) CommandKey {
	if sessionId == "" && cmdId == "" {
		return CommandKey("")
	}
	return CommandKey(fmt.Sprintf("%s/%s", sessionId, cmdId))
}

func (ckey CommandKey) IsEmpty() bool {
	return string(ckey) == ""
}

func Logf(fmtStr string, args ...interface{}) {
	if (!DebugLogEnabled && !ForceDebugLog) || DebugLogger == nil {
		return
	}
	DebugLogger.Printf(fmtStr, args...)
}

func InitDebugLog(prefix string) {
	homeDir := GetMShellHomeDir()
	err := os.MkdirAll(homeDir, 0777)
	if err != nil {
		return
	}
	logFile := path.Join(homeDir, LogFileName)
	fd, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return
	}
	DebugLogger = log.New(fd, prefix+" ", log.LstdFlags)
	Logf("logger initialized\n")
}

func SetEnableDebugLog(enable bool) {
	DebugLogEnabled = enable
}

// deprecated (use GetGroupId instead)
func (ckey CommandKey) GetSessionId() string {
	return ckey.GetGroupId()
}

func (ckey CommandKey) GetGroupId() string {
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

func HasDebugFlag(envMap map[string]string, flagName string) bool {
	msDebug := envMap[MShellDebugVarName]
	flags := strings.Split(msDebug, ",")
	for _, flag := range flags {
		if strings.TrimSpace(flag) == flagName {
			return true
		}
	}
	return false
}

func GetDebugRcFileName() string {
	msHome := GetMShellHomeDir()
	return path.Join(msHome, DebugRcFileName)
}

func GetDebugReturnStateFileName() string {
	msHome := GetMShellHomeDir()
	return path.Join(msHome, DebugReturnStateFileName)
}

func GetHomeDir() string {
	homeVar := os.Getenv(HomeVarName)
	if homeVar == "" {
		return "/"
	}
	return homeVar
}

func GetMShellHomeDir() string {
	homeVar := os.Getenv(MShellHomeVarName)
	if homeVar != "" {
		return homeVar
	}
	return ExpandHomeDir(DefaultMShellHome)
}

func EnsureRcFilesDir() (string, error) {
	mhome := GetMShellHomeDir()
	dirName := path.Join(mhome, RcFilesDirBaseName)
	err := CacheEnsureDir(dirName, RcFilesDirBaseName, 0700, "rcfiles dir")
	if err != nil {
		return "", err
	}
	return dirName, nil
}

func GetMShellPath() (string, error) {
	msPath := os.Getenv(MShellPathVarName) // use MSHELL_PATH
	if msPath != "" {
		return exec.LookPath(msPath)
	}
	mhome := GetMShellHomeDir()
	userMShellPath := path.Join(mhome, DefaultMShellName) // look in ~/.mshell
	msPath, err := exec.LookPath(userMShellPath)
	if err == nil {
		return msPath, nil
	}
	return exec.LookPath(DefaultMShellName) // standard path lookup for 'mshell'
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

func GoArchOptFile(version string, goos string, goarch string) string {
	installBinDir := os.Getenv(MShellInstallBinVarName)
	if installBinDir == "" {
		installBinDir = DefaultMShellInstallBinDir
	}
	versionStr := semver.MajorMinor(version)
	if versionStr == "" {
		versionStr = "unknown"
	}
	binBaseName := fmt.Sprintf("mshell-%s-%s.%s", versionStr, goos, goarch)
	return fmt.Sprintf(path.Join(installBinDir, binBaseName))
}

func GetRemoteId() (string, error) {
	mhome := GetMShellHomeDir()
	homeInfo, err := os.Stat(mhome)
	if errors.Is(err, fs.ErrNotExist) {
		err = os.MkdirAll(mhome, 0777)
		if err != nil {
			return "", fmt.Errorf("cannot make mshell home directory[%s]: %w", mhome, err)
		}
		homeInfo, err = os.Stat(mhome)
	}
	if err != nil {
		return "", fmt.Errorf("cannot stat mshell home directory[%s]: %w", mhome, err)
	}
	if !homeInfo.IsDir() {
		return "", fmt.Errorf("mshell home directory[%s] is not a directory", mhome)
	}
	remoteIdFile := path.Join(mhome, RemoteIdFile)
	fd, err := os.Open(remoteIdFile)
	if errors.Is(err, fs.ErrNotExist) {
		// write the file
		remoteId := uuid.New().String()
		err = os.WriteFile(remoteIdFile, []byte(remoteId), 0644)
		if err != nil {
			return "", fmt.Errorf("cannot write remoteid to '%s': %w", remoteIdFile, err)
		}
		return remoteId, nil
	} else if err != nil {
		return "", fmt.Errorf("cannot read remoteid file '%s': %w", remoteIdFile, err)
	} else {
		defer fd.Close()
		contents, err := io.ReadAll(fd)
		if err != nil {
			return "", fmt.Errorf("cannot read remoteid file '%s': %w", remoteIdFile, err)
		}
		uuidStr := string(contents)
		_, err = uuid.Parse(uuidStr)
		if err != nil {
			return "", fmt.Errorf("invalid uuid read from '%s': %w", remoteIdFile, err)
		}
		return uuidStr, nil
	}
}

func BoundInt(ival int, minVal int, maxVal int) int {
	if ival < minVal {
		return minVal
	}
	if ival > maxVal {
		return maxVal
	}
	return ival
}

func BoundInt64(ival int64, minVal int64, maxVal int64) int64 {
	if ival < minVal {
		return minVal
	}
	if ival > maxVal {
		return maxVal
	}
	return ival
}

func CacheEnsureDir(dirName string, cacheKey string, perm os.FileMode, dirDesc string) error {
	baseLock.Lock()
	ok := ensureDirCache[cacheKey]
	baseLock.Unlock()
	if ok {
		return nil
	}
	err := TryMkdirs(dirName, perm, dirDesc)
	if err != nil {
		return err
	}
	baseLock.Lock()
	ensureDirCache[cacheKey] = true
	baseLock.Unlock()
	return nil
}

func TryMkdirs(dirName string, perm os.FileMode, dirDesc string) error {
	info, err := os.Stat(dirName)
	if errors.Is(err, fs.ErrNotExist) {
		err = os.MkdirAll(dirName, perm)
		if err != nil {
			return fmt.Errorf("cannot make %s %q: %w", dirDesc, dirName, err)
		}
		info, err = os.Stat(dirName)
	}
	if err != nil {
		return fmt.Errorf("error trying to stat %s: %w", dirDesc, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("%s %q must be a directory", dirDesc, dirName)
	}
	return nil
}
