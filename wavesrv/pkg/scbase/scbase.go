// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scbase

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"os/user"
	"path"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"golang.org/x/mod/semver"
	"golang.org/x/sys/unix"
)

const HomeVarName = "HOME"
const WaveHomeVarName = "WAVETERM_HOME"
const WaveDevVarName = "WAVETERM_DEV"
const SessionsDirBaseName = "sessions"
const ScreensDirBaseName = "screens"
const WaveLockFile = "waveterm.lock"
const WaveDirName = ".waveterm"        // must match emain.ts
const WaveDevDirName = ".waveterm-dev" // must match emain.ts
const WaveAppPathVarName = "WAVETERM_APP_PATH"
const WaveVersion = "v0.5.0"
const WaveAuthKeyFileName = "waveterm.authkey"
const MShellVersion = "v0.3.0"
const DefaultMacOSShell = "/bin/bash"

var SessionDirCache = make(map[string]string)
var ScreenDirCache = make(map[string]string)
var BaseLock = &sync.Mutex{}
var BuildTime = "-"

func IsDevMode() bool {
	pdev := os.Getenv(WaveDevVarName)
	return pdev != ""
}

// must match js
func GetWaveHomeDir() string {
	scHome := os.Getenv(WaveHomeVarName)
	if scHome == "" {
		homeVar := os.Getenv(HomeVarName)
		if homeVar == "" {
			homeVar = "/"
		}
		pdev := os.Getenv(WaveDevVarName)
		if pdev != "" {
			scHome = path.Join(homeVar, WaveDevDirName)
		} else {
			scHome = path.Join(homeVar, WaveDirName)
		}

	}
	return scHome
}

func MShellBinaryDir() string {
	appPath := os.Getenv(WaveAppPathVarName)
	if appPath == "" {
		appPath = "."
	}
	return path.Join(appPath, "bin", "mshell")
}

func MShellBinaryPath(version string, goos string, goarch string) (string, error) {
	if !base.ValidGoArch(goos, goarch) {
		return "", fmt.Errorf("invalid goos/goarch combination: %s/%s", goos, goarch)
	}
	binaryDir := MShellBinaryDir()
	versionStr := semver.MajorMinor(version)
	if versionStr == "" {
		return "", fmt.Errorf("invalid mshell version: %q", version)
	}
	fileName := fmt.Sprintf("mshell-%s-%s.%s", versionStr, goos, goarch)
	fullFileName := path.Join(binaryDir, fileName)
	return fullFileName, nil
}

func LocalMShellBinaryPath() (string, error) {
	return MShellBinaryPath(MShellVersion, runtime.GOOS, runtime.GOARCH)
}

func MShellBinaryReader(version string, goos string, goarch string) (io.ReadCloser, error) {
	mshellPath, err := MShellBinaryPath(version, goos, goarch)
	if err != nil {
		return nil, err
	}
	fd, err := os.Open(mshellPath)
	if err != nil {
		return nil, fmt.Errorf("cannot open mshell binary %q: %v", mshellPath, err)
	}
	return fd, nil
}

func createWaveAuthKeyFile(fileName string) (string, error) {
	fd, err := os.OpenFile(fileName, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return "", err
	}
	defer fd.Close()
	keyStr := GenWaveUUID()
	_, err = fd.Write([]byte(keyStr))
	if err != nil {
		return "", err
	}
	return keyStr, nil
}

func ReadWaveAuthKey() (string, error) {
	homeDir := GetWaveHomeDir()
	err := ensureDir(homeDir)
	if err != nil {
		return "", fmt.Errorf("cannot find/create WAVETERM_HOME directory %q", homeDir)
	}
	fileName := path.Join(homeDir, WaveAuthKeyFileName)
	fd, err := os.Open(fileName)
	if err != nil && errors.Is(err, fs.ErrNotExist) {
		return createWaveAuthKeyFile(fileName)
	}
	if err != nil {
		return "", fmt.Errorf("error opening wave authkey:%s: %v", fileName, err)
	}
	defer fd.Close()
	buf, err := io.ReadAll(fd)
	if err != nil {
		return "", fmt.Errorf("error reading wave authkey:%s: %v", fileName, err)
	}
	keyStr := string(buf)
	_, err = uuid.Parse(keyStr)
	if err != nil {
		return "", fmt.Errorf("invalid authkey:%s format: %v", fileName, err)
	}
	return keyStr, nil
}

