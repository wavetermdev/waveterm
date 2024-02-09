// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/alessio/shellescape"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shellapi"
	"github.com/wavetermdev/waveterm/waveshell/pkg/shexec"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
)

const MaxFileDataPacketSize = 16 * 1024
const WriteFileContextTimeout = 30 * time.Second
const cleanLoopTime = 5 * time.Second
const MaxWriteFileContextData = 100

type shellStateMapKey struct {
	ShellType string
	Hash      string
}

type ShellStateMap struct {
	Lock            *sync.Mutex
	StateMap        map[shellStateMapKey]*packet.ShellState // shelltype+hash -> state
	CurrentStateMap map[string]string                       // shelltype -> hash
}

// TODO create unblockable packet-sender (backed by an array) for clientproc
type MServer struct {
	Lock                *sync.Mutex
	MainInput           *packet.PacketParser
	Sender              *packet.PacketSender
	ClientMap           map[base.CommandKey]*shexec.ClientProc
	Debug               bool
	StateMap            *ShellStateMap
	WriteErrorCh        chan bool // closed if there is a I/O write error
	WriteErrorChOnce    *sync.Once
	WriteFileContextMap map[string]*WriteFileContext
	Done                bool
}

type WriteFileContext struct {
	CVar       *sync.Cond
	Data       []*packet.FileDataPacketType
	LastActive time.Time
	Err        error
	Done       bool
}

func (m *MServer) Close() {
	m.Sender.Close()
	m.Sender.WaitForDone()
	m.Lock.Lock()
	defer m.Lock.Unlock()
	m.Done = true
}

func (m *MServer) checkDone() bool {
	m.Lock.Lock()
	defer m.Lock.Unlock()
	return m.Done
}

func (m *MServer) getWriteFileContext(reqId string) *WriteFileContext {
	m.Lock.Lock()
	defer m.Lock.Unlock()
	wfc := m.WriteFileContextMap[reqId]
	if wfc == nil {
		wfc = &WriteFileContext{
			CVar:       sync.NewCond(&sync.Mutex{}),
			LastActive: time.Now(),
		}
		m.WriteFileContextMap[reqId] = wfc
	}
	return wfc
}

func (m *MServer) addFileDataPacket(pk *packet.FileDataPacketType) {
	m.Lock.Lock()
	wfc := m.WriteFileContextMap[pk.RespId]
	m.Lock.Unlock()
	if wfc == nil {
		return
	}
	wfc.CVar.L.Lock()
	defer wfc.CVar.L.Unlock()
	if wfc.Done || wfc.Err != nil {
		return
	}
	if len(wfc.Data) > MaxWriteFileContextData {
		wfc.Err = errors.New("write-file buffer length exceeded")
		wfc.Data = nil
		wfc.CVar.Broadcast()
		return
	}
	wfc.LastActive = time.Now()
	wfc.Data = append(wfc.Data, pk)
	wfc.CVar.Signal()
}

func (wfc *WriteFileContext) setDone() {
	wfc.CVar.L.Lock()
	defer wfc.CVar.L.Unlock()
	wfc.Done = true
	wfc.Data = nil
	wfc.CVar.Broadcast()
}

func (m *MServer) cleanWriteFileContexts() {
	now := time.Now()
	var staleWfcs []*WriteFileContext
	m.Lock.Lock()
	for reqId, wfc := range m.WriteFileContextMap {
		if now.Sub(wfc.LastActive) > WriteFileContextTimeout {
			staleWfcs = append(staleWfcs, wfc)
			delete(m.WriteFileContextMap, reqId)
		}
	}
	m.Lock.Unlock()

	// we do this outside of m.Lock just in case there is some lock contention (end of WriteFile could theoretically be slow)
	for _, wfc := range staleWfcs {
		wfc.setDone()
	}
}

func (m *MServer) ProcessCommandPacket(pk packet.CommandPacketType) {
	ck := pk.GetCK()
	if ck == "" {
		m.Sender.SendMessageFmt("received '%s' packet without ck", pk.GetType())
		return
	}
	m.Lock.Lock()
	cproc := m.ClientMap[ck]
	m.Lock.Unlock()
	if cproc == nil {
		m.Sender.SendCmdError(ck, fmt.Errorf("no client proc for ck '%s', pk=%s", ck, packet.AsString(pk)))
		return
	}
	cproc.Input.SendPacket(pk)
	return
}

