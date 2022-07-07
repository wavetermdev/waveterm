package scbase

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"sync"

	"golang.org/x/sys/unix"
)

const HomeVarName = "HOME"
const ScHomeVarName = "SCRIPTHAUS_HOME"
const SessionsDirBaseName = "sessions"
const RemotesDirBaseName = "remotes"
const SCLockFile = "sh2.lock"

var SessionDirCache = make(map[string]string)
var BaseLock = &sync.Mutex{}

func GetScHomeDir() string {
	scHome := os.Getenv(ScHomeVarName)
	if scHome == "" {
		homeVar := os.Getenv(HomeVarName)
		if homeVar == "" {
			homeVar = "/"
		}
		scHome = path.Join(homeVar, "scripthaus")
	}
	return scHome
}

func AcquireSCLock() (*os.File, error) {
	homeDir := GetScHomeDir()
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
	return fmt.Sprintf("%s/%s.ptyout", sdir, cmdId), nil
}

func RunOutFile(sessionId string, cmdId string) (string, error) {
	sdir, err := EnsureSessionDir(sessionId)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/%s.runout", sdir, cmdId), nil
}

func RemotePtyOut(remoteId string) (string, error) {
	scHome := GetScHomeDir()
	rdir := path.Join(scHome, RemotesDirBaseName)
	err := ensureDir(rdir)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/%s.ptyout", rdir, remoteId), nil
}