func AcquireWaveLock() (*os.File, error) {
	homeDir := GetWaveHomeDir()
	err := ensureDir(homeDir)
	if err != nil {
		return nil, fmt.Errorf("cannot find/create WAVETERM_HOME directory %q", homeDir)
	}
	lockFileName := path.Join(homeDir, WaveLockFile)
	fd, err := os.OpenFile(lockFileName, os.O_WRONLY|os.O_CREATE, 0600)
	if err != nil {
		return nil, err
	}
	err = unix.Flock(int(fd.Fd()), unix.LOCK_EX|unix.LOCK_NB)
	if err != nil {
		fd.Close()
		return nil, err
	}
	return fd, nil
}

// deprecated (v0.1.8)
func EnsureSessionDir(sessionId string) (string, error) {
	if sessionId == "" {
		return "", fmt.Errorf("cannot get session dir for blank sessionid")
	}
	BaseLock.Lock()
	sdir, ok := SessionDirCache[sessionId]
	BaseLock.Unlock()
	if ok {
		return sdir, nil
	}
	scHome := GetWaveHomeDir()
	sdir = path.Join(scHome, SessionsDirBaseName, sessionId)
	err := ensureDir(sdir)
	if err != nil {
		return "", err
	}
	BaseLock.Lock()
	SessionDirCache[sessionId] = sdir
	BaseLock.Unlock()
	return sdir, nil
}

// deprecated (v0.1.8)
func GetSessionsDir() string {
	waveHome := GetWaveHomeDir()
	sdir := path.Join(waveHome, SessionsDirBaseName)
	return sdir
}

func EnsureScreenDir(screenId string) (string, error) {
	if screenId == "" {
		return "", fmt.Errorf("cannot get screen dir for blank sessionid")
	}
	BaseLock.Lock()
	sdir, ok := ScreenDirCache[screenId]
	BaseLock.Unlock()
	if ok {
		return sdir, nil
	}
	scHome := GetWaveHomeDir()
	sdir = path.Join(scHome, ScreensDirBaseName, screenId)
	err := ensureDir(sdir)
	if err != nil {
		return "", err
	}
	BaseLock.Lock()
	ScreenDirCache[screenId] = sdir
	BaseLock.Unlock()
	return sdir, nil
}

func GetScreensDir() string {
	waveHome := GetWaveHomeDir()
	sdir := path.Join(waveHome, ScreensDirBaseName)
	return sdir
}

func ensureDir(dirName string) error {
	info, err := os.Stat(dirName)
	if errors.Is(err, fs.ErrNotExist) {
		err = os.MkdirAll(dirName, 0700)
		if err != nil {
			return err
		}
		log.Printf("[wave] created directory %q\n", dirName)
		info, err = os.Stat(dirName)
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("'%s' must be a directory", dirName)
	}
	return nil
}

// deprecated (v0.1.8)
func PtyOutFile_Sessions(sessionId string, cmdId string) (string, error) {
	sdir, err := EnsureSessionDir(sessionId)
	if err != nil {
		return "", err
	}
	if sessionId == "" {
		return "", fmt.Errorf("cannot get ptyout file for blank sessionid")
	}
	if cmdId == "" {
		return "", fmt.Errorf("cannot get ptyout file for blank cmdid")
	}
	return fmt.Sprintf("%s/%s.ptyout.cf", sdir, cmdId), nil
}

func PtyOutFile(screenId string, lineId string) (string, error) {
	sdir, err := EnsureScreenDir(screenId)
	if err != nil {
		return "", err
	}
	if screenId == "" {
		return "", fmt.Errorf("cannot get ptyout file for blank screenid")
	}
	if lineId == "" {
		return "", fmt.Errorf("cannot get ptyout file for blank lineid")
	}
	return fmt.Sprintf("%s/%s.ptyout.cf", sdir, lineId), nil
}