func runSingleCompGen(cwd string, compType string, prefix string) ([]string, bool, error) {
	sapi, err := shellapi.MakeShellApi(packet.ShellType_bash)
	if err != nil {
		return nil, false, err
	}
	if !packet.IsValidCompGenType(compType) {
		return nil, false, fmt.Errorf("invalid compgen type '%s'", compType)
	}
	compGenCmdStr := fmt.Sprintf("cd %s; compgen -A %s -- %s | sort | uniq | head -n %d", shellescape.Quote(cwd), shellescape.Quote(compType), shellescape.Quote(prefix), packet.MaxCompGenValues+1)
	ecmd := exec.Command(sapi.GetLocalShellPath(), "-c", compGenCmdStr)
	outputBytes, err := ecmd.Output()
	if err != nil {
		return nil, false, fmt.Errorf("compgen error: %w", err)
	}
	outputStr := string(outputBytes)
	parts := strings.Split(outputStr, "\n")
	if len(parts) > 0 && parts[len(parts)-1] == "" {
		parts = parts[0 : len(parts)-1]
	}
	hasMore := false
	if len(parts) > packet.MaxCompGenValues {
		hasMore = true
		parts = parts[0:packet.MaxCompGenValues]
	}
	return parts, hasMore, nil
}

func appendSlashes(comps []string) {
	for idx, comp := range comps {
		comps[idx] = comp + "/"
	}
}

func strArrToMap(strs []string) map[string]bool {
	rtn := make(map[string]bool)
	for _, s := range strs {
		rtn[s] = true
	}
	return rtn
}

func (m *MServer) runMixedCompGen(compPk *packet.CompGenPacketType) {
	// get directories and files, unique them and put slashes on directories for completion
	reqId := compPk.GetReqId()
	compDirs, hasMoreDirs, err := runSingleCompGen(compPk.Cwd, "directory", compPk.Prefix)
	if err != nil {
		m.Sender.SendErrorResponse(reqId, err)
		return
	}
	compFiles, hasMoreFiles, err := runSingleCompGen(compPk.Cwd, compPk.CompType, compPk.Prefix)
	if err != nil {
		m.Sender.SendErrorResponse(reqId, err)
		return
	}

	dirMap := strArrToMap(compDirs)
	// seed comps with dirs (but append slashes)
	comps := compDirs
	appendSlashes(comps)
	// add files that are not directories (look up in dirMap)
	for _, file := range compFiles {
		if dirMap[file] {
			continue
		}
		comps = append(comps, file)
	}
	sort.Strings(comps) // resort
	m.Sender.SendResponse(reqId, map[string]interface{}{"comps": comps, "hasmore": (hasMoreFiles || hasMoreDirs)})
	return
}

func (m *MServer) runCompGen(compPk *packet.CompGenPacketType) {
	reqId := compPk.GetReqId()
	if compPk.CompType == "file" || compPk.CompType == "command" {
		m.runMixedCompGen(compPk)
		return
	}
	comps, hasMore, err := runSingleCompGen(compPk.Cwd, compPk.CompType, compPk.Prefix)
	if err != nil {
		m.Sender.SendErrorResponse(reqId, err)
		return
	}
	if compPk.CompType == "directory" {
		appendSlashes(comps)
	}
	m.Sender.SendResponse(reqId, map[string]interface{}{"comps": comps, "hasmore": hasMore})
	return
}

func (m *MServer) reinit(reqId string, shellType string) {
	ssPk, err := shexec.MakeShellStatePacket(shellType)
	if err != nil {
		m.Sender.SendErrorResponse(reqId, fmt.Errorf("error creating init packet: %w", err))
		return
	}
	err = m.StateMap.SetCurrentState(ssPk.State.GetShellType(), ssPk.State)
	if err != nil {
		m.Sender.SendErrorResponse(reqId, fmt.Errorf("error setting current state: %w", err))
		return
	}
	ssPk.RespId = reqId
	m.Sender.SendPacket(ssPk)
}

