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
const WaveAuthKeyFileName = "waveterm.authkey"
const MShellVersion = "v0.5.0"

// initialized by InitialzeWaveAuthKey (called by main-server)
var WaveAuthKey string

var SessionDirCache = make(map[string]string)
var ScreenDirCache = make(map[string]string)
var BaseLock = &sync.Mutex{}

// these are set by the main-server using build-time variables
var BuildTime = "-"
var WaveVersion = "-"

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

// also sets WaveAuthKey
func createWaveAuthKeyFile(fileName string) error {
	fd, err := os.OpenFile(fileName, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer fd.Close()
	keyStr := GenWaveUUID()
	_, err = fd.Write([]byte(keyStr))
	if err != nil {
		return err
	}
	WaveAuthKey = keyStr
	return nil
}

// sets WaveAuthKey
func InitializeWaveAuthKey() error {
	homeDir := GetWaveHomeDir()
	err := ensureDir(homeDir)
	if err != nil {
		return fmt.Errorf("cannot find/create WAVETERM_HOME directory %q", homeDir)
	}
	fileName := path.Join(homeDir, WaveAuthKeyFileName)
	fd, err := os.Open(fileName)
	if err != nil && errors.Is(err, fs.ErrNotExist) {
		return createWaveAuthKeyFile(fileName)
	}
	if err != nil {
		return fmt.Errorf("error opening wave authkey:%s: %v", fileName, err)
	}
	defer fd.Close()
	buf, err := io.ReadAll(fd)
	if err != nil {
		return fmt.Errorf("error reading wave authkey:%s: %v", fileName, err)
	}
	keyStr := string(buf)
	_, err = uuid.Parse(keyStr)
	if err != nil {
		return fmt.Errorf("invalid authkey:%s format: %v", fileName, err)
	}
	WaveAuthKey = keyStr
	return nil
}

func AcquireWaveLock() (*os.File, error) {
	homeDir := GetWaveHomeDir()
	err := ensureDir(homeDir)
	if err != nil {
		return nil, fmt.Errorf("cannot find/create WAVETERM_HOME directory %q", homeDir)
	}
	lockFileName := path.Join(homeDir, WaveLockFile)
	log.Printf("[base] acquiring lock on %s\n", lockFileName)
	fd, err := os.OpenFile(lockFileName, os.O_RDWR|os.O_CREATE, 0600)
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

func EnsureConfigDir() (string, error) {
	scHome := GetWaveHomeDir()
	configDir := path.Join(scHome, "/config/")
	err := ensureDir(configDir)
	if err != nil {
		return "", err
	}
	keybindingsFile := path.Join(configDir, "/keybindings.json")
	keybindingsFileObj, err := ensureFile(keybindingsFile)
	if err != nil {
		return "", err
	}
	if keybindingsFileObj != nil {
		keybindingsFileObj.WriteString("[]\n")
		keybindingsFileObj.Close()
	}
	return configDir, nil
}

func ensureFile(fileName string) (*os.File, error) {
	info, err := os.Stat(fileName)
	var myFile *os.File
	if errors.Is(err, fs.ErrNotExist) {
		myFile, err = os.Create(fileName)
		if err != nil {
			return nil, err
		}
		log.Printf("[wave] created file %q\n", fileName)
		info, err = myFile.Stat()
	}
	if err != nil {
		return myFile, err
	}
	if info.IsDir() {
		return myFile, fmt.Errorf("'%s' must be a file", fileName)
	}
	return myFile, nil

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

var releaseRegex = regexp.MustCompile(`^(\d+\.\d+\.\d+)`)
var osReleaseOnce = &sync.Once{}
var osRelease string

func unameKernelRelease() string {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	out, err := exec.CommandContext(ctx, "uname", "-r").CombinedOutput()
	if err != nil {
		log.Printf("error executing uname -r: %v\n", err)
		return "-"
	}
	releaseStr := strings.TrimSpace(string(out))
	m := releaseRegex.FindStringSubmatch(releaseStr)
	if m == nil || len(m) < 2 {
		log.Printf("invalid uname -r output: [%s]\n", releaseStr)
		return "-"
	}
	return m[1]
}

func UnameKernelRelease() string {
	osReleaseOnce.Do(func() {
		osRelease = unameKernelRelease()
	})
	return osRelease
}

var osLangOnce = &sync.Once{}
var osLang string

func determineLang() string {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	if runtime.GOOS == "darwin" {
		out, err := exec.CommandContext(ctx, "defaults", "read", "-g", "AppleLocale").CombinedOutput()
		if err != nil {
			log.Printf("error executing 'defaults read -g AppleLocale': %v\n", err)
			return ""
		}
		strOut := string(out)
		truncOut := strings.Split(strOut, "@")[0]
		return strings.TrimSpace(truncOut) + ".UTF-8"
	} else {
		// this is specifically to get the wavesrv LANG so waveshell
		// on a remote uses the same LANG
		return os.Getenv("LANG")
	}
}

func DetermineLang() string {
	osLangOnce.Do(func() {
		osLang = determineLang()
	})
	return osLang
}
