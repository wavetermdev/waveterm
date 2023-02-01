package scbase

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path"
	"runtime"
	"strconv"
	"sync"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"golang.org/x/mod/semver"
	"golang.org/x/sys/unix"
)

const HomeVarName = "HOME"
const PromptHomeVarName = "PROMPT_HOME"
const PromptDevVarName = "PROMPT_DEV"
const SessionsDirBaseName = "sessions"
const PromptLockFile = "prompt.lock"
const PromptDirName = "prompt"
const PromptDevDirName = "prompt-dev"
const PromptAppPathVarName = "PROMPT_APP_PATH"
const PromptVersion = "v0.1.3"
const PromptAuthKeyFileName = "prompt.authkey"
const MShellVersion = "v0.2.0"

var SessionDirCache = make(map[string]string)
var BaseLock = &sync.Mutex{}

func IsDevMode() bool {
	pdev := os.Getenv(PromptDevVarName)
	return pdev != ""
}

// must match js
func GetPromptHomeDir() string {
	scHome := os.Getenv(PromptHomeVarName)
	if scHome == "" {
		homeVar := os.Getenv(HomeVarName)
		if homeVar == "" {
			homeVar = "/"
		}
		pdev := os.Getenv(PromptDevVarName)
		if pdev != "" {
			scHome = path.Join(homeVar, PromptDevDirName)
		} else {
			scHome = path.Join(homeVar, PromptDirName)
		}

	}
	return scHome
}

func MShellBinaryDir() string {
	appPath := os.Getenv(PromptAppPathVarName)
	if appPath == "" {
		appPath = "."
	}
	if IsDevMode() {
		return path.Join(appPath, "dev-bin")
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

func createPromptAuthKeyFile(fileName string) (string, error) {
	fd, err := os.OpenFile(fileName, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return "", err
	}
	defer fd.Close()
	keyStr := GenPromptUUID()
	_, err = fd.Write([]byte(keyStr))
	if err != nil {
		return "", err
	}
	return keyStr, nil
}

func ReadPromptAuthKey() (string, error) {
	homeDir := GetPromptHomeDir()
	err := ensureDir(homeDir)
	if err != nil {
		return "", fmt.Errorf("cannot find/create PROMPT_HOME directory %q", homeDir)
	}
	fileName := path.Join(homeDir, PromptAuthKeyFileName)
	fd, err := os.Open(fileName)
	if err != nil && errors.Is(err, fs.ErrNotExist) {
		return createPromptAuthKeyFile(fileName)
	}
	if err != nil {
		return "", fmt.Errorf("error opening prompt authkey:%s: %v", fileName, err)
	}
	defer fd.Close()
	buf, err := io.ReadAll(fd)
	if err != nil {
		return "", fmt.Errorf("error reading prompt authkey:%s: %v", fileName, err)
	}
	keyStr := string(buf)
	_, err = uuid.Parse(keyStr)
	if err != nil {
		return "", fmt.Errorf("invalid authkey:%s format: %v", fileName, err)
	}
	return keyStr, nil
}

func AcquirePromptLock() (*os.File, error) {
	homeDir := GetPromptHomeDir()
	err := ensureDir(homeDir)
	if err != nil {
		return nil, fmt.Errorf("cannot find/create PROMPT_HOME directory %q", homeDir)
	}
	lockFileName := path.Join(homeDir, PromptLockFile)
	fd, err := os.Create(lockFileName)
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
	scHome := GetPromptHomeDir()
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

func GetSessionsDir() string {
	promptHome := GetPromptHomeDir()
	sdir := path.Join(promptHome, SessionsDirBaseName)
	return sdir
}

func ensureDir(dirName string) error {
	info, err := os.Stat(dirName)
	if errors.Is(err, fs.ErrNotExist) {
		err = os.MkdirAll(dirName, 0700)
		if err != nil {
			return err
		}
		log.Printf("[prompt] created directory %q\n", dirName)
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

func PtyOutFile(sessionId string, cmdId string) (string, error) {
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

func RunOutFile(sessionId string, cmdId string) (string, error) {
	sdir, err := EnsureSessionDir(sessionId)
	if err != nil {
		return "", err
	}
	if sessionId == "" {
		return "", fmt.Errorf("cannot get runout file for blank sessionid")
	}
	if cmdId == "" {
		return "", fmt.Errorf("cannot get runout file for blank cmdid")
	}
	return fmt.Sprintf("%s/%s.runout", sdir, cmdId), nil
}

type PromptFileNameGenerator struct {
	PromptHome string
}

func (g PromptFileNameGenerator) PtyOutFile(ck base.CommandKey) string {
	return path.Join(g.PromptHome, SessionsDirBaseName, ck.GetSessionId(), ck.GetCmdId()+".ptyout")
}

func (g PromptFileNameGenerator) RunOutFile(ck base.CommandKey) string {
	return path.Join(g.PromptHome, SessionsDirBaseName, ck.GetSessionId(), ck.GetCmdId()+".runout")
}

func GenPromptUUID() string {
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