func makeTemp(path string, mode fs.FileMode) (*os.File, error) {
	dirName := filepath.Dir(path)
	baseName := filepath.Base(path)
	baseTempName := baseName + ".tmp."
	writeFd, err := os.CreateTemp(dirName, baseTempName)
	if err != nil {
		return nil, err
	}
	err = writeFd.Chmod(mode)
	if err != nil {
		writeFd.Close()
		os.Remove(writeFd.Name())
		return nil, fmt.Errorf("error setting tempfile permissions: %w", err)
	}
	return writeFd, nil
}

func checkFileWritable(path string) error {
	finfo, err := os.Stat(path) // ok to follow symlinks
	if errors.Is(err, fs.ErrNotExist) {
		dirName := filepath.Dir(path)
		dirInfo, err := os.Stat(dirName)
		if err != nil {
			return fmt.Errorf("file does not exist, error trying to stat parent directory: %w", err)
		}
		if !dirInfo.IsDir() {
			return fmt.Errorf("file does not exist, parent path [%s] is not a directory", dirName)
		}
		return nil
	} else {
		if err != nil {
			return fmt.Errorf("cannot stat: %w", err)
		}
		if finfo.IsDir() {
			return fmt.Errorf("invalid path, cannot write a directory")
		}
		if (finfo.Mode() & fs.ModeSymlink) != 0 {
			return fmt.Errorf("writefile does not support symlinks") // note this shouldn't happen because we're using Stat (not Lstat)
		}
		if (finfo.Mode() & (fs.ModeNamedPipe | fs.ModeSocket | fs.ModeDevice)) != 0 {
			return fmt.Errorf("writefile does not support special files (named pipes, sockets, devices): mode=%v", finfo.Mode())
		}
		writePerm := (finfo.Mode().Perm() & 0o222)
		if writePerm == 0 {
			return fmt.Errorf("file is not writable, perms: %v", finfo.Mode().Perm())
		}
		return nil
	}
}

func copyFile(dstName string, srcName string) error {
	srcFd, err := os.Open(srcName)
	if err != nil {
		return err
	}
	defer srcFd.Close()
	dstFd, err := os.OpenFile(dstName, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o666) // use 666 because OpenFile respects umask
	if err != nil {
		return err
	}
	// we don't defer dstFd.Close() so we can return an error if dstFd.Close() returns an error
	_, err = io.Copy(dstFd, srcFd)
	if err != nil {
		dstFd.Close()
		return err
	}
	return dstFd.Close()
}

func (m *MServer) writeFile(pk *packet.WriteFilePacketType, wfc *WriteFileContext) {
	defer wfc.setDone()
	if pk.Path == "" {
		resp := packet.MakeWriteFileReadyPacket(pk.ReqId)
		resp.Error = "invalid write-file request, no path specified"
		m.Sender.SendPacket(resp)
		return
	}
	err := checkFileWritable(pk.Path)
	if err != nil {
		resp := packet.MakeWriteFileReadyPacket(pk.ReqId)
		resp.Error = err.Error()
		m.Sender.SendPacket(resp)
		return
	}
	var writeFd *os.File
	if pk.UseTemp {
		writeFd, err = os.CreateTemp("", "mshell.writefile.*") // "" means make this file in standard TempDir
		if err != nil {
			resp := packet.MakeWriteFileReadyPacket(pk.ReqId)
			resp.Error = fmt.Sprintf("cannot create temp file: %v", err)
			m.Sender.SendPacket(resp)
			return
		}
	} else {
		writeFd, err = os.OpenFile(pk.Path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o666) // use 666 because OpenFile respects umask
		if err != nil {
			resp := packet.MakeWriteFileReadyPacket(pk.ReqId)
			resp.Error = fmt.Sprintf("write-file could not open file: %v", err)
			m.Sender.SendPacket(resp)
			return
		}
	}

	// ok, so now writeFd is valid, send the "ready" response
	resp := packet.MakeWriteFileReadyPacket(pk.ReqId)
	m.Sender.SendPacket(resp)

	// now we wait for data (cond var)
	// this Unlock() runs first (because it is a later defer) so we can still run wfc.setDone() safely
	wfc.CVar.L.Lock()
	defer wfc.CVar.L.Unlock()
	var doneErr error
	for {
		if wfc.Done {
			break
		}
		if wfc.Err != nil {
			doneErr = wfc.Err
			break
		}
		if len(wfc.Data) == 0 {
			wfc.CVar.Wait()
			continue
		}
		dataPk := wfc.Data[0]
		wfc.Data = wfc.Data[1:]
		if dataPk.Error != "" {
			doneErr = fmt.Errorf("error received from client: %v", errors.New(dataPk.Error))
			break
		}
		if len(dataPk.Data) > 0 {
			_, err := writeFd.Write(dataPk.Data)
			if err != nil {
				doneErr = fmt.Errorf("error writing data to file: %v", err)
				break
			}
		}
		if dataPk.Eof {
			break
		}
	}
	closeErr := writeFd.Close()
	if doneErr == nil && closeErr != nil {
		doneErr = fmt.Errorf("error closing file: %v", closeErr)
	}
	if pk.UseTemp {
		if doneErr != nil {
			os.Remove(writeFd.Name())
		} else {
			// copy file between writeFd.Name() and pk.Path
			copyErr := copyFile(pk.Path, writeFd.Name())
			if err != nil {
				doneErr = fmt.Errorf("error writing file: %v", copyErr)
			}
			os.Remove(writeFd.Name())
		}
	}
	donePk := packet.MakeWriteFileDonePacket(pk.ReqId)
	if doneErr != nil {
		donePk.Error = doneErr.Error()
	}
	m.Sender.SendPacket(donePk)
}

