package scbase

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path"
	"strconv"
	"sync"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"golang.org/x/mod/semver"
	"golang.org/x/sys/unix"
)

const HomeVarName = "HOME"
const ScHomeVarName = "SCRIPTHAUS_HOME"
const SessionsDirBaseName = "sessions"
const SCLockFile = "sh2.lock"
const ScriptHausDirName = "scripthaus"
const ScriptHausAppPathVarName = "SCRIPTHAUS_APP_PATH"
const ScriptHausVersion = "v0.1.0"

var SessionDirCache = make(map[string]string)
var BaseLock = &sync.Mutex{}

// must match js
func GetScHomeDir() string {
	scHome := os.Getenv(ScHomeVarName)
	if scHome == "" {
		homeVar := os.Getenv(HomeVarName)
		if homeVar == "" {
			homeVar = "/"
		}
		scHome = path.Join(homeVar, ScriptHausDirName)
	}
	return scHome
}

func MShellBinaryFromPackage(version string, goos string, goarch string) (io.ReadCloser, error) {
	appPath := os.Getenv(ScriptHausAppPathVarName)
	if appPath == "" {
		return base.MShellBinaryFromOptDir(version, goos, goarch)
	}
	if !base.ValidGoArch(goos, goarch) {
		return nil, fmt.Errorf("invalid goos/goarch combination: %s/%s", goos, goarch)
	}
	versionStr := semver.MajorMinor(version)
	if versionStr == "" {
		return nil, fmt.Errorf("invalid mshell version: %q", version)
	}
	fileName := fmt.Sprintf("mshell-%s-%s.%s", versionStr, goos, goarch)
	fullFileName := path.Join(appPath, "bin", "mshell", fileName)
	log.Printf("mshell-binary %q\n", fullFileName)
	fd, err := os.Open(fullFileName)
	if err != nil {
		return nil, fmt.Errorf("cannot open mshell binary %q: %v", fullFileName, err)
	}
	return fd, nil
}

func AcquireSCLock() (*os.File, error) {
	homeDir := GetScHomeDir()
	err := ensureDir(homeDir)
	if err != nil {
		return nil, fmt.Errorf("cannot find/create SCRIPTHAUS_HOME directory %q", homeDir)
	}
	lockFileName := path.Join(homeDir, SCLockFile)
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
	scHome := GetScHomeDir()
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

func ensureDir(dirName string) error {
	info, err := os.Stat(dirName)
	if errors.Is(err, fs.ErrNotExist) {
		err = os.MkdirAll(dirName, 0700)
		if err != nil {
			return err
		}
		log.Printf("[scripthaus] created directory %q\n", dirName)
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

type ScFileNameGenerator struct {
	ScHome string
}

func (g ScFileNameGenerator) PtyOutFile(ck base.CommandKey) string {
	return path.Join(g.ScHome, SessionsDirBaseName, ck.GetSessionId(), ck.GetCmdId()+".ptyout")
}

func (g ScFileNameGenerator) RunOutFile(ck base.CommandKey) string {
	return path.Join(g.ScHome, SessionsDirBaseName, ck.GetSessionId(), ck.GetCmdId()+".runout")
}

func GenSCUUID() string {
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