func GenWaveUUID() string {
	for {
		rtn := uuid.New().String()
		_, err := strconv.Atoi(rtn[0:8])
		if err == nil { // do not allow UUIDs where the initial 8 bytes parse to an integer
			continue
		}
		return rtn
	}
}

func NumFormatDec(num int64) string {
	var signStr string
	absNum := num
	if absNum < 0 {
		absNum = -absNum
		signStr = "-"
	}
	if absNum < 1000 {
		// raw num
		return signStr + strconv.FormatInt(absNum, 10)
	}
	if absNum < 1000000 {
		// k num
		kVal := float64(absNum) / 1000
		return signStr + strconv.FormatFloat(kVal, 'f', 2, 64) + "k"
	}
	if absNum < 1000000000 {
		// M num
		mVal := float64(absNum) / 1000000
		return signStr + strconv.FormatFloat(mVal, 'f', 2, 64) + "m"
	} else {
		// G num
		gVal := float64(absNum) / 1000000000
		return signStr + strconv.FormatFloat(gVal, 'f', 2, 64) + "g"
	}
}

func NumFormatB2(num int64) string {
	var signStr string
	absNum := num
	if absNum < 0 {
		absNum = -absNum
		signStr = "-"
	}
	if absNum < 1024 {
		// raw num
		return signStr + strconv.FormatInt(absNum, 10)
	}
	if absNum < 1000000 {
		// k num
		if absNum%1024 == 0 {
			return signStr + strconv.FormatInt(absNum/1024, 10) + "K"
		}
		kVal := float64(absNum) / 1024
		return signStr + strconv.FormatFloat(kVal, 'f', 2, 64) + "K"
	}
	if absNum < 1000000000 {
		// M num
		if absNum%(1024*1024) == 0 {
			return signStr + strconv.FormatInt(absNum/(1024*1024), 10) + "M"
		}
		mVal := float64(absNum) / (1024 * 1024)
		return signStr + strconv.FormatFloat(mVal, 'f', 2, 64) + "M"
	} else {
		// G num
		if absNum%(1024*1024*1024) == 0 {
			return signStr + strconv.FormatInt(absNum/(1024*1024*1024), 10) + "G"
		}
		gVal := float64(absNum) / (1024 * 1024 * 1024)
		return signStr + strconv.FormatFloat(gVal, 'f', 2, 64) + "G"
	}
}

func ClientArch() string {
	return fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)
}

var releaseRegex = regexp.MustCompile(`^\d+\.\d+\.\d+$`)
var osReleaseOnce = &sync.Once{}
var osRelease string

func macOSRelease() string {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	out, err := exec.CommandContext(ctx, "uname", "-r").CombinedOutput()
	if err != nil {
		log.Printf("error executing uname -r: %v\n", err)
		return "-"
	}
	releaseStr := strings.TrimSpace(string(out))
	if !releaseRegex.MatchString(releaseStr) {
		log.Printf("invalid uname -r output: [%s]\n", releaseStr)
		return "-"
	}
	return releaseStr
}

func MacOSRelease() string {
	osReleaseOnce.Do(func() {
		osRelease = macOSRelease()
	})
	return osRelease
}

var userShellRegexp = regexp.MustCompile(`^UserShell: (.*)$`)

// dscl . -read /User/[username] UserShell
// defaults to /bin/bash
func MacUserShell() string {
	osUser, err := user.Current()
	if err != nil {
		log.Printf("error getting current user: %v\n", err)
		return DefaultMacOSShell
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	userStr := "/Users/" + osUser.Name
	out, err := exec.CommandContext(ctx, "dscl", ".", "-read", userStr, "UserShell").CombinedOutput()
	if err != nil {
		log.Printf("error executing macos user shell lookup: %v %q\n", err, string(out))
		return DefaultMacOSShell
	}
	outStr := strings.TrimSpace(string(out))
	m := userShellRegexp.FindStringSubmatch(outStr)
	if m == nil {
		log.Printf("error in format of dscl output: %q\n", outStr)
		return DefaultMacOSShell
	}
	return m[1]
}