func (m *MServer) returnStreamFileNewFileResponse(pk *packet.StreamFilePacketType) {
	// ok, file doesn't exist, so try to check the directory at least to see if we can write a file here
	resp := packet.MakeStreamFileResponse(pk.ReqId)
	defer func() {
		if resp.Error == "" {
			resp.Done = true
		}
		m.Sender.SendPacket(resp)
	}()
	dirName := filepath.Dir(pk.Path)
	dirInfo, err := os.Stat(dirName)
	if err != nil {
		resp.Error = fmt.Sprintf("file does not exist, error trying to stat parent directory: %v", err)
		return
	}
	if !dirInfo.IsDir() {
		resp.Error = fmt.Sprintf("file does not exist, parent path [%s] is not a directory", dirName)
		return
	}
	resp.Info = &packet.FileInfo{
		Name:     pk.Path,
		Size:     0,
		ModTs:    0,
		IsDir:    false,
		Perm:     int(dirInfo.Mode().Perm()),
		NotFound: true,
	}
	return
}

func (m *MServer) streamFile(pk *packet.StreamFilePacketType) {
	resp := packet.MakeStreamFileResponse(pk.ReqId)
	finfo, err := os.Stat(pk.Path)
	if errors.Is(err, fs.ErrNotExist) {
		// special return
		m.returnStreamFileNewFileResponse(pk)
		return
	}
	if err != nil {
		resp.Error = fmt.Sprintf("cannot stat file %q: %v", pk.Path, err)
		m.Sender.SendPacket(resp)
		return
	}
	resp.Info = &packet.FileInfo{
		Name:  pk.Path,
		Size:  finfo.Size(),
		ModTs: finfo.ModTime().UnixMilli(),
		IsDir: finfo.IsDir(),
		Perm:  int(finfo.Mode().Perm()),
	}
	if pk.StatOnly {
		resp.Done = true
		m.Sender.SendPacket(resp)
		return
	}
	// like the http Range header.  range header is end inclusive.  for us, endByte is non-inclusive (so we add 1)
	var startByte, endByte int64
	if len(pk.ByteRange) == 0 {
		endByte = finfo.Size()
	} else if len(pk.ByteRange) == 1 && pk.ByteRange[0] >= 0 {
		startByte = pk.ByteRange[0]
		endByte = finfo.Size()
	} else if len(pk.ByteRange) == 1 && pk.ByteRange[0] < 0 {
		startByte = finfo.Size() + pk.ByteRange[0] // "+" since ByteRange[0] is less than 0
		endByte = finfo.Size()
	} else if len(pk.ByteRange) == 2 {
		startByte = pk.ByteRange[0]
		endByte = pk.ByteRange[1] + 1
	} else {
		resp.Error = fmt.Sprintf("invalid byte range (%d entries)", len(pk.ByteRange))
		m.Sender.SendPacket(resp)
		return
	}
	if startByte < 0 {
		startByte = 0
	}
	if endByte > finfo.Size() {
		endByte = finfo.Size()
	}
	if startByte >= endByte {
		resp.Done = true
		m.Sender.SendPacket(resp)
		return
	}
	fd, err := os.Open(pk.Path)
	if err != nil {
		resp.Error = fmt.Sprintf("opening file: %v", err)
		m.Sender.SendPacket(resp)
		return
	}
	defer fd.Close()
	m.Sender.SendPacket(resp)
	var buffer [MaxFileDataPacketSize]byte
	var sentDone bool
	first := true
	for ; startByte < endByte; startByte += MaxFileDataPacketSize {
		if !first {
			// throttle packet sending @ 1000 packets/s, or 16M/s
			time.Sleep(1 * time.Millisecond)
		}
		first = false
		readLen := int64Min(MaxFileDataPacketSize, endByte-startByte)
		bufSlice := buffer[0:readLen]
		nr, err := fd.ReadAt(bufSlice, startByte)
		dataPk := packet.MakeFileDataPacket(pk.ReqId)
		dataPk.Data = make([]byte, nr)
		copy(dataPk.Data, bufSlice)
		if err == io.EOF {
			dataPk.Eof = true
		} else if err != nil {
			dataPk.Error = err.Error()
		}
		m.Sender.SendPacket(dataPk)
		if dataPk.GetResponseDone() {
			sentDone = true
			break
		}
	}
	if !sentDone {
		dataPk := packet.MakeFileDataPacket(pk.ReqId)
		dataPk.Eof = true
		m.Sender.SendPacket(dataPk)
	}
	return
}

func (m *MServer) writeListDirErrPacket(err error, pk *packet.ListDirPacketType) {
	resp := packet.MakeFileStatPacketType()
	resp.RespId = pk.ReqId
	resp.Error = fmt.Sprintf("Error in list dir: %v", err)
	resp.Done = true
	err = m.Sender.SendPacket(resp)
}

func (m *MServer) ListDir(listDirPk *packet.ListDirPacketType) {
	dirEntries, err := os.ReadDir(listDirPk.Path)
	var readDirError string = ""
	if err != nil {
		readDirError = fmt.Sprintf("error in list dir: %v", err)
	}
	for index := 0; index < len(dirEntries); index++ {
		dirEntry := dirEntries[index]
		resp := packet.MakeFileStatPacketType()
		resp.RespId = listDirPk.ReqId
		resp.Error = readDirError
		if index == (len(dirEntries) - 1) {
			resp.Done = true
		} else {
			resp.Done = false
		}

		resp.IsDir = dirEntry.IsDir()
		resp.Name = dirEntry.Name()

		dirEntryFileInfo, err := dirEntry.Info()
		if err != nil {
			m.writeListDirErrPacket(err, listDirPk)
		}
		resp.Size = dirEntryFileInfo.Size()
		resp.ModTs = dirEntryFileInfo.ModTime()
		resp.Perm = int(dirEntryFileInfo.Mode().Perm())
		resp.ModeStr = dirEntryFileInfo.Mode().String()
		m.Sender.SendPacket(resp)
	}
	// what this is going to do is list the directory and then either send one packet back or stream the file list one by one I'm not sure
	// I probably need to add a hidden flag on the packet type to specify whether we want to see hidden files
}

func int64Min(v1 int64, v2 int64) int64 {
	if v1 < v2 {
		return v1
	}
	return v2
}

func (m *MServer) ProcessRpcPacket(pk packet.RpcPacketType) {
	reqId := pk.GetReqId()
	if cdPk, ok := pk.(*packet.CdPacketType); ok {
		err := os.Chdir(cdPk.Dir)
		if err != nil {
			m.Sender.SendErrorResponse(reqId, fmt.Errorf("cannot change directory: %w", err))
			return
		}
		m.Sender.SendResponse(reqId, true)
		return
	}
	if compPk, ok := pk.(*packet.CompGenPacketType); ok {
		go m.runCompGen(compPk)
		return
	}
	if reinitPk, ok := pk.(*packet.ReInitPacketType); ok {
		go m.reinit(reqId, reinitPk.ShellType)
		return
	}
	if streamPk, ok := pk.(*packet.StreamFilePacketType); ok {
		go m.streamFile(streamPk)
		return
	}
	if writePk, ok := pk.(*packet.WriteFilePacketType); ok {
		wfc := m.getWriteFileContext(writePk.ReqId)
		go m.writeFile(writePk, wfc)
		return
	}
	if listDirPk, ok := pk.(*packet.ListDirPacketType); ok {
		go m.ListDir(listDirPk)
		return
	}
	m.Sender.SendErrorResponse(reqId, fmt.Errorf("invalid rpc type '%s'", pk.GetType()))
	return
}

func (m *MServer) clientPacketCallback(shellType string, pk packet.PacketType) {
	if pk.GetType() != packet.CmdDonePacketStr {
		return
	}
	donePk := pk.(*packet.CmdDonePacketType)
	if donePk.FinalState == nil {
		return
	}
	stateHash, curState := m.StateMap.GetCurrentState(shellType)
	if curState == nil {
		return
	}
	sapi, err := shellapi.MakeShellApi(curState.GetShellType())
	if err != nil {
		return
	}
	diff, err := sapi.MakeShellStateDiff(curState, stateHash, donePk.FinalState)
	if err != nil {
		return
	}
	donePk.FinalState = nil
	donePk.FinalStateDiff = diff
}

func (m *MServer) isShellInitialized(shellType string) bool {
	_, curState := m.StateMap.GetCurrentState(shellType)
	return curState != nil
}

func (m *MServer) runCommand(runPacket *packet.RunPacketType) {
	if err := runPacket.CK.Validate("packet"); err != nil {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("server run packets require valid ck: %s", err))
		return
	}
	if runPacket.ShellType == "" {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("server run packets require shell type"))
		return
	}
	_, curInitState := m.StateMap.GetCurrentState(runPacket.ShellType)
	if curInitState == nil {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("shell type %q is not initialized", runPacket.ShellType))
		return
	}
	if runPacket.State == nil {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("server run packets require state"))
		return
	}
	_, _, err := packet.ParseShellStateVersion(runPacket.State.Version)
	if err != nil {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("invalid shellstate version: %w", err))
		return
	}
	if !packet.StateVersionsCompatible(runPacket.State.Version, curInitState.Version) {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("shellstate version %q is not compatible with current shell version %q", runPacket.State.Version, curInitState.Version))
		return
	}
	ecmd, err := shexec.MakeMShellSingleCmd()
	if err != nil {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("server run packets require valid ck: %s", err))
		return
	}
	cproc, _, err := shexec.MakeClientProc(context.Background(), shexec.CmdWrap{Cmd: ecmd})
	if err != nil {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("starting mshell client: %s", err))
		return
	}
	m.Lock.Lock()
	m.ClientMap[runPacket.CK] = cproc
	m.Lock.Unlock()
	go func() {
		defer func() {
			r := recover()
			finalPk := packet.MakeCmdFinalPacket(runPacket.CK)
			finalPk.Ts = time.Now().UnixMilli()
			if r != nil {
				finalPk.Error = fmt.Sprintf("%s", r)
			}
			m.Sender.SendPacket(finalPk)
			m.Lock.Lock()
			delete(m.ClientMap, runPacket.CK)
			m.Lock.Unlock()
			cproc.Close()
		}()
		shexec.SendRunPacketAndRunData(context.Background(), cproc.Input, runPacket)
		cproc.ProxySingleOutput(runPacket.CK, m.Sender, func(pk packet.PacketType) {
			m.clientPacketCallback(runPacket.ShellType, pk)
		})
	}()
}

func (m *MServer) packetSenderErrorHandler(sender *packet.PacketSender, pk packet.PacketType, err error) {
	if serr, ok := err.(*packet.SendError); ok && serr.IsMarshalError {
		msg := packet.MakeMessagePacket(err.Error())
		if cpk, ok := pk.(packet.CommandPacketType); ok {
			msg.CK = cpk.GetCK()
		}
		sender.SendPacket(msg)
		return
	} else {
		// I/O error: close the WriteErrorCh to signal that we are dead (cannot continue if we can't write output)
		m.WriteErrorChOnce.Do(func() {
			close(m.WriteErrorCh)
		})
	}
}

func (server *MServer) runReadLoop() {
	builder := packet.MakeRunPacketBuilder()
	for pk := range server.MainInput.MainCh {
		if server.Debug {
			fmt.Printf("PK> %s\n", packet.AsString(pk))
		}
		ok, runPacket := builder.ProcessPacket(pk)
		if ok {
			if runPacket != nil {
				server.runCommand(runPacket)
				continue
			}
			continue
		}
		if cmdPk, ok := pk.(packet.CommandPacketType); ok {
			server.ProcessCommandPacket(cmdPk)
			continue
		}
		if rpcPk, ok := pk.(packet.RpcPacketType); ok {
			server.ProcessRpcPacket(rpcPk)
			continue
		}
		if fileDataPk, ok := pk.(*packet.FileDataPacketType); ok {
			server.addFileDataPacket(fileDataPk)
			continue
		}
		server.Sender.SendMessageFmt("invalid packet '%s' sent to mshell server", packet.AsString(pk))
		continue
	}
}

func RunServer() (int, error) {
	debug := false
	if len(os.Args) >= 3 && os.Args[2] == "--debug" {
		debug = true
	}
	server := &MServer{
		Lock:                &sync.Mutex{},
		ClientMap:           make(map[base.CommandKey]*shexec.ClientProc),
		StateMap:            MakeShellStateMap(),
		Debug:               debug,
		WriteErrorCh:        make(chan bool),
		WriteErrorChOnce:    &sync.Once{},
		WriteFileContextMap: make(map[string]*WriteFileContext),
	}
	go func() {
		for {
			if server.checkDone() {
				return
			}
			time.Sleep(cleanLoopTime)
			server.cleanWriteFileContexts()
		}
	}()
	if debug {
		packet.GlobalDebug = true
	}
	server.MainInput = packet.MakePacketParser(os.Stdin, nil)
	server.Sender = packet.MakePacketSender(os.Stdout, server.packetSenderErrorHandler)
	defer server.Close()
	var err error
	initPacket, err := shexec.MakeServerInitPacket()
	if err != nil {
		return 1, err
	}
	server.Sender.SendPacket(initPacket)
	ticker := time.NewTicker(1 * time.Minute)
	go func() {
		for range ticker.C {
			server.Sender.SendPacket(packet.MakePingPacket())
		}
	}()
	defer ticker.Stop()
	readLoopDoneCh := make(chan bool)
	go func() {
		defer close(readLoopDoneCh)
		server.runReadLoop()
	}()
	select {
	case <-readLoopDoneCh:
		break

	case <-server.WriteErrorCh:
		break
	}
	return 0, nil
}

func MakeShellStateMap() *ShellStateMap {
	return &ShellStateMap{
		Lock:            &sync.Mutex{},
		StateMap:        make(map[shellStateMapKey]*packet.ShellState),
		CurrentStateMap: make(map[string]string),
	}
}

func (sm *ShellStateMap) GetCurrentState(shellType string) (string, *packet.ShellState) {
	sm.Lock.Lock()
	defer sm.Lock.Unlock()
	hval := sm.CurrentStateMap[shellType]
	return hval, sm.StateMap[shellStateMapKey{ShellType: shellType, Hash: hval}]
}

func (sm *ShellStateMap) SetCurrentState(shellType string, state *packet.ShellState) error {
	if state == nil {
		return fmt.Errorf("cannot set nil state")
	}
	if shellType != state.GetShellType() {
		return fmt.Errorf("shell type mismatch: %s != %s", shellType, state.GetShellType())
	}
	sm.Lock.Lock()
	defer sm.Lock.Unlock()
	hval, _ := state.EncodeAndHash()
	key := shellStateMapKey{ShellType: shellType, Hash: hval}
	sm.StateMap[key] = state
	sm.CurrentStateMap[shellType] = hval
	return nil
}

func (sm *ShellStateMap) GetStateByHash(shellType string, hash string) *packet.ShellState {
	sm.Lock.Lock()
	defer sm.Lock.Unlock()
	return sm.StateMap[shellStateMapKey{ShellType: shellType, Hash: hash}]
}

func (sm *ShellStateMap) Clear() {
	sm.Lock.Lock()
	defer sm.Lock.Unlock()
	sm.StateMap = make(map[shellStateMapKey]*packet.ShellState)
	sm.CurrentStateMap = make(map[string]string)
}

func (sm *ShellStateMap) GetShells() []string {
	sm.Lock.Lock()
	defer sm.Lock.Unlock()
	return utilfn.GetMapKeys(sm.CurrentStateMap)
}

func (sm *ShellStateMap) HasShell(shellType string) bool {
	sm.Lock.Lock()
	defer sm.Lock.Unlock()
	_, found := sm.CurrentStateMap[shellType]
	return found
}
